import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function normalizeProxyTarget(url: string): string {
  const trimmed = (url || "").trim() || "http://localhost:3001";
  try {
    const u = new URL(trimmed);
    if (u.hostname === "localhost") u.hostname = "127.0.0.1";
    return u.toString();
  } catch {
    return trimmed;
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = normalizeProxyTarget(
    env.VITE_API_URL || "http://localhost:3001"
  );

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
