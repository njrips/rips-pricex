#!/usr/bin/env bash
# When Shopify CLI's built-in Cloudflare tunnel fails (network / HTTP2), use localtunnel.
# Shopify CLI still runs Remix + Express (both processes) — same as `npm run dev`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STORE="${1:-}"
if [[ -z "$STORE" ]]; then
  echo "Usage: npm run dev:localtunnel -- YOUR-STORE.myshopify.com"
  exit 1
fi

PROXY_PORT=3458
BRIDGE_PORT=34580
API_PORT=3456

for port in "$API_PORT" "$PROXY_PORT" "$BRIDGE_PORT"; do
  if lsof -ti ":$port" >/dev/null 2>&1; then
    echo "[dev:localtunnel] Freeing port $port"
    lsof -ti ":$port" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
done

pkill -f "proxy-ipv4-bridge.js" 2>/dev/null || true
pkill -f "node_modules/.bin/lt --port" 2>/dev/null || true

LT_LOG="$(mktemp)"
BRIDGE_PID=""
LT_PID=""
SHOPIFY_PID=""
cleanup() {
  rm -f "$LT_LOG"
  [[ -n "$SHOPIFY_PID" ]] && kill "$SHOPIFY_PID" 2>/dev/null || true
  [[ -n "$LT_PID" ]] && kill "$LT_PID" 2>/dev/null || true
  [[ -n "$BRIDGE_PID" ]] && kill "$BRIDGE_PID" 2>/dev/null || true
  pkill -f "node_modules/.bin/lt --port ${BRIDGE_PORT}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_for_bridge() {
  for _ in $(seq 1 90); do
    code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 "http://127.0.0.1:${BRIDGE_PORT}/" 2>/dev/null || echo "000")"
    if [[ "$code" == "200" || "$code" == "302" || "$code" == "403" ]]; then
      return 0
    fi
    sleep 2
  done
  return 1
}

start_localtunnel() {
  pkill -f "node_modules/.bin/lt --port ${BRIDGE_PORT}" 2>/dev/null || true
  [[ -n "${LT_PID:-}" ]] && kill "$LT_PID" 2>/dev/null || true
  sleep 1
  : >"$LT_LOG"
  npx --yes localtunnel --port "$BRIDGE_PORT" >>"$LT_LOG" 2>&1 &
  LT_PID=$!
  for _ in $(seq 1 45); do
    TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.loca\.lt' "$LT_LOG" | head -1 || true)"
    if [[ -n "$TUNNEL_URL" ]]; then
      echo "$TUNNEL_URL"
      return 0
    fi
    sleep 1
  done
  cat "$LT_LOG" >&2
  return 1
}

start_shopify() {
  local url="$1"
  npm run dev -- --tunnel-url="${url}:${PROXY_PORT}" --store "$STORE" &
  SHOPIFY_PID=$!
}

# Do not use localtunnel --local-host ::1 — it forwards Host: ::1 and Vite blocks it.
echo "[dev:localtunnel] IPv4 bridge 127.0.0.1:$BRIDGE_PORT → [::1]:$PROXY_PORT"
node "$ROOT/scripts/proxy-ipv4-bridge.js" "$BRIDGE_PORT" "::1" "$PROXY_PORT" &
BRIDGE_PID=$!
sleep 0.3

# Bootstrap: Shopify CLI needs a tunnel URL before it will start; localtunnel needs a live proxy.
# Use a throwaway tunnel, then replace it once the proxy is up (one Shopify restart if URL changes).
echo "[dev:localtunnel] Bootstrap localtunnel (temporary)..."
BOOT_URL="$(start_localtunnel)" || exit 1
echo "[dev:localtunnel] Bootstrap URL: $BOOT_URL"
start_shopify "$BOOT_URL"

echo "[dev:localtunnel] Waiting for Shopify proxy..."
if ! wait_for_bridge; then
  echo "[dev:localtunnel] Timed out waiting for Shopify proxy."
  wait "$SHOPIFY_PID" || true
  exit 1
fi

echo "[dev:localtunnel] Starting production localtunnel (proxy is up)..."
kill "$LT_PID" 2>/dev/null || true
pkill -f "node_modules/.bin/lt --port ${BRIDGE_PORT}" 2>/dev/null || true
sleep 2
FINAL_URL="$(start_localtunnel)" || exit 1
echo "[dev:localtunnel] Public URL: $FINAL_URL"

if [[ "$FINAL_URL" != "$BOOT_URL" ]]; then
  echo "[dev:localtunnel] Tunnel URL changed; restarting Shopify CLI once..."
  kill "$SHOPIFY_PID" 2>/dev/null || true
  pkill -f "shopify app dev" 2>/dev/null || true
  sleep 3
  start_shopify "$FINAL_URL"
  wait_for_bridge || true
fi

for _ in $(seq 1 20); do
  pub="$(curl -s -o /dev/null -w "%{http_code}" --max-time 12 -H "Bypass-Tunnel-Reminder: true" "${FINAL_URL}/" 2>/dev/null || echo "000")"
  if [[ "$pub" == "200" || "$pub" == "302" || "$pub" == "403" ]]; then
    echo "[dev:localtunnel] Tunnel OK (${pub}) → ${FINAL_URL}"
    break
  fi
  sleep 2
done

wait "$SHOPIFY_PID"
