# k6 + Playwright Performance Capture System

A TypeScript-first performance testing system that uses k6 for HTTP/HTTPS load generation and Playwright for browser-level navigation, screenshots, page metadata, page-only threshold evaluation, and self-contained HTML reporting.

This repository currently implements **Stage 9: CI/CD Ready**.

## Current Stage

Stage 9 includes everything from Stages 1 through 8, plus CI/CD support for GitHub Actions, GitLab CI/CD, and Azure DevOps:

- GitHub Actions workflow at `.github/workflows/performance.yml`
- GitLab CI/CD pipeline at `.gitlab-ci.yml`
- Azure DevOps pipeline at `azure-pipelines.yml`
- Always-on validation lanes for config validation, TypeScript typecheck, and k6 bundling
- Docker-based performance lanes for full k6 + Playwright execution
- Artifact publication for `results/` so `report.html`, screenshots, metadata, and summaries survive failed runs
- `ci:verify`, `ci:perf`, and Docker CI helper scripts
- All Stage 8 Docker execution features remain included

## Core Design Rules

1. k6 generates protocol-level load.
2. Playwright captures browser-level behavior.
3. TypeScript is the primary source language.
4. k6 scripts are authored in TypeScript, bundled to JavaScript, then executed by k6.
5. Pages are reusable config entries.
6. Flows define sequential navigation paths.
7. Secondary, third, and future routes are represented as separate flows.
8. Thresholds apply only to individual page visits.
9. Flow duration is not thresholded by default.
10. Docker is the recommended execution layer.
11. Every run outputs JSON artifacts and a self-contained HTML report.

## Project Structure

```text
perf-system/
  config/
    test-config.json
    thresholds.json

  src/
    orchestrator/
      run-test.ts

    playwright/
      page-visit-runner.ts
      metadata.ts
      screenshots.ts

    k6/
      k6-globals.d.ts
      load-test.ts

    config/
      schema.ts
      loader.ts

    thresholds/
      evaluator.ts

    reporting/
      report-generator.ts
      templates/
        base.html

    tools/
      validate-config.ts
      capture-pages.ts

  dist/
    k6/
      load-test.js

  results/
    run-<timestamp>/
      report.html
      run-manifest.json
      run-summary.json
      k6-summary.json
      page-results.json
      threshold-summary.json
      pages/
        <flow-name>/
          00-<page-id>/
            screenshot.png
            metadata.json
            threshold-result.json

  Dockerfile
  docker-compose.yml
  package.json
  tsconfig.json
```

Additional CI/CD files:

```text
.github/workflows/performance.yml
.gitlab-ci.yml
azure-pipelines.yml
ci/README.md
```

## Install

```bash
npm install
```

## Validate Config

```bash
npm run validate:config
```

Optional alternate config paths:

```bash
npm run validate:config -- --config config/test-config.json --thresholds config/thresholds.json
```

The validator checks:

```text
- baseUrl is absolute HTTP/HTTPS
- load.vus is a positive integer
- load.duration is present
- load.warmupMs is non-negative
- browser viewport values are positive integers
- browser.waitUntil is supported
- every page has a valid id, path, and capture flag
- every flow has a unique name and valid steps
- every flow step references an existing page
- threshold overrides only reference existing pages
- threshold metric names are supported
- threshold values are non-negative numbers
```

## Type Check and Build

```bash
npm run typecheck
npm run build
npm run build:k6
```

`build:k6` creates:

```text
dist/k6/load-test.js
```

k6 cannot execute TypeScript directly, so this bundle is required.

## Run the Full Orchestrator

```bash
npm run test:perf
```

This command:

```text
1. Builds the k6 bundle
2. Loads and validates configs
3. Creates results/run-<timestamp>/
4. Writes run-manifest.json
5. Starts k6 if available
6. Waits load.warmupMs
7. Runs Playwright captures across all configured flows
8. Writes screenshots, metadata, page-results.json, threshold-result.json files, and threshold-summary.json
9. Waits for k6 completion
10. Writes run-summary.json
11. Generates report.html
```

If k6 is not installed, the orchestrator writes a skipped `k6-summary.json`, still runs Playwright captures, and marks the run as `PARTIAL` unless thresholds or browser capture fail.

Useful partial-run commands:

```bash
npm run test:perf:no-k6
npm run test:perf:k6-only
npm run orchestrator:run -- --skip-k6 --no-warmup
```

Orchestrator options:

