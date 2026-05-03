# syntax=docker/dockerfile:1

# k6 binary provider.
FROM grafana/k6:0.49.0 AS k6bin

# Playwright's official image already contains browser OS dependencies and browsers.
FROM mcr.microsoft.com/playwright:v1.44.1-jammy

WORKDIR /app

ENV CI=true \
    NODE_ENV=development \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copy k6 into the Playwright/Node image so one container can run the whole system.
COPY --from=k6bin /usr/bin/k6 /usr/bin/k6

# Install Node dependencies first for better Docker layer caching.
COPY package*.json ./
RUN npm ci

COPY . .

# Build-time checks catch broken TypeScript or k6 bundle issues early.
RUN npm run typecheck && npm run build:k6

CMD ["npm", "run", "test:perf"]
