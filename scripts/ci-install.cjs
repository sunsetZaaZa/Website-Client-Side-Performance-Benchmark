#!/usr/bin/env node
const { spawnSync } = require('node:child_process');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const extraArgs = process.argv.slice(2);
const env = {
  ...process.env,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || '1',
};

const result = spawnSync(
  npmCommand,
  ['ci', '--no-audit', '--no-fund', ...extraArgs],
  {
    stdio: 'inherit',
    env,
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
