import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadProjectConfig } from '../config/loader';
import { runPageVisits } from '../playwright/page-visit-runner';
import { generateHtmlReport } from '../reporting/report-generator';
import type { ThresholdSummary } from '../thresholds/evaluator';
import { PROJECT_STAGE } from '../project-stage';

interface OrchestratorOptions {
  testConfigPath: string;
  thresholdConfigPath: string;
  outputRoot: string;
  runId: string;
  skipK6: boolean;
  skipBrowser: boolean;
  noWarmup: boolean;
  headless: boolean;
  k6ScriptPath: string;
}

interface K6RunHandle {
  skipped: boolean;
  reason?: string;
  summaryPath: string;
  completion: Promise<number | null>;
  process?: ChildProcess;
}

interface RunSummary {
  runId: string;
  stage: number;
  baseUrl: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  config: {
    testConfigPath: string;
    thresholdConfigPath: string;
  };
  output: {
    runDirectory: string;
    k6SummaryFile: string;
    pageResultsFile?: string;
    thresholdSummaryFile?: string;
    reportFile?: string;
  };
  k6: {
    vus: number;
    duration: string;
    skipped: boolean;
    skipReason?: string;
    exitCode: number | null;
    summaryFile: string;
  };
  playwright: {
    skipped: boolean;
    flowsRun: number;
    pageVisits: number;
    screenshotsCaptured: number;
    captureError?: string;
  };
  thresholds: {
    skipped: boolean;
    passed?: boolean;
    totalPageVisits: number;
    passedPageVisits: number;
    failedPageVisits: number;
    violationCount: number;
    summaryFile?: string;
  };
  flows: Array<{
    name: string;
    label: string;
    steps: Array<{
      pageId: string;
      url: string;
      capture: boolean;
    }>;
  }>;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const startedAt = new Date();
  const projectConfig = loadProjectConfig(options.testConfigPath, options.thresholdConfigPath);
  const runDirectory = path.resolve(options.outputRoot, options.runId);
  fs.mkdirSync(runDirectory, { recursive: true });

  writeRunManifest(runDirectory, {
    runId: options.runId,
    startedAt: startedAt.toISOString(),
    testConfigPath: options.testConfigPath,
    thresholdConfigPath: options.thresholdConfigPath,
    outputRoot: options.outputRoot,
    skipK6: options.skipK6,
    skipBrowser: options.skipBrowser,
    noWarmup: options.noWarmup,
    headless: options.headless,
    k6ScriptPath: options.k6ScriptPath,
  });

  logRunPlan({
    runDirectory,
    baseUrl: projectConfig.testConfig.baseUrl,
    vus: projectConfig.testConfig.load.vus,
    duration: projectConfig.testConfig.load.duration,
    warmupMs: projectConfig.testConfig.load.warmupMs,
    flows: projectConfig.resolvedFlows.length,
    pageVisits: projectConfig.resolvedFlows.reduce((count, flow) => count + flow.steps.length, 0),
    skipK6: options.skipK6,
    skipBrowser: options.skipBrowser,
  });

  const k6Handle = startK6({
    skipK6: options.skipK6,
    k6ScriptPath: options.k6ScriptPath,
    testConfigPath: options.testConfigPath,
    summaryPath: path.join(runDirectory, 'k6-summary.json'),
  });

  if (!k6Handle.skipped && !options.skipBrowser && !options.noWarmup && projectConfig.testConfig.load.warmupMs > 0) {
    console.log(`Waiting ${projectConfig.testConfig.load.warmupMs}ms before browser capture...`);
    await delay(projectConfig.testConfig.load.warmupMs);
  }

  let pageVisitCount = 0;
  let screenshotCount = 0;
  let captureError: string | undefined;
  let thresholdSummary: ThresholdSummary | undefined;

