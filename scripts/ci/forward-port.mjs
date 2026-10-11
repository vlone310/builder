// Forwards a local port to another host, so a service container answers on localhost.
// GitLab services are reachable only by their alias; Keycloak has to be on localhost:8080
// for the browser, the Content API and the token issuer to agree on one URL.
//
//   node scripts/ci/forward-port.mjs 8080 keycloak:8080
import net from "node:net";

const [listenPort, target] = process.argv.slice(2);
const [host, port] = (target ?? "").split(":");
if (!listenPort || !host || !port) {
  console.error("Usage: forward-port.mjs <listen-port> <host>:<port>");
  process.exit(1);
}

net
  .createServer((client) => {
    const upstream = net.connect(Number(port), host);
    client.pipe(upstream).pipe(client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", close);
    upstream.on("error", close);
  })
  .listen(Number(listenPort), () => console.log(`localhost:${listenPort} → ${host}:${port}`));
