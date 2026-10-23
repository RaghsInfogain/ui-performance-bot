/** Actions that hit the server or wait on a server response (timings are tracked). */
export const SERVER_TIMING_ACTIONS = new Set([
  'Navigate',
  'CalculateFullPageLoadTime',
]);

/**
 * Transaction names are only meaningful for server-bound steps
 * (request going out or response coming back). Client-side steps
 * (clicks, typing, think time, waits, etc.) must leave Transaction blank.
 */
export function isServerTimingStep(step: { action?: string; request?: string | null }): boolean {
  const request = (step.request ?? '').trim();
  if (request.length > 0) return true;
  return SERVER_TIMING_ACTIONS.has(step.action ?? '');
}

/** Clear transaction on client-side steps; keep as-is for server steps. */
export function sanitizeScriptedTransaction<T extends { action?: string; request?: string | null; transactionName?: string }>(
  step: T,
): T {
  if (isServerTimingStep(step)) return step;
  if (!step.transactionName) return step;
  return { ...step, transactionName: '' };
}

export function sanitizeScriptedRows<T extends { action?: string; request?: string | null; transactionName?: string }>(
  rows: T[],
): T[] {
  return rows.map(sanitizeScriptedTransaction);
}
