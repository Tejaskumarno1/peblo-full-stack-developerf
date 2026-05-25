import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import DashboardPage from './pages/DashboardPage';
import WorkspacePage from './pages/WorkspacePage';
import SharedNotePage from './pages/SharedNotePage';
import AiChatPanel from './components/AiChatPanel';

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
      {user ? <AiChatPanel /> : null}
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
