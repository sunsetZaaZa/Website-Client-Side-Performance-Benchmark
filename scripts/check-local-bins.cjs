#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const binSuffix = process.platform === 'win32' ? '.cmd' : '';
const requiredBins = ['ts-node', 'tsc', 'esbuild', 'playwright'];
const missingBins = [];

for (const binName of requiredBins) {
  const binPath = path.join(process.cwd(), 'node_modules', '.bin', `${binName}${binSuffix}`);
  if (!fs.existsSync(binPath)) {
    missingBins.push(binPath);
  }
}

if (missingBins.length > 0) {
  console.error('Dependency installation is incomplete. Missing local binaries:');
  for (const missingBin of missingBins) {
    console.error(`- ${missingBin}`);
  }
  console.error('Run npm ci again, or check the preceding npm install output for an npm CLI failure.');
  process.exit(1);
}

console.log(`Dependency installation verified: ${requiredBins.join(', ')}`);
