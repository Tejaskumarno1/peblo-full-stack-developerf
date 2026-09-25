import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { Suspense, lazy } from 'react';

// Lazy loaded routes for Code Splitting
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const TodoListPage = lazy(() => import('./pages/TodoListPage'));

// Lazy loaded heavy components for the Authenticated Shell
const AiChatPanel = lazy(() => import('./components/AiChatPanel'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const AiVoiceCallManager = lazy(() => import('./components/AiVoiceCallManager'));

// No accounts in the desktop app — just wait for the local profile to load.
function ProtectedRoute({ children }) {
  const { loading } = useAuth();
  if (loading) return <div className="page-loader"><div className="spinner" /></div>;
  return children;
}

function AuthenticatedShell({ children }) {
  const { user } = useAuth();
  return (
    <>
      {children}
      {user ? (
        <Suspense fallback={null}>
          <AiVoiceCallManager />
          <AiChatPanel />
          <CommandPalette />
        </Suspense>
      ) : null}
    </>
  );
}

export default function App() {
  return (
    <Suspense fallback={<div className="page-loader"><div className="spinner" /></div>}>
      <Routes>
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AuthenticatedShell>
              <DashboardPage />
            </AuthenticatedShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/workspace"
        element={<Navigate to="/notes" />}
      />
      <Route
        path="/notes"
        element={
          <ProtectedRoute>
            <AuthenticatedShell>
              <WorkspacePage />
            </AuthenticatedShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/calendar"
        element={
          <ProtectedRoute>
            <AuthenticatedShell>
              <CalendarPage />
            </AuthenticatedShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/todolist"
        element={
          <ProtectedRoute>
            <AuthenticatedShell>
              <TodoListPage />
            </AuthenticatedShell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/notes/:id"
        element={
          <ProtectedRoute>
            <AuthenticatedShell>
              <WorkspacePage />
            </AuthenticatedShell>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
    </Suspense>
  );
}
