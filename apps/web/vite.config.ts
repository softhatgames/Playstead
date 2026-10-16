import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
