import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.API_PROXY_TARGET ?? "http://127.0.0.1:4300";

export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", proxy: { "/api": apiProxyTarget } },
  build: { outDir: "dist" },
});
