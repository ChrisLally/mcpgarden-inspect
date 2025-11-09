import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react({
      // Ensure React is properly handled
      jsxRuntime: "automatic",
    }),
  ],
  server: {
    host: true, // Allows access from network
    proxy: {
      // Proxy API requests to the backend server (running on 6277 by default) during development
      "/sse": {
        target: "http://localhost:6277", // Default port of the proxy server
        changeOrigin: true, // Recommended for virtual hosted sites
        secure: false, // Often needed for localhost targets
      },
      "/message": {
        target: "http://localhost:6277",
        changeOrigin: true,
        secure: false,
      },
      "/health": {
        target: "http://localhost:6277",
        changeOrigin: true,
        secure: false,
      },
      "/config": {
        target: "http://localhost:6277",
        changeOrigin: true,
        secure: false,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"], // Ensure only one instance of React
  },
  build: {
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: undefined, // Don't split chunks - bundle everything together to avoid React issues
      },
    },
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom"],
    force: true, // Force re-optimization
  },
});
