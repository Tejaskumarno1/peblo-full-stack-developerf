import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { useAuth } from './context/AuthContext';
import AppShell from './components/shell/AppShell';

// Pages load on demand
const HomePage = lazy(() => import('./pages/HomePage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const AIHubPage = lazy(() => import('./pages/AIHubPage'));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'));
const QuickCapturePage = lazy(() => import('./pages/QuickCapturePage'));

// Global helpers that live beside every screen
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const AiVoiceCallManager = lazy(() => import('./components/AiVoiceCallManager'));

const Loader = () => <div className="page-loader"><div className="spinner" /></div>;

/** No accounts in the desktop app: wait for the local profile, then show the app shell. */
function ShellLayout() {
  const { loading } = useAuth();
  if (loading) return <Loader />;
  return (
    <AppShell>
      <Suspense fallback={<Loader />}><Outlet /></Suspense>
      <Suspense fallback={null}>
        <AiVoiceCallManager />
        <CommandPalette />
      </Suspense>
    </AppShell>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route element={<ShellLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/notes" element={<WorkspacePage />} />
          <Route path="/notes/:id" element={<WorkspacePage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/ai" element={<AIHubPage />} />
          <Route path="/ai/connections" element={<ConnectionsPage />} />
        </Route>
        <Route path="/quick-capture" element={<QuickCapturePage />} />
        <Route path="/workspace" element={<Navigate to="/notes" replace />} />
        <Route path="/todolist" element={<Navigate to="/tasks" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
