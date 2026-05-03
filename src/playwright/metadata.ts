export interface PageVisitTimingMetrics {
  domContentLoadedMs?: number;
  loadEventMs?: number;
  totalVisitMs: number;
  largestContentfulPaintMs?: number;
}

export interface FailedRequestRecord {
  url: string;
  method: string;
  resourceType: string;
  failureText: string;
}

export interface PageVisitMetadata {
  flowName: string;
  flowLabel: string;
  stepIndex: number;
  pageId: string;
  url: string;
  finalUrl?: string;
  status?: number;
  startedAt: string;
  completedAt: string;
  timings: PageVisitTimingMetrics;
  resources: {
    requestCount: number;
    failedRequestCount: number;
  };
  errors: {
    consoleErrors: string[];
    pageErrors: string[];
    failedRequests: FailedRequestRecord[];
  };
  screenshot?: string;
  thresholdResult?: string;
}

export interface BrowserPerformanceSnapshot {
  domContentLoadedMs?: number;
  loadEventMs?: number;
  largestContentfulPaintMs?: number;
}
