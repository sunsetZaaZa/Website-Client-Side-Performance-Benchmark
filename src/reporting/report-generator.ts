import fs from 'node:fs';
import path from 'node:path';
import type { PageVisitMetadata } from '../playwright/metadata';
import type { ThresholdSummary } from '../thresholds/evaluator';
import { PROJECT_STAGE } from '../project-stage';

interface ReportCliOptions {
  runDirectory: string;
  outputFile: string;
}

interface RunSummaryForReport {
  runId?: string;
  stage?: number;
  baseUrl?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  status?: 'PASS' | 'FAIL' | 'PARTIAL' | string;
  k6?: {
    vus?: number;
    duration?: string;
    skipped?: boolean;
    skipReason?: string;
    exitCode?: number | null;
    summaryFile?: string;
  };
  playwright?: {
    skipped?: boolean;
    flowsRun?: number;
    pageVisits?: number;
    screenshotsCaptured?: number;
    captureError?: string;
  };
  thresholds?: {
    skipped?: boolean;
    passed?: boolean;
    totalPageVisits?: number;
    passedPageVisits?: number;
    failedPageVisits?: number;
    violationCount?: number;
  };
  flows?: Array<{
    name: string;
    label: string;
    steps: Array<{
      pageId: string;
      url: string;
      capture: boolean;
    }>;
  }>;
}

interface ReportPageViewModel {
  pageId: string;
  flowName: string;
  flowLabel: string;
  stepIndex: number;
  url: string;
  finalUrl?: string;
  status?: number;
  screenshot?: string;
  metrics: Record<string, number | undefined>;
  resources: PageVisitMetadata['resources'];
  errors: PageVisitMetadata['errors'];
  threshold?: ThresholdSummary['results'][number];
}

interface ReportFlowViewModel {
  name: string;
  label: string;
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  pages: ReportPageViewModel[];
}

interface ReportViewModel {
  generatedAt: string;
  runDirectoryName: string;
  run: RunSummaryForReport;
  k6Summary: unknown;
  thresholdSummary?: ThresholdSummary;
  flows: ReportFlowViewModel[];
  totals: {
    pageVisits: number;
    screenshots: number;
    consoleErrors: number;
    pageErrors: number;
    failedRequests: number;
    thresholdViolations: number;
  };
}

export function generateHtmlReport(input: { runDirectory: string; outputFile?: string }): string {
  const runDirectory = path.resolve(input.runDirectory);
  const outputFile = path.resolve(input.outputFile ?? path.join(runDirectory, 'report.html'));

  if (!fs.existsSync(runDirectory)) {
    throw new Error(`Run directory does not exist: ${runDirectory}`);
  }

  const viewModel = buildReportViewModel(runDirectory);
  const html = renderReportHtml(viewModel);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, html);

  return outputFile;
}

