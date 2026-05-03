#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const extraArgs = process.argv.slice(2);
const checkLockfileRegistryScript = path.resolve(__dirname, 'check-lockfile-registry.cjs');
const env = {
  ...process.env,
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || '1',
};

const lockfileCheck = spawnSync(process.execPath, [checkLockfileRegistryScript], {
  stdio: 'inherit',
  env,
});

if (lockfileCheck.error) {
  console.error(lockfileCheck.error.message);
  process.exit(1);
}

if (lockfileCheck.status !== 0) {
  process.exit(lockfileCheck.status ?? 1);
}

const result = spawnSync(
  npmCommand,
  [
    'ci',
    '--no-audit',
    '--no-fund',
    '--registry=https://registry.npmjs.org/',
    ...extraArgs,
  ],
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
