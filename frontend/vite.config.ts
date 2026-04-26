import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const frontendPort = env.VITE_FRONTEND_PORT ? parseInt(env.VITE_FRONTEND_PORT) : 5173;
  const backendHost = env.VITE_BACKEND_HOST || "127.0.0.1";
  const backendPort = env.VITE_BACKEND_PORT ? parseInt(env.VITE_BACKEND_PORT) : 8000;

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": srcDir },
    },
    server: {
      port: frontendPort,
      proxy: {
        "/api": {
          target: `http://${backendHost}:${backendPort}`,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
  };
});
