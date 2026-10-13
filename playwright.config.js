const { defineConfig } = require('@playwright/test');
const fs = require('fs');
const chromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'results/junit.xml' }]],
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    launchOptions: fs.existsSync(chromium) && !process.env.CI ? { executablePath: chromium } : {} },
  webServer: { command: 'PORT=3100 node app/server.js', url: 'http://localhost:3100/api/medicines', reuseExistingServer: !process.env.CI },
});