```text
--config <path>       Path to test-config.json
--thresholds <path>   Path to thresholds.json
--out <path>          Output root directory. Defaults to ./results
--run-id <id>         Custom run id. Defaults to timestamped run id
--k6-script <path>    Path to bundled k6 JavaScript file
--skip-k6             Do not start k6
--skip-browser        Do not run Playwright captures
--no-warmup           Skip warmup wait before Playwright capture
--headed              Run Playwright with a visible browser window
```

CLI arguments take precedence over environment variables. The orchestrator also honors:

```text
TEST_CONFIG_PATH        Default path to test-config.json
THRESHOLDS_CONFIG_PATH  Default path to thresholds.json
RESULTS_DIR             Default output root for run artifacts and reports
K6_SCRIPT_PATH          Default path to the bundled k6 JavaScript file
```

Run status values:

```text
PASS     k6, Playwright, and thresholds completed successfully
FAIL     k6 returned non-zero, Playwright capture failed, or a page threshold failed
PARTIAL  k6 or browser capture was intentionally or automatically skipped
```

## Run k6 Directly

Requires `k6` installed on PATH.

```bash
npm run k6:run
```

This command:

```text
1. Builds dist/k6/load-test.js
2. Runs k6 against config/test-config.json
3. Writes k6 summary JSON to results/k6-summary.json
```

## Run Playwright Capture Only

```bash
npm run playwright:capture
```

Optional output directory:

```bash
npm run playwright:capture -- --out results/manual-capture
```

This command:

```text
1. Loads and validates config
2. Opens Chromium through Playwright
3. Visits every configured flow step sequentially
4. Writes screenshots, metadata files, page-results.json, threshold-result.json files, and threshold-summary.json
```

## Generate an HTML Report

The orchestrator generates `report.html` automatically, but you can regenerate a report for an existing run:

```bash
npm run report -- --run-dir results/run-<timestamp>
```

If `--run-dir` is omitted, the report CLI uses the most recently modified `results/run-*` directory:

```bash
npm run report
```

Optional output path:

```bash
npm run report -- --run-dir results/run-<timestamp> --out results/run-<timestamp>/custom-report.html
```

The report is self-contained and can be opened directly in a browser. It uses inline CSS and relative links to screenshots in the run directory.


## Docker Usage

Build the container image:

```bash
npm run docker:build
```

Run the full performance workflow in Docker:

```bash
npm run docker:run
```

Equivalent direct compose command:

```bash
docker compose run --rm perf-runner
```

Validate config inside the container:

```bash
npm run docker:validate
```

Run browser capture without k6 inside the container:

```bash
npm run docker:run:no-k6
```

Docker mounts:

```yaml
./config:/app/config:ro
./results:/app/results
```

The config directory is read-only inside the container. The results directory is writable so screenshots, metadata, summaries, threshold results, and `report.html` are available on the host after execution. Compose sets `TEST_CONFIG_PATH`, `THRESHOLDS_CONFIG_PATH`, and `RESULTS_DIR`, and the CLI tools read those values by default.

When testing a service running on the host machine through Docker Desktop, set `baseUrl` to something reachable from inside the container, such as:

```json
{
  "baseUrl": "http://host.docker.internal:3000"
}
```

When testing another compose service, put both services on the same compose network and use the service name:

```json
{
  "baseUrl": "http://target-app:3000"
}
```

## Config Model

Pages are reusable definitions:

```json
"pages": {
  "home": {
    "path": "/",
    "capture": true
  }
}
```

Flows define sequential navigation:

```json
"flows": [
  {
    "name": "primary-checkout-path",
    "label": "Home → Pricing → Checkout",
    "steps": ["home", "pricing", "checkout"]
  }
]
```

k6 uses flow steps as load targets and tags each request with its flow/page context. Playwright separately visits the same configured flow steps in sequence and records browser artifacts.

## Threshold Rule

Thresholds are page-only.

They apply to a single page visit, not the cumulative duration of a flow.

```text
Evaluate: home page load
Do not evaluate: home → pricing → checkout total time
```

Supported page threshold metrics:

```text
totalVisitMs
domContentLoadedMs
loadEventMs
largestContentfulPaintMs
failedRequestCount
consoleErrorCount
```

Each page step writes:

```text
metadata.json
threshold-result.json
```

The run root also receives:

```text
threshold-summary.json
```

The orchestrator marks the run as `FAIL` if any page threshold fails.