  if (options.skipBrowser) {
    console.log('Skipping Playwright browser captures because --skip-browser was provided.');
  } else {
    console.log('Starting Playwright browser captures...');

    try {
      const pageVisitResult = await runPageVisits({
        flows: projectConfig.resolvedFlows,
        browser: projectConfig.testConfig.browser,
        outputDirectory: runDirectory,
        headless: options.headless,
      });

      pageVisitCount = pageVisitResult.pageResults.length;
      screenshotCount = pageVisitResult.pageResults.filter((result) => Boolean(result.screenshot)).length;
      thresholdSummary = pageVisitResult.thresholdSummary;
      console.log(`Captured ${pageVisitCount} page visits and ${screenshotCount} screenshots.`);
      console.log(`Thresholds: ${thresholdSummary.passedPageVisits}/${thresholdSummary.totalPageVisits} page visits passed.`);
    } catch (error) {
      captureError = error instanceof Error ? error.message : String(error);
      console.error(`Playwright capture failed: ${captureError}`);
    }
  }

  const k6ExitCode = await k6Handle.completion;
  const completedAt = new Date();

  const status = determineRunStatus({
    k6Skipped: k6Handle.skipped,
    k6ExitCode,
    browserSkipped: options.skipBrowser,
    captureError,
    thresholdsPassed: thresholdSummary?.passed,
  });

  const runSummary: RunSummary = {
    runId: options.runId,
    stage: PROJECT_STAGE,
    baseUrl: projectConfig.testConfig.baseUrl,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    status,
    config: {
      testConfigPath: options.testConfigPath,
      thresholdConfigPath: options.thresholdConfigPath,
    },
    output: {
      runDirectory,
      k6SummaryFile: path.relative(runDirectory, k6Handle.summaryPath),
      pageResultsFile: options.skipBrowser ? undefined : 'page-results.json',
      thresholdSummaryFile: options.skipBrowser ? undefined : 'threshold-summary.json',
      reportFile: 'report.html',
    },
    k6: {
      vus: projectConfig.testConfig.load.vus,
      duration: projectConfig.testConfig.load.duration,
      skipped: k6Handle.skipped,
      skipReason: k6Handle.reason,
      exitCode: k6ExitCode,
      summaryFile: path.relative(runDirectory, k6Handle.summaryPath),
    },
    playwright: {
      skipped: options.skipBrowser,
      flowsRun: options.skipBrowser ? 0 : projectConfig.resolvedFlows.length,
      pageVisits: pageVisitCount,
      screenshotsCaptured: screenshotCount,
      captureError,
    },
    thresholds: {
      skipped: options.skipBrowser || !thresholdSummary,
      passed: thresholdSummary?.passed,
      totalPageVisits: thresholdSummary?.totalPageVisits ?? 0,
      passedPageVisits: thresholdSummary?.passedPageVisits ?? 0,
      failedPageVisits: thresholdSummary?.failedPageVisits ?? 0,
      violationCount: thresholdSummary?.violations.length ?? 0,
      summaryFile: thresholdSummary ? 'threshold-summary.json' : undefined,
    },
    flows: projectConfig.resolvedFlows.map((flow) => ({
      name: flow.name,
      label: flow.label,
      steps: flow.steps.map((step) => ({
        pageId: step.id,
        url: step.url,
        capture: step.capture,
      })),
    })),
  };

  fs.writeFileSync(path.join(runDirectory, 'run-summary.json'), `${JSON.stringify(runSummary, null, 2)}\n`);
  console.log(`Run summary written to ${path.join(runDirectory, 'run-summary.json')}`);

