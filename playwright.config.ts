import { defineConfig } from "@playwright/test";

/**
 * Browser smoke tests. Point PLAYWRIGHT_BASE_URL at a running staging/dev server with OTP_DEV_ECHO=true
 * and the dev seed loaded. Uses the system Chrome when CHROME_PATH is set (no browser download needed).
 */
export default defineConfig({
  testDir: "tests/ui",
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    viewport: { width: 390, height: 844 },
    geolocation: { latitude: 38.6215, longitude: 66.2495 },
    permissions: ["geolocation"],
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ["--no-sandbox"] } : {},
  },
});
