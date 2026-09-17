import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { LegacyRunRedirect } from './auth/LegacyRunRedirect';
import { AppLayout } from './components/layout/AppLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Configuration from './pages/Configuration';
import Crawler from './pages/Crawler';
import TestCases from './pages/TestCases';
import RunTest from './pages/RunTest';
import Runs from './pages/Runs';
import RunDetail from './pages/RunDetail';
import RunReport from './pages/RunReport';
import ScriptStudio from './pages/ScriptStudio';
import Reports from './pages/Reports';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/app" element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="configuration" element={<Configuration />} />
              <Route path="crawler" element={<Crawler />} />
              <Route path="test-cases" element={<TestCases />} />
              <Route path="script-studio" element={<ScriptStudio />} />
              <Route path="run-test" element={<RunTest />} />
              <Route path="runs" element={<Runs />} />
              <Route path="runs/:runId" element={<RunDetail />} />
              <Route path="runs/:runId/report" element={<RunReport />} />
              <Route path="reports" element={<Reports />} />
            </Route>
          </Route>

          <Route path="/configuration" element={<Navigate to="/app/configuration" replace />} />
          <Route path="/crawler" element={<Navigate to="/app/crawler" replace />} />
          <Route path="/test-cases" element={<Navigate to="/app/test-cases" replace />} />
          <Route path="/script-studio" element={<Navigate to="/app/script-studio" replace />} />
          <Route path="/run-test" element={<Navigate to="/app/run-test" replace />} />
          <Route path="/runs" element={<Navigate to="/app/runs" replace />} />
          <Route path="/runs/:runId/report" element={<LegacyRunRedirect report />} />
          <Route path="/runs/:runId" element={<LegacyRunRedirect />} />
          <Route path="/reports" element={<Navigate to="/app/reports" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
