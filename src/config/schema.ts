export type BrowserWaitUntil = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export interface TestConfig {
  baseUrl: string;
  load: LoadConfig;
  browser: BrowserConfig;
  pages: Record<string, PageConfig>;
  flows: FlowConfig[];
}

export interface LoadConfig {
  vus: number;
  duration: string;
  warmupMs: number;
}

export interface BrowserConfig {
  viewport: ViewportConfig;
  fullPageScreenshot: boolean;
  waitUntil: BrowserWaitUntil;
}

export interface ViewportConfig {
  width: number;
  height: number;
}

export interface PageConfig {
  path: string;
  capture: boolean;
}

export interface FlowConfig {
  name: string;
  label: string;
  steps: string[];
}

export interface ThresholdConfig {
  pageThresholds: {
    default: PageThresholds;
    pages: Record<string, PageThresholds>;
  };
}

export interface PageThresholds {
  totalVisitMs?: number;
  domContentLoadedMs?: number;
  loadEventMs?: number;
  largestContentfulPaintMs?: number;
  failedRequestCount?: number;
  consoleErrorCount?: number;
}

export type PageThresholdMetric = keyof PageThresholds;

export interface ResolvedPage {
  id: string;
  path: string;
  url: string;
  capture: boolean;
  thresholds: PageThresholds;
}

export interface ResolvedFlow {
  name: string;
  label: string;
  steps: ResolvedPage[];
}

export interface LoadedProjectConfig {
  testConfig: TestConfig;
  thresholdConfig: ThresholdConfig;
  resolvedPages: Record<string, ResolvedPage>;
  resolvedFlows: ResolvedFlow[];
}

export interface ConfigFilePaths {
  testConfigPath: string;
  thresholdConfigPath: string;
}
