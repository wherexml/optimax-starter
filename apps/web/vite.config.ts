import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webPort = Number(process.env.WEB_PORT) || 38140;
const apiPort = Number(process.env.API_PORT) || 38141;
const appSlug = process.env.VITE_APP_SLUG?.trim() || "optimax-starter";
const themeStorageKey = JSON.stringify(`${appSlug}.theme`);
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
    {
      name: "starter-theme-init",
      transformIndexHtml(html) {
        const initScript = `<script>(function(){try{var p=localStorage.getItem(${themeStorageKey});var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark";}}catch(e){}})();</script>`;
        return html.replace("</head>", `  ${initScript}\n  </head>`);
      },
    },
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
  ],
});
