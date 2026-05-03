import fs from 'node:fs';
import path from 'node:path';
import type {
  BrowserWaitUntil,
  ConfigFilePaths,
  FlowConfig,
  LoadedProjectConfig,
  PageThresholdMetric,
  PageThresholds,
  ResolvedFlow,
  ResolvedPage,
  TestConfig,
  ThresholdConfig,
} from './schema';

const DEFAULT_TEST_CONFIG_PATH = path.join(process.cwd(), 'config/test-config.json');
const DEFAULT_THRESHOLD_CONFIG_PATH = path.join(process.cwd(), 'config/thresholds.json');

const ALLOWED_WAIT_UNTIL = new Set<BrowserWaitUntil>(['load', 'domcontentloaded', 'networkidle', 'commit']);
const ALLOWED_THRESHOLD_METRICS = new Set<PageThresholdMetric>([
  'totalVisitMs',
  'domContentLoadedMs',
  'loadEventMs',
  'largestContentfulPaintMs',
  'failedRequestCount',
  'consoleErrorCount',
]);

export class ConfigValidationError extends Error {
  public readonly issues: string[];

  constructor(issues: string[]) {
    super(`Configuration validation failed:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

export function loadProjectConfig(
  testConfigPath = DEFAULT_TEST_CONFIG_PATH,
  thresholdConfigPath = DEFAULT_THRESHOLD_CONFIG_PATH,
): LoadedProjectConfig {
  const paths: ConfigFilePaths = {
    testConfigPath: path.resolve(testConfigPath),
    thresholdConfigPath: path.resolve(thresholdConfigPath),
  };

  const testConfig = readJsonFile<TestConfig>(paths.testConfigPath);
  const thresholdConfig = readJsonFile<ThresholdConfig>(paths.thresholdConfigPath);

  const issues = [
    ...validateTestConfig(testConfig),
    ...validateThresholdConfig(thresholdConfig, testConfig),
  ];

  if (issues.length > 0) {
    throw new ConfigValidationError(issues);
  }

  const resolvedPages = resolvePages(testConfig, thresholdConfig);

  return {
    testConfig,
    thresholdConfig,
    resolvedPages,
    resolvedFlows: resolveFlows(testConfig, resolvedPages),
  };
}

export function loadProjectConfigFromArgs(args = process.argv.slice(2), env = process.env): LoadedProjectConfig {
  const testConfigPath = getArgValue(args, '--config') ?? env.TEST_CONFIG_PATH ?? DEFAULT_TEST_CONFIG_PATH;
  const thresholdConfigPath = getArgValue(args, '--thresholds') ?? env.THRESHOLDS_CONFIG_PATH ?? DEFAULT_THRESHOLD_CONFIG_PATH;
  return loadProjectConfig(testConfigPath, thresholdConfigPath);
}

function getArgValue(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index === -1) {
    return undefined;
  }

  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new ConfigValidationError([`Missing value for CLI argument ${key}.`]);
  }

  return value;
}

function readJsonFile<T>(filePath: string): T {
  if (!fs.existsSync(filePath)) {
    throw new ConfigValidationError([`Config file not found: ${filePath}`]);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new ConfigValidationError([`Config file is not valid JSON: ${filePath}. ${reason}`]);
  }
}

export function validateTestConfig(config: TestConfig): string[] {
  const issues: string[] = [];

  if (!isObject(config)) {
    return ['test-config.json must contain a JSON object.'];
  }

  if (!isNonEmptyString(config.baseUrl)) {
    issues.push('test-config.json requires a non-empty baseUrl string.');
  } else {
    try {
      const url = new URL(config.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        issues.push('baseUrl must use http or https.');
      }
    } catch {
      issues.push(`baseUrl must be a valid absolute URL. Received: ${config.baseUrl}`);
    }
  }

  if (!isObject(config.load)) {
    issues.push('test-config.json requires a load object.');
  } else {
    if (!Number.isInteger(config.load.vus) || config.load.vus <= 0) {
      issues.push('load.vus must be a positive integer.');
    }
    if (!isNonEmptyString(config.load.duration)) {
      issues.push('load.duration must be a non-empty k6 duration string, for example "2m" or "30s".');
    }
    if (!Number.isInteger(config.load.warmupMs) || config.load.warmupMs < 0) {
      issues.push('load.warmupMs must be a non-negative integer.');
    }
  }

  if (!isObject(config.browser)) {
    issues.push('test-config.json requires a browser object.');
  } else {
    if (!isObject(config.browser.viewport)) {
      issues.push('browser.viewport is required.');
    } else {
      if (!Number.isInteger(config.browser.viewport.width) || config.browser.viewport.width <= 0) {
        issues.push('browser.viewport.width must be a positive integer.');
      }
      if (!Number.isInteger(config.browser.viewport.height) || config.browser.viewport.height <= 0) {
        issues.push('browser.viewport.height must be a positive integer.');
      }
    }
    if (typeof config.browser.fullPageScreenshot !== 'boolean') {
      issues.push('browser.fullPageScreenshot must be boolean.');
    }
    if (!ALLOWED_WAIT_UNTIL.has(config.browser.waitUntil)) {
      issues.push(`browser.waitUntil must be one of: ${Array.from(ALLOWED_WAIT_UNTIL).join(', ')}.`);
    }
  }

  if (!isObject(config.pages) || Object.keys(config.pages).length === 0) {
    issues.push('test-config.json requires at least one page in pages.');
  } else {
    for (const [pageId, page] of Object.entries(config.pages)) {
      if (!isValidId(pageId)) {
        issues.push(`Page id "${pageId}" must contain only letters, numbers, underscores, or hyphens.`);
      }
      if (!isObject(page)) {
        issues.push(`Page "${pageId}" must be an object.`);
        continue;
      }
      if (!isNonEmptyString(page.path)) {
        issues.push(`Page "${pageId}" requires a non-empty path.`);
      } else if (isNonEmptyString(config.baseUrl)) {
        try {
          new URL(page.path, config.baseUrl);
        } catch {
          issues.push(`Page "${pageId}" path could not be resolved against baseUrl.`);
        }
      }
      if (typeof page.capture !== 'boolean') {
        issues.push(`Page "${pageId}" capture must be boolean.`);
      }
    }
  }

  if (!Array.isArray(config.flows) || config.flows.length === 0) {
    issues.push('test-config.json requires at least one flow.');
  } else {
    const flowNames = new Set<string>();
    for (const flow of config.flows) {
      issues.push(...validateFlow(config, flow, flowNames));
    }
  }

  return issues;
}

function validateFlow(config: TestConfig, flow: FlowConfig, flowNames: Set<string>): string[] {
  const issues: string[] = [];

  if (!isObject(flow)) {
    return ['Each flow must be an object.'];
  }

  if (!isNonEmptyString(flow.name)) {
    issues.push('Each flow requires a non-empty name.');
  } else {
    if (!isValidId(flow.name)) {
      issues.push(`Flow name "${flow.name}" must contain only letters, numbers, underscores, or hyphens.`);
    }
    if (flowNames.has(flow.name)) {
      issues.push(`Flow name "${flow.name}" is duplicated.`);
    }
    flowNames.add(flow.name);
  }

  if (!isNonEmptyString(flow.label)) {
    issues.push(`Flow "${flow.name ?? '<unnamed>'}" requires a non-empty label.`);
  }

  if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
    issues.push(`Flow "${flow.name ?? '<unnamed>'}" requires at least one step.`);
  } else {
    flow.steps.forEach((pageId, index) => {
      if (!isNonEmptyString(pageId)) {
        issues.push(`Flow "${flow.name}" step ${index} must be a page id string.`);
        return;
      }
      if (!config.pages?.[pageId]) {
        issues.push(`Flow "${flow.name}" references unknown page "${pageId}" at step ${index}.`);
      }
    });
  }

  return issues;
}

export function validateThresholdConfig(config: ThresholdConfig, testConfig?: TestConfig): string[] {
  const issues: string[] = [];

  if (!isObject(config)) {
    return ['thresholds.json must contain a JSON object.'];
  }

  if (!isObject(config.pageThresholds)) {
    issues.push('thresholds.json requires pageThresholds.');
    return issues;
  }

  if (!isObject(config.pageThresholds.default)) {
    issues.push('thresholds.json requires pageThresholds.default.');
  } else {
    issues.push(...validatePageThresholds('pageThresholds.default', config.pageThresholds.default));
  }

  if (!isObject(config.pageThresholds.pages)) {
    issues.push('thresholds.json requires pageThresholds.pages. Use an empty object when no page overrides are needed.');
  } else {
    for (const [pageId, thresholds] of Object.entries(config.pageThresholds.pages)) {
      if (testConfig?.pages && !testConfig.pages[pageId]) {
        issues.push(`thresholds.json has override for unknown page "${pageId}".`);
      }
      issues.push(...validatePageThresholds(`pageThresholds.pages.${pageId}`, thresholds));
    }
  }

  return issues;
}

function validatePageThresholds(location: string, thresholds: PageThresholds): string[] {
  const issues: string[] = [];

  if (!isObject(thresholds)) {
    return [`${location} must be an object.`];
  }

  for (const [metric, value] of Object.entries(thresholds)) {
    if (!ALLOWED_THRESHOLD_METRICS.has(metric as PageThresholdMetric)) {
      issues.push(`${location}.${metric} is not a supported page threshold metric.`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      issues.push(`${location}.${metric} must be a non-negative number.`);
    }
  }

  return issues;
}

function resolvePages(config: TestConfig, thresholdConfig: ThresholdConfig): Record<string, ResolvedPage> {
  return Object.fromEntries(
    Object.entries(config.pages).map(([pageId, page]) => [
      pageId,
      {
        id: pageId,
        path: page.path,
        url: new URL(page.path, config.baseUrl).toString(),
        capture: page.capture,
        thresholds: resolvePageThresholds(thresholdConfig, pageId),
      },
    ]),
  );
}

function resolveFlows(config: TestConfig, resolvedPages: Record<string, ResolvedPage>): ResolvedFlow[] {
  return config.flows.map((flow) => ({
    name: flow.name,
    label: flow.label,
    steps: flow.steps.map((pageId) => resolvedPages[pageId]),
  }));
}

export function resolvePageThresholds(thresholdConfig: ThresholdConfig, pageId: string): PageThresholds {
  return {
    ...thresholdConfig.pageThresholds.default,
    ...(thresholdConfig.pageThresholds.pages[pageId] ?? {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}
