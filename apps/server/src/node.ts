// Long-running API process on Node 24. Bun is only used for the short db:push step.
import { serve } from "@hono/node-server";
import app from "./index";
import { startJobWorker, stopJobWorker } from "./core/jobs";

const port = Number(process.env.PORT) || 38141;
const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port }, (info) => {
  console.log(`API listening on http://${info.address}:${info.port}`);
  if (startJobWorker()) console.log("Background job worker started");
});

let closing = false;
function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  console.log(`${signal} received, closing API server`);
  // Exit even if keep-alive connections or a long job never finish.
  setTimeout(() => process.exit(1), 10_000).unref();
  const closed = new Promise<Error | undefined>((resolve) =>
    server.close((error?: Error) => resolve(error)),
  );
  void Promise.all([closed, stopJobWorker(8_000)]).then(([error]) => {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
  });
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
