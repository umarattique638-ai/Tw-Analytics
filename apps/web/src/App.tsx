import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/layout/AppShell';
import AuthLayout from './components/layout/AuthLayout';
import SetupLayout from './components/layout/SetupLayout';
import PageLoading from './components/common/PageLoading';
import { RequireAuth, RequireSuperAdmin } from './context/session';

// Each page is its own chunk: the log-in screen does not download the charts.
const ActivityPage = lazy(() => import('./pages/ActivityPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const AdminAccountPage = lazy(() => import('./pages/AdminAccountPage'));
const AddSitePage = lazy(() => import('./pages/AddSitePage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const EventsPage = lazy(() => import('./pages/EventsPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const InstallPage = lazy(() => import('./pages/InstallPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SignupPage = lazy(() => import('./pages/SignupPage'));
const SuspiciousPage = lazy(() => import('./pages/SuspiciousPage'));
const VerifyPage = lazy(() => import('./pages/VerifyPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));

export default function App() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* Public: log in, sign up, forgot / reset password */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
        </Route>

        {/* Signed in: RequireAuth loads the user and their sites, AppShell draws the sidebar. */}
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/suspicious" element={<SuspiciousPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/settings" element={<SettingsPage />} />

            {/* The TailWatch team only (super admins); anyone else goes to the dashboard. */}
            <Route element={<RequireSuperAdmin />}>
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/admin/accounts/:id" element={<AdminAccountPage />} />
            </Route>

            {/* Setup: add a site, install the script, verify */}
            <Route element={<SetupLayout />}>
              <Route path="/sites/new" element={<AddSitePage />} />
              <Route path="/install" element={<InstallPage />} />
              <Route path="/verify" element={<VerifyPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
