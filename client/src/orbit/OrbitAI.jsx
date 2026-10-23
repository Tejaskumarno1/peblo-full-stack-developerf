import HubScreen from '../components/hub/HubScreen';
import ConnectionsScreen from '../components/hub/ConnectionsScreen';

const STARTERS = [
  'Quiz me on my weakest topic',
  'What should I revise before my exam?',
  'Explain my latest note simply',
  'Make flashcards from my notes this week',
];

/** Orbit · Ask (the AI Hub in Orbit's look, under the top bar). */
export function OrbitAI() {
  return (
    <div className="o-page">
      <HubScreen p="o" starters={STARTERS} welcome="Ask your map anything." />
    </div>
  );
}

/** Orbit · Your AI. */
export function OrbitConnections() {
  return (
    <div className="o-page">
      <ConnectionsScreen p="o" />
    </div>
  );
}

/** Orbit · Map: the map itself is drawn by the shell, so this screen adds nothing. */
export function OrbitHome() {
  return null;
}
