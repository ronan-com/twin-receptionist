import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Answered's screens (TanStack Router, file-based routes in src/routes) on the
// Twin engine. The Bun server serves the built dist/ and the /api routes.
export default defineConfig({
  plugins: [
    // Must come before the React plugin. Generates src/routeTree.gen.ts.
    tanstackRouter({ target: "react", autoCodeSplitting: true, routesDirectory: "./src/routes", generatedRouteTree: "./src/routeTree.gen.ts" }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8791", "/brand": "http://127.0.0.1:8791" },
  },
});
