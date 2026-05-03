import { check, sleep } from 'k6';
import http, { type Response } from 'k6/http';

interface TestConfig {
  baseUrl: string;
  load: {
    vus: number;
    duration: string;
    warmupMs: number;
  };
  pages: Record<string, PageConfig>;
  flows: FlowConfig[];
}

interface PageConfig {
  path: string;
  capture: boolean;
}

interface FlowConfig {
  name: string;
  label: string;
  steps: string[];
}

interface LoadTarget {
  pageId: string;
  flowName: string;
  stepIndex: number;
  url: string;
}

const configPath = __ENV.TEST_CONFIG_PATH ?? './config/test-config.json';
const config = JSON.parse(open(configPath)) as TestConfig;
const targets = buildLoadTargets(config);
const sleepSeconds = parsePositiveNumber(__ENV.K6_SLEEP_SECONDS, 1);
const requestTimeout = __ENV.K6_REQUEST_TIMEOUT ?? '30s';

export const options = {
  vus: config.load.vus,
  duration: config.load.duration,
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
};

export default function loadTest(): void {
  const target = targets[__ITER % targets.length];

  const response = http.get(target.url, {
    timeout: requestTimeout,
    tags: {
      page_id: target.pageId,
      flow_name: target.flowName,
      step_index: String(target.stepIndex),
    },
  });

  check(
    response,
    {
      'status is not 5xx': (res) => (res as Response).status < 500,
      'status is successful or redirected': (res) => {
        const status = (res as Response).status;
        return status >= 200 && status < 400;
      },
    },
    {
      page_id: target.pageId,
      flow_name: target.flowName,
    },
  );

  sleep(sleepSeconds);
}

export function handleSummary(data: unknown): Record<string, string> {
  const summaryPath = __ENV.K6_SUMMARY_PATH ?? 'k6-summary.json';
  const payload = JSON.stringify(data, null, 2);

  return {
    [summaryPath]: payload,
    stdout: buildStdoutSummary(data, summaryPath),
  };
}

function buildLoadTargets(testConfig: TestConfig): LoadTarget[] {
  const targetsFromFlows = testConfig.flows.flatMap((flow) =>
    flow.steps.map((pageId, stepIndex) => {
      const page = testConfig.pages[pageId];

      if (!page) {
        throw new Error(`Flow "${flow.name}" references unknown page "${pageId}".`);
      }

      return {
        pageId,
        flowName: flow.name,
        stepIndex,
        url: new URL(page.path, testConfig.baseUrl).toString(),
      } satisfies LoadTarget;
    }),
  );

  const uniqueTargets = new Map<string, LoadTarget>();

  for (const target of targetsFromFlows) {
    const key = `${target.flowName}:${target.stepIndex}:${target.pageId}`;
    uniqueTargets.set(key, target);
  }

  if (uniqueTargets.size === 0) {
    throw new Error('No k6 load targets were created from the configured flows.');
  }

  return Array.from(uniqueTargets.values());
}

function parsePositiveNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildStdoutSummary(data: unknown, summaryPath: string): string {
  const targetLines = targets.map((target) => `- ${target.flowName}[${target.stepIndex}] ${target.pageId}: ${target.url}`);

  return [
    '',
    'k6 load test completed.',
    `Config: ${configPath}`,
    `Summary: ${summaryPath}`,
    `Targets: ${targets.length}`,
    ...targetLines,
    '',
    'Raw summary JSON was written to the configured summary path.',
    '',
  ].join('\n');
}
