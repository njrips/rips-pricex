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
API_PORT=3456

for port in "$API_PORT" "$PROXY_PORT"; do
  if lsof -ti ":$port" >/dev/null 2>&1; then
    echo "[dev:localtunnel] Freeing port $port"
    lsof -ti ":$port" | xargs kill -9 2>/dev/null || true
    sleep 0.5
  fi
done

LT_LOG="$(mktemp)"
trap 'rm -f "$LT_LOG"; kill "$LT_PID" 2>/dev/null || true' EXIT

echo "[dev:localtunnel] Starting localtunnel → 127.0.0.1:$PROXY_PORT"
npx --yes localtunnel --port "$PROXY_PORT" >"$LT_LOG" 2>&1 &
LT_PID=$!

TUNNEL_URL=""
for _ in $(seq 1 45); do
  TUNNEL_URL="$(grep -oE 'https://[a-z0-9-]+\.loca\.lt' "$LT_LOG" | head -1 || true)"
  if [[ -n "$TUNNEL_URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$TUNNEL_URL" ]]; then
  echo "[dev:localtunnel] Could not get localtunnel URL:"
  cat "$LT_LOG"
  exit 1
fi

echo "[dev:localtunnel] Public URL: $TUNNEL_URL (forwards to localhost:$PROXY_PORT)"
echo "[dev:localtunnel] Starting shopify app dev (Admin + API)..."

exec npm run dev -- --tunnel-url="${TUNNEL_URL}:${PROXY_PORT}" --store "$STORE"
