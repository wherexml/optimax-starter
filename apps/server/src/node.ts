// Long-running API process on Node 24. Bun is only used for the short db:push step.
import { serve } from "@hono/node-server";
import app from "./index";

const port = Number(process.env.PORT) || 38141;
const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`API listening on http://${info.address}:${info.port}`);
});

let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, closing API server`);
  server.close((error?: Error) => {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
  });
  // Exit even if keep-alive connections never close.
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
