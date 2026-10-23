# UI Performance Bot — portal (React/Vite) + API (Express) + test engine (Java Playwright)
# + report analyzer (Python) + Lighthouse, in one image. PostgreSQL runs beside it
# (see docker-compose.yml). Builds natively on amd64 and arm64.

# ---- 1. Build the portal ----
FROM node:22-bookworm AS portal
WORKDIR /app/ui-performance-portal
COPY ui-performance-portal/package*.json ./
RUN npm ci
COPY ui-performance-portal/ ./
RUN npm run build

# ---- 2. Runtime ----
FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
      default-jdk-headless maven python3 chromium curl \
    && rm -rf /var/lib/apt/lists/*
# PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: browsers are installed below at build time; without it
# the engine's Playwright retries downloads (incl. Firefox/WebKit) on every start.
ENV JAVA_HOME=/usr/lib/jvm/default-java \
    CHROME_PATH=/usr/bin/chromium \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production \
    PORT=3002
WORKDIR /app

# Test engine: fetch dependencies and compile once, so a test run doesn't wait on Maven,
# then download the Chromium build its Playwright version expects. No --with-deps here:
# Playwright 1.28 doesn't know Debian 12 and would try Ubuntu packages. The system
# libraries Chromium needs come from the chromium package above and the portal's
# newer Playwright (--with-deps, Debian 12 supported) below.
COPY PlaywrightLoadTest_v3/pom.xml PlaywrightLoadTest_v3/
RUN cd PlaywrightLoadTest_v3 && mvn -B -q dependency:go-offline
COPY PlaywrightLoadTest_v3/ PlaywrightLoadTest_v3/
RUN cd PlaywrightLoadTest_v3 \
 && mvn -B -q test-compile dependency:build-classpath -Dmdep.outputFile=/tmp/engine.cp \
 && java -cp "$(cat /tmp/engine.cp)" com.microsoft.playwright.CLI install chromium

# API + the portal built in stage 1
COPY ui-performance-portal/package*.json ui-performance-portal/
RUN cd ui-performance-portal && npm ci --omit=dev \
 && npx playwright install --with-deps chromium
COPY ui-performance-portal/ ui-performance-portal/
COPY --from=portal /app/ui-performance-portal/dist ui-performance-portal/dist
COPY config.csv StaticTestCases.csv ScriptedTestCasesFilePath.csv ./

EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:3002/api/health || exit 1
CMD ["node", "--max-old-space-size=1024", "ui-performance-portal/server/index.js"]
