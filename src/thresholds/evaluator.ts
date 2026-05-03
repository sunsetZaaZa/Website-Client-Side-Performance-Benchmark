import fs from 'node:fs';
import path from 'node:path';
import type { PageThresholds } from '../config/schema';
import type { PageVisitMetadata } from '../playwright/metadata';

export interface ThresholdViolation {
  metric: string;
  actual: number | null;
  expectedMax: number;
  reason: 'exceeded' | 'missing';
}

export interface PageThresholdMetrics {
  totalVisitMs?: number;
  domContentLoadedMs?: number;
  loadEventMs?: number;
  largestContentfulPaintMs?: number;
  failedRequestCount?: number;
  consoleErrorCount?: number;
}

export interface PageThresholdEvaluationResult {
  flowName: string;
  flowLabel: string;
  pageId: string;
  stepIndex: number;
  metrics: PageThresholdMetrics;
  thresholds: PageThresholds;
  passed: boolean;
  violations: ThresholdViolation[];
  evaluatedAt: string;
}

export interface ThresholdSummary {
  generatedAt: string;
  totalPageVisits: number;
  passedPageVisits: number;
  failedPageVisits: number;
  passed: boolean;
  violations: Array<ThresholdViolation & {
    flowName: string;
    flowLabel: string;
    pageId: string;
    stepIndex: number;
  }>;
  results: PageThresholdEvaluationResult[];
}

export function extractPageThresholdMetrics(metadata: PageVisitMetadata): PageThresholdMetrics {
  return {
    totalVisitMs: metadata.timings.totalVisitMs,
    domContentLoadedMs: metadata.timings.domContentLoadedMs,
    loadEventMs: metadata.timings.loadEventMs,
    largestContentfulPaintMs: metadata.timings.largestContentfulPaintMs,
    failedRequestCount: metadata.resources.failedRequestCount,
    consoleErrorCount: metadata.errors.consoleErrors.length,
  };
}

export function evaluatePageThresholds(
  metadata: PageVisitMetadata,
  thresholds: PageThresholds,
): PageThresholdEvaluationResult {
  const metrics = extractPageThresholdMetrics(metadata);
  const violations: ThresholdViolation[] = [];

  for (const [metric, expectedMax] of Object.entries(thresholds)) {
    if (typeof expectedMax !== 'number') {
      continue;
    }

    const actual = metrics[metric as keyof PageThresholdMetrics];

    if (typeof actual !== 'number') {
      violations.push({
        metric,
        actual: null,
        expectedMax,
        reason: 'missing',
      });
      continue;
    }

    if (actual > expectedMax) {
      violations.push({
        metric,
        actual,
        expectedMax,
        reason: 'exceeded',
      });
    }
  }

  return {
    flowName: metadata.flowName,
    flowLabel: metadata.flowLabel,
    pageId: metadata.pageId,
    stepIndex: metadata.stepIndex,
    metrics,
    thresholds,
    passed: violations.length === 0,
    violations,
    evaluatedAt: new Date().toISOString(),
  };
}

export function buildThresholdSummary(results: PageThresholdEvaluationResult[]): ThresholdSummary {
  const violations = results.flatMap((result) =>
    result.violations.map((violation) => ({
      flowName: result.flowName,
      flowLabel: result.flowLabel,
      pageId: result.pageId,
      stepIndex: result.stepIndex,
      ...violation,
    })),
  );

  const failedPageVisits = results.filter((result) => !result.passed).length;

  return {
    generatedAt: new Date().toISOString(),
    totalPageVisits: results.length,
    passedPageVisits: results.length - failedPageVisits,
    failedPageVisits,
    passed: failedPageVisits === 0,
    violations,
    results,
  };
}

export function writeThresholdResult(filePath: string, result: PageThresholdEvaluationResult): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`);
}

export function writeThresholdSummary(filePath: string, results: PageThresholdEvaluationResult[]): ThresholdSummary {
  const summary = buildThresholdSummary(results);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}