`largestContentfulPaintMs` is intentionally strict: if you configure an LCP threshold and the browser does not emit an LCP entry for that automated visit, the evaluator records a `missing` violation instead of passing silently. See `docs/METRICS.md` before enabling LCP thresholds on pages that render late, paint only after user interaction, or do not have stable visible content in automation.

## k6 Runtime Environment Variables

The bundled k6 file supports:

```text
TEST_CONFIG_PATH   Path to test-config.json. Defaults to ./config/test-config.json.
K6_SUMMARY_PATH    Path where k6 raw summary JSON should be written. Defaults to k6-summary.json.
K6_SLEEP_SECONDS   Delay between k6 iterations. Defaults to 1.
K6_REQUEST_TIMEOUT Request timeout. Defaults to 30s.
```

Example:

```bash
k6 run \
  -e TEST_CONFIG_PATH=./config/test-config.json \
  -e K6_SUMMARY_PATH=./results/k6-summary.json \
  dist/k6/load-test.js
```

## Stage Roadmap

### Stage 1: Project Skeleton

Completed.

### Stage 2: Config Types and Loader Hardening

Completed.

Implemented stronger validation and richer derived config:

- Validate URL format
- Validate load settings
- Validate browser settings
- Validate page ids
- Validate threshold metric names and values
- Validate threshold page IDs
- Validate duplicate flow names
- Resolve page paths into absolute URLs
- Merge default thresholds with page-specific overrides
- Add user-friendly validation messages

### Stage 3: Basic k6 Load Test

Completed.

Implemented:

- Config-driven k6 load generator
- TypeScript-to-JavaScript bundle for k6
- k6 request tagging
- k6 checks
- k6 summary export
- Orchestrator k6 launch support

### Stage 4: Basic Playwright Capture

Completed.

Implemented:

- Navigate each flow step sequentially
- Capture screenshots
- Capture timing metadata
- Capture console/page/request errors
- Save per-step artifacts
- Save aggregated page-results.json

### Stage 5: Orchestrator

Completed.

Implemented:

- Timestamped run directories
- run-manifest.json
- k6 lifecycle management
- warmup handling
- partial run modes
- run-summary.json

### Stage 6: Threshold Evaluator

Completed.

Implemented:

- Page-level threshold evaluation
- default + page-specific threshold merging
- threshold-result.json per page step
- threshold-summary.json per run
- orchestrator failure on threshold violations

### Stage 7: HTML Report

Completed.

Implemented:

- Self-contained report.html generation
- report CLI for existing runs
- run summary cards
- flow overview
- per-page screenshot/metric/threshold cards
- browser error details
- k6 summary snapshot
- embedded JSON payload

### Stage 8: Docker

Completed in this archive.

Implemented:

- Playwright Docker base image
- k6 binary from official Grafana image
- docker-compose workflow
- mounted config and results folders
- Docker helper scripts
- browser-only and config-validation compose profiles

### Stage 9: CI/CD Ready

Completed.

Implemented:

- `ci:verify`, `ci:perf`, and Docker CI helper commands
- Results artifact upload in GitHub Actions, GitLab CI/CD, and Azure DevOps templates
- Exit code behavior based on k6, Playwright, and threshold failures
- Docker-based performance lanes for consistent browser dependencies

## CI/CD Support

Stage 9 adds CI/CD templates for GitHub Actions, GitLab CI/CD, and Azure DevOps.

Validation jobs run on normal source-control events and execute:

```bash
npm ci
npm run ci:verify
```

`ci:verify` performs:

```text
- config validation
- TypeScript typecheck
- unit tests
- k6 bundle generation
```

The full performance suite is Docker-based:

```bash
docker compose build perf-runner
docker compose run --rm perf-runner
```

CI performance jobs upload the `results/` folder as an artifact so the generated `report.html`, screenshots, metadata, k6 summaries, run summaries, and threshold summaries remain available even when thresholds fail.

Provider files:

```text
GitHub Actions: .github/workflows/performance.yml
GitLab CI/CD:   .gitlab-ci.yml
Azure DevOps:   azure-pipelines.yml
CI notes:       ci/README.md
```

GitHub performance runs are triggered manually through workflow dispatch. GitLab performance runs can be started manually or by setting `RUN_PERF_TESTS=true`. Azure DevOps performance runs are controlled by the `runPerfTests` pipeline parameter.

## License

This project is licensed under the BSD Zero Clause License. See [`LICENSE`](./LICENSE) for details.
