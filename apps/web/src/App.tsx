import { Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import AddSitePage from './pages/AddSitePage';
import InstallPage from './pages/InstallPage';
import VerifyPage from './pages/VerifyPage';
import DashboardPage from './pages/DashboardPage';
import EventsPage from './pages/EventsPage';
import SuspiciousPage from './pages/SuspiciousPage';
import ReportsPage from './pages/ReportsPage';
import AuthLayout from './components/layout/AuthLayout';
import AppShell from './components/layout/AppShell';
import SetupLayout from './components/layout/SetupLayout';
import { RequireAuth } from './api/session';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Public: sirf login + signup */}
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
      </Route>

      {/* After login: dashboard shell (sidebar + topbar). RequireAuth loads the user and sites from the API. */}
      <Route element={<RequireAuth />}>
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/suspicious" element={<SuspiciousPage />} />
        <Route path="/reports" element={<ReportsPage />} />

        {/* Setup steps dashboard ke andar hi */}
        <Route element={<SetupLayout />}>
          <Route path="/sites/new" element={<AddSitePage />} />
          <Route path="/install" element={<InstallPage />} />
          <Route path="/verify" element={<VerifyPage />} />
        </Route>
      </Route>
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}