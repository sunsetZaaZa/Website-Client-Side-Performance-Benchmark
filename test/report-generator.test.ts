import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateHtmlReport } from '../src/reporting/report-generator';

test('report falls back to the current project stage when run summary omits a stage', () => {
  const runDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-report-'));
  fs.writeFileSync(path.join(runDirectory, 'run-summary.json'), JSON.stringify({
    runId: 'run-test',
    status: 'PASS',
    durationMs: 1234,
    baseUrl: 'https://example.com',
    k6: {
      vus: 1,
      duration: '5s',
      skipped: true,
      exitCode: null,
    },
    playwright: {
      skipped: true,
      flowsRun: 0,
      pageVisits: 0,
      screenshotsCaptured: 0,
    },
    thresholds: {
      skipped: true,
      totalPageVisits: 0,
      passedPageVisits: 0,
      failedPageVisits: 0,
      violationCount: 0,
    },
  }, null, 2));

  const reportPath = generateHtmlReport({ runDirectory });
  const html = fs.readFileSync(reportPath, 'utf8');

  assert.match(html, /<th>Stage<\/th>\s*<td>9<\/td>/);
});
