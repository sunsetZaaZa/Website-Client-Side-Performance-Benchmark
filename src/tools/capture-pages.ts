import fs from 'node:fs';
import path from 'node:path';
import { loadProjectConfigFromArgs } from '../config/loader';
import { runPageVisits } from '../playwright/page-visit-runner';

async function main(): Promise<void> {
  const projectConfig = loadProjectConfigFromArgs();
  const resultsRoot = process.env.RESULTS_DIR ?? path.join(process.cwd(), 'results');
  const outputDirectory = getArgValue(process.argv.slice(2), '--out') ?? path.resolve(resultsRoot, `capture-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(outputDirectory, { recursive: true });

  const result = await runPageVisits({
    flows: projectConfig.resolvedFlows,
    browser: projectConfig.testConfig.browser,
    outputDirectory,
  });

  console.log(`Captured ${result.pageResults.length} page visits.`);
  console.log(`Output: ${outputDirectory}`);
}

function getArgValue(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
