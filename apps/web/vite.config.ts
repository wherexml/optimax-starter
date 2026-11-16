import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webPort = Number(process.env.WEB_PORT) || 38140;
const apiPort = Number(process.env.API_PORT) || 38141;
const apiProxyTarget =
  process.env.API_PROXY_TARGET?.trim() || `http://api:${apiPort}`;

export default defineConfig({
  server: {
    host: "0.0.0.0",
    strictPort: true,
    proxy: { "/console": apiProxyTarget },
    port: webPort,
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
