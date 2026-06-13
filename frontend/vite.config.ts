import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api to the backend so the frontend talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3100",
    },
  },
});
