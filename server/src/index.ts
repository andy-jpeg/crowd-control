import { createSimulatorApp } from "./simulator";

const host = process.env.SIMULATOR_HOST ?? "127.0.0.1";
const port = Number(process.env.SIMULATOR_PORT ?? 3000);
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);

if (!loopbackHosts.has(host)) {
  throw new Error("The development simulator must bind to a loopback address.");
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("SIMULATOR_PORT must be a valid TCP port.");
}

const app = createSimulatorApp({ serverToken: process.env.SIMULATOR_SERVER_TOKEN ?? "" });
const server = app.listen(port, host, () => {
  console.log(`Crowd Control development simulator listening at http://${host}:${port}`);
});

function shutdown(): void {
  server.close((err) => {
    if (err) {
      console.error("Failed to close simulator server:", err);
      process.exitCode = 1;
    }
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
