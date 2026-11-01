import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests start an in-memory MongoDB replica set (first run downloads mongod).
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
