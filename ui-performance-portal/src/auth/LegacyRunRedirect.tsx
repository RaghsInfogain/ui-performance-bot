import { Navigate, useParams } from 'react-router-dom';

/** Redirect old deep links like /runs/1042 → /app/runs/1042 */
export function LegacyRunRedirect({ report = false }: { report?: boolean }) {
  const { runId } = useParams<{ runId: string }>();
  if (!runId) return <Navigate to="/app/runs" replace />;
  return <Navigate to={report ? `/app/runs/${runId}/report` : `/app/runs/${runId}`} replace />;
}