  try {
    const reportPath = generateHtmlReport({ runDirectory });
    console.log(`HTML report written to ${reportPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`HTML report generation failed: ${message}`);
  }

  console.log(`Run status: ${status}`);

  if (status === 'FAIL') {
    process.exitCode = k6ExitCode && k6ExitCode !== 0 ? k6ExitCode : 1;
  }
}

function startK6(input: {
  skipK6: boolean;
  k6ScriptPath: string;
  testConfigPath: string;
  summaryPath: string;
}): K6RunHandle {
  fs.mkdirSync(path.dirname(input.summaryPath), { recursive: true });

  if (input.skipK6) {
    writeSkippedK6Summary(input.summaryPath, 'Skipped by --skip-k6.');
    return {
      skipped: true,
      reason: 'Skipped by --skip-k6.',
      summaryPath: input.summaryPath,
      completion: Promise.resolve(null),
    };
  }

  if (!fs.existsSync(input.k6ScriptPath)) {
    const reason = `k6 script not found at ${input.k6ScriptPath}. Run npm run build:k6 first.`;
    writeSkippedK6Summary(input.summaryPath, reason);
    console.warn(reason);
    return {
      skipped: true,
      reason,
      summaryPath: input.summaryPath,
      completion: Promise.resolve(null),
    };
  }

  if (!isCommandAvailable('k6')) {
    const reason = 'k6 was not found on PATH.';
    writeSkippedK6Summary(input.summaryPath, reason);
    console.warn(reason);
    console.warn('Playwright capture will still run so browser artifacts can be generated locally.');
    return {
      skipped: true,
      reason,
      summaryPath: input.summaryPath,
      completion: Promise.resolve(null),
    };
  }

  console.log('Starting k6 load generator...');

  const child = spawn(
    'k6',
    [
      'run',
      '-e',
      `TEST_CONFIG_PATH=${input.testConfigPath}`,
      '-e',
      `K6_SUMMARY_PATH=${input.summaryPath}`,
      input.k6ScriptPath,
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    },
  );

  const completion = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  return {
    skipped: false,
    summaryPath: input.summaryPath,
    completion,
    process: child,
  };
}

function parseOptions(args: string[]): OrchestratorOptions {
  const outputRoot = path.resolve(getArgValue(args, '--out') ?? process.env.RESULTS_DIR ?? path.join(process.cwd(), 'results'));
  const runId = getArgValue(args, '--run-id') ?? createRunId();

  return {
    testConfigPath: path.resolve(getArgValue(args, '--config') ?? process.env.TEST_CONFIG_PATH ?? path.join(process.cwd(), 'config/test-config.json')),
    thresholdConfigPath: path.resolve(getArgValue(args, '--thresholds') ?? process.env.THRESHOLDS_CONFIG_PATH ?? path.join(process.cwd(), 'config/thresholds.json')),
    outputRoot,
    runId,
    skipK6: hasFlag(args, '--skip-k6'),
    skipBrowser: hasFlag(args, '--skip-browser'),
    noWarmup: hasFlag(args, '--no-warmup'),
    headless: !hasFlag(args, '--headed'),
    k6ScriptPath: path.resolve(getArgValue(args, '--k6-script') ?? process.env.K6_SCRIPT_PATH ?? path.join(process.cwd(), 'dist/k6/load-test.js')),
  };
}

function determineRunStatus(input: {
  k6Skipped: boolean;
  k6ExitCode: number | null;
  browserSkipped: boolean;
  captureError?: string;
  thresholdsPassed?: boolean;
}): 'PASS' | 'FAIL' | 'PARTIAL' {
  if (input.captureError) {
    return 'FAIL';
  }

  if (input.k6ExitCode !== null && input.k6ExitCode !== 0) {
    return 'FAIL';
  }

  if (input.thresholdsPassed === false) {
    return 'FAIL';
  }

  if (input.k6Skipped || input.browserSkipped) {
    return 'PARTIAL';
  }

  return 'PASS';
}

function writeRunManifest(runDirectory: string, manifest: Record<string, unknown>): void {
  fs.writeFileSync(path.join(runDirectory, 'run-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function writeSkippedK6Summary(summaryPath: string, reason: string): void {
  fs.writeFileSync(
    summaryPath,
    `${JSON.stringify(
      {
        skipped: true,
        reason,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

function logRunPlan(input: {
  runDirectory: string;
  baseUrl: string;
  vus: number;
  duration: string;
  warmupMs: number;
  flows: number;
  pageVisits: number;
  skipK6: boolean;
  skipBrowser: boolean;
}): void {
  console.log(`Created run directory: ${input.runDirectory}`);
  console.log(`Base URL: ${input.baseUrl}`);
  console.log(`Configured k6 load: ${input.vus} VUs for ${input.duration}`);
  console.log(`Warmup: ${input.warmupMs}ms`);
  console.log(`Playwright flows: ${input.flows}`);
  console.log(`Page visits: ${input.pageVisits}`);
  console.log(`Skip k6: ${input.skipK6 ? 'yes' : 'no'}`);
  console.log(`Skip browser: ${input.skipBrowser ? 'yes' : 'no'}`);
}

function isCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ['version'], { stdio: 'ignore' });
  return result.status === 0;
}

function createRunId(date = new Date()): string {
  const safeTimestamp = date.toISOString().replace(/[:.]/g, '-');
  return `run-${safeTimestamp}`;
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

function hasFlag(args: string[], key: string): boolean {
  return args.includes(key);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
