import {
  listDueSchedules, markScheduleRan, ensureReportTables,
} from './reportsStore.js';

/**
 * Poll due schedules and trigger runs via the local API.
 * @param {{ port: number, getAuthHeaders?: () => Record<string, string> }} opts
 */
export function startScheduleTicker({ port }) {
  ensureReportTables().catch(() => {});
  const tick = async () => {
    try {
      const due = await listDueSchedules(new Date());
      for (const schedule of due) {
        try {
          const body = {
            mode: schedule.mode || 'static',
            scriptId: schedule.scriptId || undefined,
            crawlRunId: schedule.crawlRunId || undefined,
            testSuite: schedule.testSuite || undefined,
            config: schedule.configSnapshot && Object.keys(schedule.configSnapshot).length
              ? schedule.configSnapshot
              : undefined,
            scheduledBy: schedule.id,
          };
          const res = await fetch(`http://127.0.0.1:${port}/api/runs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            console.error(`[scheduler] ${schedule.id} failed:`, data.error || res.status);
            // Still bump next_run_at so we don't hot-loop
            await markScheduleRan(schedule.id, null);
            continue;
          }
          const runId = data.runId || data.id;
          await markScheduleRan(schedule.id, runId || null);
          console.log(`[scheduler] ${schedule.name} → run ${runId}`);
        } catch (err) {
          console.error(`[scheduler] ${schedule.id}:`, err.message);
          try {
            await markScheduleRan(schedule.id, null);
          } catch {
            /* ignore */
          }
        }
      }
    } catch (err) {
      console.error('[scheduler] tick failed:', err.message);
    }
  };

  // First tick after 15s, then every 60s
  setTimeout(tick, 15000);
  return setInterval(tick, 60000);
}
