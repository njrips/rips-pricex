#!/usr/bin/env node
/**
 * TCP bridge: IPv4 127.0.0.1:listen → targetHost:targetPort
 * Shopify CLI proxy binds [::1]:3458 only; localtunnel hits 127.0.0.1.
 */
import net from "net";

const listenPort = Number(process.argv[2]);
const targetHost = process.argv[3] || "::1";
const targetPort = Number(process.argv[4]);

if (!listenPort || !targetPort) {
  console.error(
    "Usage: node scripts/proxy-ipv4-bridge.js <listenPort> <targetHost> <targetPort>",
  );
  process.exit(1);
}

const server = net.createServer((client) => {
  const upstream = net.connect({ host: targetHost, port: targetPort }, () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", close);
  upstream.on("error", close);
});

server.listen(listenPort, "127.0.0.1", () => {
  console.log(
    `[proxy-ipv4-bridge] 127.0.0.1:${listenPort} → ${targetHost}:${targetPort}`,
  );
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
