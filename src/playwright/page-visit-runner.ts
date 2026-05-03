import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type ConsoleMessage, type Page, type Request } from 'playwright';
import type { BrowserConfig, ResolvedFlow, ResolvedPage } from '../config/schema';
import {
  evaluatePageThresholds,
  type PageThresholdEvaluationResult,
  type ThresholdSummary,
  writeThresholdResult,
  writeThresholdSummary,
} from '../thresholds/evaluator';
import type { BrowserPerformanceSnapshot, FailedRequestRecord, PageVisitMetadata } from './metadata';
import { captureScreenshot } from './screenshots';

export interface PageVisitRunOptions {
  flows: ResolvedFlow[];
  browser: BrowserConfig;
  outputDirectory: string;
  headless?: boolean;
}

export interface PageVisitRunResult {
  pageResults: PageVisitMetadata[];
  thresholdResults: PageThresholdEvaluationResult[];
  thresholdSummary: ThresholdSummary;
  outputDirectory: string;
}

interface VisitArtifacts {
  stepDirectory: string;
  screenshotPath: string;
  metadataPath: string;
  thresholdResultPath: string;
}

export async function runPageVisits(options: PageVisitRunOptions): Promise<PageVisitRunResult> {
  const pagesRoot = path.join(options.outputDirectory, 'pages');
  fs.mkdirSync(pagesRoot, { recursive: true });

  const browser = await chromium.launch({ headless: options.headless ?? true });

  try {
    const context = await browser.newContext({
      viewport: {
        width: options.browser.viewport.width,
        height: options.browser.viewport.height,
      },
    });

    const allResults: PageVisitMetadata[] = [];
    const thresholdResults: PageThresholdEvaluationResult[] = [];

    for (const flow of options.flows) {
      const page = await context.newPage();

      try {
        for (const [stepIndex, step] of flow.steps.entries()) {
          const result = await visitFlowStep({
            page,
            flowName: flow.name,
            flowLabel: flow.label,
            step,
            stepIndex,
            browserConfig: options.browser,
            outputDirectory: options.outputDirectory,
          });

          allResults.push(result.metadata);
          thresholdResults.push(result.thresholdResult);
        }
      } finally {
        await page.close();
      }
    }

    const pageResultsPath = path.join(options.outputDirectory, 'page-results.json');
    fs.writeFileSync(pageResultsPath, `${JSON.stringify(allResults, null, 2)}\n`);

    const thresholdSummary = writeThresholdSummary(
      path.join(options.outputDirectory, 'threshold-summary.json'),
      thresholdResults,
    );

    return {
      pageResults: allResults,
      thresholdResults,
      thresholdSummary,
      outputDirectory: options.outputDirectory,
    };
  } finally {
    await safeClose(browser);
  }
}

async function visitFlowStep(input: {
  page: Page;
  flowName: string;
  flowLabel: string;
  step: ResolvedPage;
  stepIndex: number;
  browserConfig: BrowserConfig;
  outputDirectory: string;
}): Promise<{ metadata: PageVisitMetadata; thresholdResult: PageThresholdEvaluationResult }> {
  const artifacts = buildVisitArtifacts(input.outputDirectory, input.flowName, input.stepIndex, input.step.id);
  fs.mkdirSync(artifacts.stepDirectory, { recursive: true });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: FailedRequestRecord[] = [];
  let requestCount = 0;

  const onRequest = (): void => {
    requestCount += 1;
  };
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  };
  const onPageError = (error: Error): void => {
    pageErrors.push(error.message);
  };
  const onRequestFailed = (request: Request): void => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      failureText: request.failure()?.errorText ?? 'Unknown request failure',
    });
  };

  input.page.on('request', onRequest);
  input.page.on('console', onConsole);
  input.page.on('pageerror', onPageError);
  input.page.on('requestfailed', onRequestFailed);

  const startedAt = new Date();
  const startTime = Date.now();
  let status: number | undefined;
  let navigationError: unknown;

  try {
    try {
      const response = await input.page.goto(input.step.url, {
        waitUntil: input.browserConfig.waitUntil,
      });

      status = response?.status();
    } catch (error) {
      navigationError = error;
      pageErrors.push(error instanceof Error ? error.message : String(error));
    }

    const performanceSnapshot = await readPerformanceSnapshot(input.page);
    const totalVisitMs = Date.now() - startTime;

    if (input.step.capture) {
      await captureScreenshot({
        page: input.page,
        path: artifacts.screenshotPath,
        fullPage: input.browserConfig.fullPageScreenshot,
      });
    }

    const completedAt = new Date();
    const metadata: PageVisitMetadata = {
      flowName: input.flowName,
      flowLabel: input.flowLabel,
      stepIndex: input.stepIndex,
      pageId: input.step.id,
      url: input.step.url,
      finalUrl: safePageUrl(input.page),
      status,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      timings: {
        totalVisitMs,
        ...performanceSnapshot,
      },
      resources: {
        requestCount,
        failedRequestCount: failedRequests.length,
      },
      errors: {
        consoleErrors,
        pageErrors,
        failedRequests,
      },
      screenshot: input.step.capture ? path.relative(input.outputDirectory, artifacts.screenshotPath) : undefined,
      thresholdResult: path.relative(input.outputDirectory, artifacts.thresholdResultPath),
    };

    const thresholdResult = evaluatePageThresholds(metadata, input.step.thresholds);

    fs.writeFileSync(artifacts.metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
    writeThresholdResult(artifacts.thresholdResultPath, thresholdResult);

    if (navigationError) {
      console.warn(`Navigation issue captured for ${input.flowName}[${input.stepIndex}] ${input.step.id}. Metadata was still written.`);
    }

    return { metadata, thresholdResult };
  } finally {
    input.page.off('request', onRequest);
    input.page.off('console', onConsole);
    input.page.off('pageerror', onPageError);
    input.page.off('requestfailed', onRequestFailed);
  }
}

function buildVisitArtifacts(outputDirectory: string, flowName: string, stepIndex: number, pageId: string): VisitArtifacts {
  const stepSlug = `${String(stepIndex).padStart(2, '0')}-${pageId}`;
  const stepDirectory = path.join(outputDirectory, 'pages', flowName, stepSlug);

  return {
    stepDirectory,
    screenshotPath: path.join(stepDirectory, 'screenshot.png'),
    metadataPath: path.join(stepDirectory, 'metadata.json'),
    thresholdResultPath: path.join(stepDirectory, 'threshold-result.json'),
  };
}

async function readPerformanceSnapshot(page: Page): Promise<BrowserPerformanceSnapshot> {
  try {
    return await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      const largestPaint = performance.getEntriesByType('largest-contentful-paint').at(-1) as PerformanceEntry | undefined;

      return {
        domContentLoadedMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : undefined,
        loadEventMs: navigation ? Math.round(navigation.loadEventEnd) : undefined,
        largestContentfulPaintMs: largestPaint ? Math.round(largestPaint.startTime) : undefined,
      };
    });
  } catch {
    return {};
  }
}

function safePageUrl(page: Page): string | undefined {
  try {
    return page.url();
  } catch {
    return undefined;
  }
}

async function safeClose(browser: Browser): Promise<void> {
  try {
    await browser.close();
  } catch {
    // Ignore close errors so the run can still preserve generated artifacts.
  }
}
