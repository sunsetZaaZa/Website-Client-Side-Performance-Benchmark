import { ConfigValidationError, loadProjectConfigFromArgs } from '../config/loader';

function main(): void {
  const projectConfig = loadProjectConfigFromArgs();

  console.log('Config validation passed.');
  console.log(`Base URL: ${projectConfig.testConfig.baseUrl}`);
  console.log(`Pages: ${Object.keys(projectConfig.resolvedPages).length}`);
  console.log(`Flows: ${projectConfig.resolvedFlows.length}`);

  for (const flow of projectConfig.resolvedFlows) {
    const route = flow.steps.map((step) => `${step.id}(${step.url})`).join(' -> ');
    console.log(`- ${flow.name}: ${route}`);
  }
}

try {
  main();
} catch (error) {
  if (error instanceof ConfigValidationError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
}
