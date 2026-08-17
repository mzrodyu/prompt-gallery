const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  retries: 0,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
  },
  webServer: {
    command: 'node tests/e2e/prepare-data.js && node server.js',
    url: 'http://127.0.0.1:3100',
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      PORT: '3100',
      DATA_DIR: '.e2e-data',
      JWT_SECRET: 'e2e-jwt-secret-mj-gallery-please-change',
    },
  },
});

