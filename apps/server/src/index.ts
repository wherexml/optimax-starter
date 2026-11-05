import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { consoleApi, initializeConsole } from "./console";
import { ENV } from "./env.server";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

await initializeConsole();
app.route("/console", consoleApi);
app.get("/", (c) => {
  return c.text("OK");
});

export default app;
