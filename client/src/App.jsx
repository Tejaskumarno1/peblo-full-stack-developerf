import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import WorkspacePage from './pages/WorkspacePage';
import WorkspaceHubPage from './pages/WorkspaceHubPage';
import CalendarPage from './pages/CalendarPage';
import TodoListPage from './pages/TodoListPage';
import SharedNotePage from './pages/SharedNotePage';
import AiChatPanel from './components/AiChatPanel';
import CommandPalette from './components/CommandPalette';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loader"><div className="spinner" /></div>;
  return user ? children : <Navigate to="/login" />;
}

function GuestRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="page-loader"><div className="spinner" /></div>;
  return user ? <Navigate to="/" /> : children;
}

function AuthenticatedShell({ children }) {
  const { user } = useAuth();
  return (
    <>
      {children}
      {user ? (
        <>
          <AiChatPanel />
          <CommandPalette />
        </>
      ) : null}
    </>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
      <Route path="/signup" element={<GuestRoute><SignupPage /></GuestRoute>} />
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
      <Route path="/shared/:shareId" element={<SharedNotePage />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
