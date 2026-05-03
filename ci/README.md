# CI/CD Support

Stage 9 adds CI/CD templates for:

- GitHub Actions: `.github/workflows/performance.yml`
- GitLab CI/CD: `.gitlab-ci.yml`
- Azure DevOps Pipelines: `azure-pipelines.yml`

## Pipeline Strategy

Each provider has two lanes:

1. **Validation lane**
   - Runs on pushes and pull/merge requests.
   - Installs dependencies.
   - Validates configuration.
   - Typechecks TypeScript.
   - Bundles the k6 TypeScript source into JavaScript.
   - Uploads the k6 bundle as an artifact when possible.

2. **Performance lane**
   - Runs the Docker-based k6 + Playwright suite.
   - Uploads the `results/` folder as an artifact even when the run fails.
   - Preserves `report.html`, screenshots, metadata, k6 summaries, run summaries, and threshold summaries.

## GitHub Actions

Validation runs automatically on pushes and pull requests for `main` and `master`.

The full performance suite is manual through **workflow_dispatch**:

```text
Actions → Performance CI → Run workflow → run_perf = true
```

Artifacts:

```text
k6-bundle
performance-results
```

## GitLab CI/CD

Validation runs automatically.

The performance job can run in either of two ways:

```text
Set CI/CD variable RUN_PERF_TESTS=true
```

or start the `performance` job manually from the pipeline UI.

Artifacts:

```text
dist/k6/load-test.js
results/
```

The performance job uses Docker-in-Docker and requires a GitLab runner that supports privileged Docker execution.

## Azure DevOps

Validation runs automatically on pushes and pull requests for `main` and `master`.

The performance stage is controlled by the pipeline parameter:

```text
runPerfTests: true
```

Artifacts:

```text
k6-bundle
performance-results
```

## Expected CI Exit Behavior

The orchestrator controls pass/fail behavior:

- `PASS`: k6, Playwright, and page thresholds completed successfully.
- `FAIL`: k6 returned non-zero, Playwright capture failed, or page thresholds failed.
- `PARTIAL`: k6 or browser capture was intentionally or automatically skipped.

The Docker performance lane should fail the CI job when the orchestrator exits non-zero. Artifact publication still runs afterward where the provider supports `always()` / `when: always`.

## Config and Result Paths

The Docker runner expects:

```text
/app/config/test-config.json
/app/config/thresholds.json
/app/results
```

The compose file mounts local paths:

```text
./config  → /app/config:ro
./results → /app/results
```

## Common Customizations

To run against a deployed environment, update `config/test-config.json` before the performance job or replace it as part of the pipeline.

Common examples:

```text
- Commit environment-specific config files.
- Generate config/test-config.json from CI variables.
- Mount a CI-generated config folder into the Docker runner.
- Use separate pipelines for staging, preview, and production smoke tests.
```