function buildReportViewModel(runDirectory: string): ReportViewModel {
  const runSummary = readJsonIfExists<RunSummaryForReport>(path.join(runDirectory, 'run-summary.json')) ?? {};
  const k6Summary = readJsonIfExists<unknown>(path.join(runDirectory, 'k6-summary.json')) ?? null;
  const pageResults = readJsonIfExists<PageVisitMetadata[]>(path.join(runDirectory, 'page-results.json')) ?? [];
  const thresholdSummary = readJsonIfExists<ThresholdSummary>(path.join(runDirectory, 'threshold-summary.json'));

  const thresholdByVisit = new Map<string, ThresholdSummary['results'][number]>();
  for (const result of thresholdSummary?.results ?? []) {
    thresholdByVisit.set(makeVisitKey(result.flowName, result.stepIndex, result.pageId), result);
  }

  const flowMap = new Map<string, ReportFlowViewModel>();

  for (const flow of runSummary.flows ?? []) {
    flowMap.set(flow.name, {
      name: flow.name,
      label: flow.label,
      status: 'UNKNOWN',
      pages: [],
    });
  }

  for (const page of pageResults) {
    const existingFlow = flowMap.get(page.flowName);
    const flow = existingFlow ?? {
      name: page.flowName,
      label: page.flowLabel,
      status: 'UNKNOWN' as const,
      pages: [],
    };

    flow.pages.push({
      pageId: page.pageId,
      flowName: page.flowName,
      flowLabel: page.flowLabel,
      stepIndex: page.stepIndex,
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      screenshot: page.screenshot,
      metrics: {
        totalVisitMs: page.timings.totalVisitMs,
        domContentLoadedMs: page.timings.domContentLoadedMs,
        loadEventMs: page.timings.loadEventMs,
        largestContentfulPaintMs: page.timings.largestContentfulPaintMs,
      },
      resources: page.resources,
      errors: page.errors,
      threshold: thresholdByVisit.get(makeVisitKey(page.flowName, page.stepIndex, page.pageId)),
    });

    flowMap.set(page.flowName, flow);
  }

  const flows = Array.from(flowMap.values()).map((flow) => {
    flow.pages.sort((a, b) => a.stepIndex - b.stepIndex);
    flow.status = flow.pages.length === 0
      ? 'UNKNOWN'
      : flow.pages.some((page) => page.threshold && !page.threshold.passed)
        ? 'FAIL'
        : flow.pages.every((page) => page.threshold?.passed === true)
          ? 'PASS'
          : 'UNKNOWN';
    return flow;
  });

  const totals = pageResults.reduce(
    (accumulator, page) => {
      accumulator.pageVisits += 1;
      accumulator.screenshots += page.screenshot ? 1 : 0;
      accumulator.consoleErrors += page.errors.consoleErrors.length;
      accumulator.pageErrors += page.errors.pageErrors.length;
      accumulator.failedRequests += page.errors.failedRequests.length;
      return accumulator;
    },
    {
      pageVisits: 0,
      screenshots: 0,
      consoleErrors: 0,
      pageErrors: 0,
      failedRequests: 0,
      thresholdViolations: thresholdSummary?.violations.length ?? 0,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    runDirectoryName: path.basename(runDirectory),
    run: runSummary,
    k6Summary,
    thresholdSummary,
    flows,
    totals,
  };
}

function renderReportHtml(model: ReportViewModel): string {
  const title = `Performance Report - ${model.run.runId ?? model.runDirectoryName}`;
  const runStatus = model.run.status ?? 'UNKNOWN';
  const statusClass = statusToClass(runStatus);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>${renderStyles()}</style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div>
        <p class="eyebrow">k6 + Playwright</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="muted">Generated ${escapeHtml(formatDate(model.generatedAt))}</p>
      </div>
      <div class="status ${statusClass}">${escapeHtml(runStatus)}</div>
    </section>

    <section class="grid summary-grid">
      ${renderSummaryCard('Base URL', model.run.baseUrl ?? 'Unknown')}
      ${renderSummaryCard('Duration', formatDuration(model.run.durationMs))}
      ${renderSummaryCard('Page visits', String(model.totals.pageVisits))}
      ${renderSummaryCard('Screenshots', String(model.totals.screenshots))}
      ${renderSummaryCard('Threshold failures', String(model.thresholdSummary?.failedPageVisits ?? 0))}
      ${renderSummaryCard('Browser errors', String(model.totals.consoleErrors + model.totals.pageErrors))}
    </section>

    <section class="panel">
      <h2>Run Summary</h2>
      <div class="two-column">
        <table>${renderKeyValueRows({
          'Run ID': model.run.runId ?? model.runDirectoryName,
          Stage: String(model.run.stage ?? PROJECT_STAGE),
          Started: formatDate(model.run.startedAt),
          Completed: formatDate(model.run.completedAt),
          'Run directory': model.runDirectoryName,
        })}</table>
        <table>${renderKeyValueRows({
          'k6 VUs': valueOrUnknown(model.run.k6?.vus),
          'k6 duration': model.run.k6?.duration ?? 'Unknown',
          'k6 skipped': booleanText(model.run.k6?.skipped),
          'k6 exit code': valueOrUnknown(model.run.k6?.exitCode),
          'Playwright skipped': booleanText(model.run.playwright?.skipped),
        })}</table>
      </div>
      ${model.run.k6?.skipReason ? `<p class="note">k6 skip reason: ${escapeHtml(model.run.k6.skipReason)}</p>` : ''}
      ${model.run.playwright?.captureError ? `<p class="note danger-text">Playwright capture error: ${escapeHtml(model.run.playwright.captureError)}</p>` : ''}
    </section>

    <section class="panel">
      <h2>Flow Overview</h2>
      <div class="flow-list">
        ${model.flows.map(renderFlowOverview).join('\n') || '<p class="muted">No flow results were found.</p>'}
      </div>
    </section>

    ${model.flows.map(renderFlowSection).join('\n')}

    <section class="panel">
      <h2>k6 Summary Snapshot</h2>
      ${renderK6Summary(model.k6Summary)}
    </section>

    <section class="panel">
      <h2>Embedded Report Data</h2>
      <details>
        <summary>Open JSON payload</summary>
        <pre>${escapeHtml(JSON.stringify(model, null, 2))}</pre>
      </details>
    </section>
  </main>
</body>
</html>`;
}

function renderFlowOverview(flow: ReportFlowViewModel): string {
  return `<article class="flow-overview">
    <div>
      <strong>${escapeHtml(flow.label)}</strong>
      <p class="muted">${escapeHtml(flow.name)} · ${flow.pages.length} page visits</p>
    </div>
    <span class="status ${statusToClass(flow.status)}">${escapeHtml(flow.status)}</span>
  </article>`;
}

function renderFlowSection(flow: ReportFlowViewModel): string {
  return `<section class="panel">
    <div class="section-header">
      <div>
        <h2>${escapeHtml(flow.label)}</h2>
        <p class="muted">${escapeHtml(flow.name)}</p>
      </div>
      <span class="status ${statusToClass(flow.status)}">${escapeHtml(flow.status)}</span>
    </div>
    <div class="page-grid">
      ${flow.pages.map(renderPageCard).join('\n') || '<p class="muted">No page visits were captured for this flow.</p>'}
    </div>
  </section>`;
}

function renderPageCard(page: ReportPageViewModel): string {
  const thresholdStatus = page.threshold ? (page.threshold.passed ? 'PASS' : 'FAIL') : 'UNKNOWN';
  const thresholdClass = statusToClass(thresholdStatus);
  const screenshot = page.screenshot
    ? `<a href="${escapeAttribute(page.screenshot)}"><img src="${escapeAttribute(page.screenshot)}" alt="Screenshot for ${escapeAttribute(page.pageId)}" loading="lazy" /></a>`
    : '<div class="no-shot">No screenshot</div>';

  const violations = page.threshold?.violations.length
    ? `<div class="violations"><strong>Violations</strong><ul>${page.threshold.violations.map((violation) => `<li>${escapeHtml(violation.metric)}: ${escapeHtml(String(violation.actual ?? 'missing'))} &gt; ${escapeHtml(String(violation.expectedMax))}</li>`).join('')}</ul></div>`
    : '';

  const errorDetails = renderErrorDetails(page);

  return `<article class="page-card">
    <div class="screenshot">${screenshot}</div>
    <div class="card-body">
      <div class="page-title-row">
        <h3>${String(page.stepIndex).padStart(2, '0')} · ${escapeHtml(page.pageId)}</h3>
        <span class="status ${thresholdClass}">${thresholdStatus}</span>
      </div>
      <p class="url">${escapeHtml(page.finalUrl ?? page.url)}</p>
      <table class="metrics">${renderKeyValueRows({
        Status: valueOrUnknown(page.status),
        'Total visit': formatMs(page.metrics.totalVisitMs),
        'DOM content loaded': formatMs(page.metrics.domContentLoadedMs),
        'Load event': formatMs(page.metrics.loadEventMs),
        LCP: formatMs(page.metrics.largestContentfulPaintMs),
        Requests: valueOrUnknown(page.resources.requestCount),
        'Failed requests': valueOrUnknown(page.resources.failedRequestCount),
        'Console errors': valueOrUnknown(page.errors.consoleErrors.length),
      })}</table>
      ${violations}
      ${errorDetails}
    </div>
  </article>`;
}

function renderErrorDetails(page: ReportPageViewModel): string {
  const hasErrors = page.errors.consoleErrors.length > 0 || page.errors.pageErrors.length > 0 || page.errors.failedRequests.length > 0;

  if (!hasErrors) {
    return '';
  }

  return `<details class="errors">
    <summary>Browser error details</summary>
    ${renderStringList('Console errors', page.errors.consoleErrors)}
    ${renderStringList('Page errors', page.errors.pageErrors)}
    ${page.errors.failedRequests.length > 0 ? `<h4>Failed requests</h4><ul>${page.errors.failedRequests.map((request) => `<li>${escapeHtml(request.method)} ${escapeHtml(request.url)} · ${escapeHtml(request.failureText)}</li>`).join('')}</ul>` : ''}
  </details>`;
}

function renderStringList(title: string, values: string[]): string {
  if (values.length === 0) {
    return '';
  }

  return `<h4>${escapeHtml(title)}</h4><ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join('')}</ul>`;
}

function renderK6Summary(k6Summary: unknown): string {
  if (!k6Summary || typeof k6Summary !== 'object') {
    return '<p class="muted">No k6 summary was found.</p>';
  }

  const summary = k6Summary as Record<string, unknown>;

  if (summary.skipped) {
    return `<p class="note">k6 skipped: ${escapeHtml(String(summary.reason ?? 'Unknown reason'))}</p>`;
  }

  const metrics = summary.metrics && typeof summary.metrics === 'object'
    ? summary.metrics as Record<string, { values?: Record<string, number>; rate?: number; count?: number }>
    : undefined;

  if (!metrics) {
    return `<pre>${escapeHtml(JSON.stringify(k6Summary, null, 2))}</pre>`;
  }

  const interestingMetrics = ['http_req_duration', 'http_req_failed', 'http_reqs', 'iterations', 'vus_max'];

  return `<table>${interestingMetrics.map((metricName) => {
    const metric = metrics[metricName];
    if (!metric) {
      return '';
    }

    const value = metric.values?.['p(95)']
      ?? metric.values?.avg
      ?? metric.rate
      ?? metric.count
      ?? 'n/a';

    return `<tr><th>${escapeHtml(metricName)}</th><td>${escapeHtml(typeof value === 'number' ? round(value).toString() : String(value))}</td></tr>`;
  }).join('')}</table>`;
}

function renderSummaryCard(label: string, value: string): string {
  return `<article class="summary-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function renderKeyValueRows(values: Record<string, string | number>): string {
  return Object.entries(values)
    .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(String(value))}</td></tr>`)
    .join('\n');
}

function readJsonIfExists<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

function makeVisitKey(flowName: string, stepIndex: number, pageId: string): string {
  return `${flowName}::${stepIndex}::${pageId}`;
}

function statusToClass(status: string): string {
  switch (status) {
    case 'PASS':
      return 'pass';
    case 'FAIL':
      return 'fail';
    case 'PARTIAL':
      return 'partial';
    default:
      return 'unknown';
  }
}

function renderStyles(): string {
  return `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f4f5f7; color: #1f2937; }
