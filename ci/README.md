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


## Dependency Install Hardening

The validation lanes pin the npm CLI and run `npm run ci:install` instead of a bare `npm ci`. This wrapper sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, verifies that `package-lock.json` does not point at an internal/private registry, installs from the lockfile through `https://registry.npmjs.org/`, and verifies that the expected local binaries exist afterward.

This is intentional for CI validation because the validation job only needs TypeScript, tests, and the k6 bundle. Browser binaries are supplied by the Docker performance image for full performance runs, so downloading browsers during validation is unnecessary and can make hosted CI installs slow or flaky.

The verified local binaries are:

```text
ts-node
tsc
esbuild
playwright
```

`package-lock.json` should keep public npm tarball URLs in its `resolved` fields. If a private registry is intentional, set `NPM_LOCKFILE_ALLOWED_HOSTS` to a comma-separated allow-list in the pipeline environment. Otherwise, regenerate or normalize the lockfile before committing.

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
