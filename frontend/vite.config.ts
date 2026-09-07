import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
const localSettings = loadEnv(mode, path.resolve(import.meta.dirname), 'VITE_CONTRIBUTOR_BACKEND');
const mongoContributors = localSettings.VITE_CONTRIBUTOR_BACKEND === 'mongodb';
return {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    headers: {
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=()',
    },
    port: 3000,
    strictPort: false,
    host: '127.0.0.1',
    allowedHosts: ["localhost", "127.0.0.1"],
    proxy: {
      '/api/v1/authority': {target: 'http://127.0.0.1:8002', changeOrigin: true, xfwd: false},
      ...(mongoContributors ? {
        '/api/v1/contributors': {target: 'http://127.0.0.1:8001', changeOrigin: true, xfwd: false},
      } : {}),
      "/api": process.env.DRISHTI_API_PROXY_TARGET || "http://127.0.0.1:8000",
      "/health": process.env.DRISHTI_API_PROXY_TARGET || "http://127.0.0.1:8000",
      "/ready": process.env.DRISHTI_API_PROXY_TARGET || "http://127.0.0.1:8000",
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
};
});
