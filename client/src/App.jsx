import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import { useAuth } from './context/AuthContext';
import AppShell from './components/shell/AppShell';
import AuthScreen from './components/AuthScreen';
import SeriesScopeDialog from './components/SeriesScopeDialog';

// Pages load on demand
const HomePage = lazy(() => import('./pages/HomePage'));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const TasksPage = lazy(() => import('./pages/TasksPage'));
const AIHubPage = lazy(() => import('./pages/AIHubPage'));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage'));
const QuickCapturePage = lazy(() => import('./pages/QuickCapturePage'));

// Soft Studio has its own screens (only used when Settings > Style is Soft Studio)
const SoftHome = lazy(() => import('./soft/SoftHome'));
const SoftNotes = lazy(() => import('./soft/SoftNotes'));
const SoftTasks = lazy(() => import('./soft/SoftTasks'));
const SoftCalendar = lazy(() => import('./soft/SoftCalendar'));
const SoftAI = lazy(() => import('./soft/SoftAI'));
const SoftConnections = lazy(() => import('./soft/SoftConnections'));

// River: one timeline. Tasks and Calendar are the river itself, at Day and Week zoom.
const RiverHome = lazy(() => import('./river/RiverHome'));
const RiverNotes = lazy(() => import('./river/RiverNotes'));
const RiverAI = lazy(() => import('./river/RiverAI').then((m) => ({ default: m.RiverAI })));
const RiverConnections = lazy(() => import('./river/RiverAI').then((m) => ({ default: m.RiverConnections })));
const RiverTasks = lazy(() => import('./river/RiverHome').then((m) => ({ default: () => <m.default initialZoom="day" /> })));
const RiverCalendar = lazy(() => import('./river/RiverHome').then((m) => ({ default: () => <m.default initialZoom="week" /> })));

// Orbit: a map of what you know. Notes, quizzes and the due list open as sheets over the map.
const OrbitHome = lazy(() => import('./orbit/OrbitAI').then((m) => ({ default: m.OrbitHome })));
const OrbitNotes = lazy(() => import('./orbit/OrbitNotes'));
const OrbitQuiz = lazy(() => import('./orbit/OrbitQuiz'));
const OrbitTasks = lazy(() => import('./orbit/OrbitDue').then((m) => ({ default: () => <m.default view="list" /> })));
const OrbitCalendar = lazy(() => import('./orbit/OrbitDue').then((m) => ({ default: () => <m.default view="week" /> })));
const OrbitAI = lazy(() => import('./orbit/OrbitAI').then((m) => ({ default: m.OrbitAI })));
const OrbitConnections = lazy(() => import('./orbit/OrbitAI').then((m) => ({ default: m.OrbitConnections })));
const GoHome = () => <Navigate to="/" replace />;

// Global helpers that live beside every screen
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const AiVoiceCallManager = lazy(() => import('./components/AiVoiceCallManager'));

const Loader = () => <div className="page-loader"><div className="spinner" /></div>;

/** Picks the screen for the current style. Studio and Console share pages; the others have their own. */
function Styled({ other: Other, ...byStyle }) {
  const { uiStyle } = useAuth();
  const Screen = byStyle[uiStyle] || Other;
  return <Screen />;
}

/** Wait for the account to load, then show the app shell (or the sign-in screen when nobody is signed in). */
function ShellLayout() {
  const { loading, user } = useAuth();
  if (loading) return <Loader />;
  if (!user) return <AuthScreen />;
  return (
    <AppShell>
      <Suspense fallback={<Loader />}><Outlet /></Suspense>
      <Suspense fallback={null}>
        <AiVoiceCallManager />
        <SeriesScopeDialog />
        <CommandPalette />
      </Suspense>
    </AppShell>
  );
}

/** The quick-capture window needs an account to save into. */
function CaptureGate() {
  const { loading, user } = useAuth();
  if (loading) return null;
  if (!user) {
    return (
      <div style={{ padding: 24, font: '14px/1.45 var(--pb-font)', color: 'var(--pb-fg-2)', background: 'var(--pb-bg)', height: '100%', boxSizing: 'border-box' }}>
        <strong style={{ color: 'var(--pb-fg)' }}>Sign in to Peblo first.</strong><br />
        Open the Peblo window, sign in, then press this shortcut again.
      </div>
    );
  }
  return <QuickCapturePage />;
}

export default function App() {
  return (
    <Suspense fallback={<Loader />}>
      <Routes>
        <Route element={<ShellLayout />}>
          <Route path="/" element={<Styled soft={SoftHome} river={RiverHome} orbit={OrbitHome} other={HomePage} />} />
          <Route path="/notes" element={<Styled soft={SoftNotes} river={RiverNotes} orbit={OrbitNotes} other={WorkspacePage} />} />
          <Route path="/notes/:id" element={<Styled soft={SoftNotes} river={RiverNotes} orbit={OrbitNotes} other={WorkspacePage} />} />
          <Route path="/tasks" element={<Styled soft={SoftTasks} river={RiverTasks} orbit={OrbitTasks} other={TasksPage} />} />
          <Route path="/calendar" element={<Styled soft={SoftCalendar} river={RiverCalendar} orbit={OrbitCalendar} other={CalendarPage} />} />
          <Route path="/quiz/:topic" element={<Styled orbit={OrbitQuiz} other={GoHome} />} />
          <Route path="/ai" element={<Styled soft={SoftAI} river={RiverAI} orbit={OrbitAI} other={AIHubPage} />} />
          <Route path="/ai/connections" element={<Styled soft={SoftConnections} river={RiverConnections} orbit={OrbitConnections} other={ConnectionsPage} />} />
        </Route>
        <Route path="/quick-capture" element={<CaptureGate />} />
        <Route path="/workspace" element={<Navigate to="/notes" replace />} />
        <Route path="/todolist" element={<Navigate to="/tasks" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
