#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const lockfilePath = path.resolve(process.cwd(), 'package-lock.json');
const forbiddenHostPatterns = [
  /packages\.applied-caas-gateway\d*\.internal\.api\.openai\.org/i,
  /artifactory\/api\/npm\/npm-public/i,
];

const allowedHosts = new Set(
  (process.env.NPM_LOCKFILE_ALLOWED_HOSTS || 'registry.npmjs.org')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

if (!fs.existsSync(lockfilePath)) {
  console.error('package-lock.json was not found. Run npm install locally and commit the lockfile.');
  process.exit(1);
}

const lockfileText = fs.readFileSync(lockfilePath, 'utf8');
for (const pattern of forbiddenHostPatterns) {
  if (pattern.test(lockfileText)) {
    console.error('package-lock.json contains an internal npm registry URL that public CI cannot reach.');
    console.error('Regenerate or normalize the lockfile so resolved tarballs use https://registry.npmjs.org/.');
    process.exit(1);
  }
}

let parsed;
try {
  parsed = JSON.parse(lockfileText);
} catch (error) {
  console.error(`package-lock.json is not valid JSON: ${error.message}`);
  process.exit(1);
}

const invalidResolvedUrls = [];
for (const [packagePath, entry] of Object.entries(parsed.packages || {})) {
  if (!entry || typeof entry.resolved !== 'string') {
    continue;
  }

  let host;
  try {
    host = new URL(entry.resolved).host.toLowerCase();
  } catch {
    invalidResolvedUrls.push(`${packagePath || '<root>'}: ${entry.resolved}`);
    continue;
  }

  if (!allowedHosts.has(host)) {
    invalidResolvedUrls.push(`${packagePath || '<root>'}: ${entry.resolved}`);
  }
}

if (invalidResolvedUrls.length > 0) {
  console.error('package-lock.json contains resolved URLs outside the allowed npm registry hosts:');
  for (const line of invalidResolvedUrls.slice(0, 25)) {
    console.error(`  - ${line}`);
  }
  if (invalidResolvedUrls.length > 25) {
    console.error(`  ...and ${invalidResolvedUrls.length - 25} more`);
  }
  console.error(`Allowed hosts: ${Array.from(allowedHosts).join(', ')}`);
  console.error('Set NPM_LOCKFILE_ALLOWED_HOSTS for intentional private registry usage.');
  process.exit(1);
}

console.log(`package-lock.json registry URLs are valid: ${Array.from(allowedHosts).join(', ')}`);
