import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadProjectConfigFromArgs } from '../src/config/loader';

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('loadProjectConfigFromArgs uses TEST_CONFIG_PATH and THRESHOLDS_CONFIG_PATH env defaults', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-config-'));
  const testConfigPath = path.join(tempDir, 'custom-test-config.json');
  const thresholdsConfigPath = path.join(tempDir, 'custom-thresholds.json');

  writeJson(testConfigPath, {
    baseUrl: 'https://example.com',
    load: {
      vus: 1,
      duration: '5s',
      warmupMs: 0,
    },
    browser: {
      viewport: {
        width: 1280,
        height: 720,
      },
      fullPageScreenshot: true,
      waitUntil: 'load',
    },
    pages: {
      home: {
        path: '/',
        capture: true,
      },
    },
    flows: [
      {
        name: 'smoke',
        label: 'Smoke flow',
        steps: ['home'],
      },
    ],
  });

  writeJson(thresholdsConfigPath, {
    pageThresholds: {
      default: {
        totalVisitMs: 3000,
      },
      pages: {},
    },
  });

  const loaded = loadProjectConfigFromArgs([], {
    TEST_CONFIG_PATH: testConfigPath,
    THRESHOLDS_CONFIG_PATH: thresholdsConfigPath,
  });

  assert.equal(loaded.testConfig.baseUrl, 'https://example.com');
  assert.equal(loaded.resolvedFlows[0].steps[0].url, 'https://example.com/');
});
