import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluatePageThresholds } from '../src/thresholds/evaluator';
import type { PageVisitMetadata } from '../src/playwright/metadata';

function metadata(overrides: Partial<PageVisitMetadata> = {}): PageVisitMetadata {
  return {
    flowName: 'checkout-flow',
    flowLabel: 'Checkout flow',
    stepIndex: 0,
    pageId: 'checkout',
    url: 'https://example.com/checkout',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    timings: {
      totalVisitMs: 1000,
      domContentLoadedMs: 400,
      loadEventMs: 800,
    },
    resources: {
      requestCount: 3,
      failedRequestCount: 0,
    },
    errors: {
      consoleErrors: [],
      pageErrors: [],
      failedRequests: [],
    },
    ...overrides,
  };
}

test('missing configured metrics fail explicitly instead of passing silently', () => {
  const result = evaluatePageThresholds(metadata(), {
    largestContentfulPaintMs: 1800,
  });

  assert.equal(result.passed, false);
  assert.deepEqual(result.violations, [
    {
      metric: 'largestContentfulPaintMs',
      actual: null,
      expectedMax: 1800,
      reason: 'missing',
    },
  ]);
});

test('available metrics pass when they are below configured thresholds', () => {
  const result = evaluatePageThresholds(metadata({
    timings: {
      totalVisitMs: 1000,
      domContentLoadedMs: 400,
      loadEventMs: 800,
      largestContentfulPaintMs: 900,
    },
  }), {
    totalVisitMs: 1500,
    largestContentfulPaintMs: 1800,
    failedRequestCount: 0,
    consoleErrorCount: 0,
  });

  assert.equal(result.passed, true);
  assert.equal(result.violations.length, 0);
});
