# How to Run the UI Performance Bot

## Prerequisites

- **Java 8 or 11** (JDK)
- **Maven 3.x** (e.g. `brew install maven` on macOS)
- **Node.js** (optional, only if `UserExperience=TRUE` in `config.csv` — for Lighthouse)

## Run from command line

**Important:** Run from the **`PlaywrightLoadTest_v3`** directory so paths resolve correctly.

```bash
cd PlaywrightLoadTest_v3
./run.sh
```

Or with Maven directly:

```bash
cd PlaywrightLoadTest_v3
mvn test-compile exec:java -Dexec.mainClass="PlaywrightUIPageload.Main"
```

If your workspace root is the parent of `PlaywrightLoadTest_v3` (e.g. `PlaywrightLoadTest_V3 2`), ensure these files exist there:

- `config.csv`
- `StaticTestCases.csv` and/or `ScriptedTestCasesFilePath.csv`
- `Results/` (created if missing)

## Configuration

- **config.csv** (in parent directory): `ScriptedFlow`, `UserExperience`, `AutoCrawl`, `CrawlerURL`, `Test_Duration_Seconds`, etc.
- **Properties.properties** (in `src/test/resources/`): paths to config, result directory, and test case files. Uses relative paths (`../`) from `PlaywrightLoadTest_v3` to the parent folder.

## Current config (config.csv)

- `ScriptedFlow=FALSE`, `UserExperience=TRUE`, `AutoCrawl=TRUE` → crawls `CrawlerURL` then runs static UEM (Lighthouse) tests on crawled URLs.
- For a quick run without crawl or Lighthouse: set `AutoCrawl=FALSE` and `UserExperience=FALSE` and use `UserExperienceTestCaseFilePath` in Properties to point to a static URL list.

## Output

- Crawled URLs: `Results/crawled_urls_<runId>.csv`
- Static/UEM report: `Results/Static_RunID_<runId>/Static_Run_Report_RunID_<runId>.csv`
- Scripted report: `Results/ScriptedFlow_Test_<runId>_Results.csv`