* { box-sizing: border-box; }
body { margin: 0; background: linear-gradient(135deg, #f7f8fb, #eef2f7); }
.shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
.hero { display: flex; justify-content: space-between; gap: 24px; align-items: center; padding: 28px; border-radius: 24px; background: #111827; color: white; box-shadow: 0 18px 44px rgba(17, 24, 39, .18); }
.eyebrow { margin: 0 0 8px; text-transform: uppercase; letter-spacing: .16em; font-size: 12px; color: #cbd5e1; }
h1, h2, h3, h4, p { margin-top: 0; }
h1 { margin-bottom: 8px; font-size: clamp(28px, 4vw, 48px); }
h2 { margin-bottom: 16px; }
h3 { margin-bottom: 6px; }
.muted { color: #6b7280; }
.hero .muted { color: #d1d5db; margin-bottom: 0; }
.grid { display: grid; gap: 16px; }
.summary-grid { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin: 24px 0; }
.summary-card, .panel, .page-card, .flow-overview { background: rgba(255, 255, 255, .96); border: 1px solid #e5e7eb; border-radius: 20px; box-shadow: 0 12px 32px rgba(15, 23, 42, .08); }
.summary-card { padding: 18px; }
.summary-card span { display: block; color: #6b7280; font-size: 13px; margin-bottom: 8px; }
.summary-card strong { font-size: 24px; }
.panel { padding: 24px; margin-top: 24px; }
.two-column { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 9px 0; border-bottom: 1px solid #eef2f7; text-align: left; vertical-align: top; }
th { color: #64748b; font-weight: 600; padding-right: 16px; }
.status { display: inline-flex; align-items: center; justify-content: center; min-width: 88px; border-radius: 999px; padding: 8px 12px; font-weight: 800; letter-spacing: .04em; font-size: 12px; }
.pass { background: #dcfce7; color: #166534; }
.fail { background: #fee2e2; color: #991b1b; }
.partial { background: #fef3c7; color: #92400e; }
.unknown { background: #e5e7eb; color: #374151; }
.note { padding: 12px 14px; border-radius: 14px; background: #f8fafc; border: 1px solid #e2e8f0; }
.danger-text { color: #991b1b; }
.flow-list { display: grid; gap: 12px; }
.flow-overview, .section-header, .page-title-row { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
.flow-overview { padding: 16px; box-shadow: none; }
.flow-overview p { margin: 4px 0 0; }
.page-grid { display: grid; gap: 18px; grid-template-columns: repeat(auto-fit, minmax(310px, 1fr)); }
.page-card { overflow: hidden; }
.screenshot { background: #111827; min-height: 190px; display: grid; place-items: center; }
.screenshot img { width: 100%; display: block; max-height: 330px; object-fit: cover; object-position: top; }
.no-shot { color: #cbd5e1; padding: 48px 16px; }
.card-body { padding: 18px; }
.url { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #475569; word-break: break-all; }
.metrics th, .metrics td { font-size: 14px; }
.violations, .errors { margin-top: 14px; padding: 12px; border-radius: 14px; background: #fff7ed; border: 1px solid #fed7aa; }
.errors { background: #f8fafc; border-color: #e2e8f0; }
li { margin: 6px 0; }
pre { overflow: auto; padding: 16px; background: #0f172a; color: #e2e8f0; border-radius: 16px; font-size: 12px; }
@media print { body { background: white; } .panel, .summary-card, .page-card, .hero { box-shadow: none; } .screenshot img { max-height: 220px; } }
`;
}

function parseOptions(args: string[]): ReportCliOptions {
  const resultsRoot = process.env.RESULTS_DIR ?? path.join(process.cwd(), 'results');
  const runDirectory = path.resolve(getArgValue(args, '--run-dir') ?? findLatestRunDirectory(resultsRoot));
  const outputFile = path.resolve(getArgValue(args, '--out') ?? path.join(runDirectory, 'report.html'));
  return { runDirectory, outputFile };
}

function findLatestRunDirectory(resultsRoot: string): string {
  if (!fs.existsSync(resultsRoot)) {
    throw new Error(`No results directory was found. Provide --run-dir or create a run first: ${resultsRoot}`);
  }

  const candidates = fs.readdirSync(resultsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('run-'))
    .map((entry) => path.join(resultsRoot, entry.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (candidates.length === 0) {
    throw new Error(`No run-* directories found in ${resultsRoot}. Provide --run-dir.`);
  }

  return candidates[0];
}

function getArgValue(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for CLI argument ${key}.`);
  }

  return value;
}

function formatDate(value?: string): string {
  if (!value) {
    return 'Unknown';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(ms?: number): string {
  if (typeof ms !== 'number') {
    return 'Unknown';
  }

  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${round(ms / 1000)}s`;
}

function formatMs(ms?: number): string {
  return typeof ms === 'number' ? `${round(ms)}ms` : 'n/a';
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function valueOrUnknown(value: unknown): string {
  return value === undefined || value === null ? 'Unknown' : String(value);
}

function booleanText(value: unknown): string {
  return typeof value === 'boolean' ? (value ? 'yes' : 'no') : 'Unknown';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const outputFile = generateHtmlReport(options);
  console.log(`HTML report written to ${outputFile}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
