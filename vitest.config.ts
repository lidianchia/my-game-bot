import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // Game logic, rooms, rendering: plain Node with node:sqlite standing in for DO storage.
        test: { name: "unit", include: ["test/unit/**/*.test.ts"], environment: "node" },
      },
      {
        // Worker routing + Durable Object wiring, inside the real Workers runtime (workerd).
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                BOT_TOKEN: "123:test-token",
                WEBHOOK_SECRET: "test-secret",
                TELEGRAM_API_ROOT: "https://telegram.test",
                MINIAPP_SHORT_NAME: "play",
              },
            },
          }),
        ],
        test: { name: "worker", include: ["test/worker/**/*.test.ts"] },
      },
    ],
  },
});
