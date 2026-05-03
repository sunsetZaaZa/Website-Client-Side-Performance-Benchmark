#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const binSuffix = process.platform === 'win32' ? '.cmd' : '';
const localBin = (name) => path.join('node_modules', '.bin', `${name}${binSuffix}`);

const testFiles = fs
  .readdirSync('test')
  .filter((fileName) => fileName.endsWith('.test.ts'))
  .sort()
  .map((fileName) => path.join('test', fileName));

if (testFiles.length === 0) {
  console.error('No test files matched test/*.test.ts');
  process.exit(1);
}

const commands = [
  {
    label: 'Validate configuration',
    command: localBin('ts-node'),
    args: ['src/tools/validate-config.ts'],
  },
  {
    label: 'Typecheck TypeScript',
    command: localBin('tsc'),
    args: ['-p', 'tsconfig.json', '--noEmit'],
  },
  {
    label: 'Run unit tests',
    command: process.execPath,
    args: ['--test', '-r', 'ts-node/register', ...testFiles],
  },
  {
    label: 'Bundle k6 load test',
    command: localBin('esbuild'),
    args: [
      'src/k6/load-test.ts',
      '--bundle',
      '--platform=neutral',
      '--format=esm',
      '--external:k6',
      '--external:k6/http',
      '--outfile=dist/k6/load-test.js',
    ],
  },
];

for (const step of commands) {
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    stdio: 'inherit',
    shell: true,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
