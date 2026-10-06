import HubScreen from '../components/hub/HubScreen';
import ConnectionsScreen from '../components/hub/ConnectionsScreen';
import { RiverHeader } from './RiverShell';

const STARTERS = [
  'What is on my plate today?',
  'Brief me for my next meeting',
  'What did I promise people this week?',
  'Plan my afternoon around my meetings',
];

/** River · Ask Peblo (the AI Hub in River's look). */
export function RiverAI() {
  return (
    <>
      <RiverHeader>
        <div className="r-when"><h1>Ask Peblo</h1><span>Answers from your notes, tasks and meetings</span></div>
      </RiverHeader>
      <HubScreen p="r" starters={STARTERS} welcome="Ask anything about your days." />
    </>
  );
}

/** River · Your AI (where AI runs, keys). */
export function RiverConnections() {
  return (
    <>
      <RiverHeader>
        <div className="r-when"><h1>Your AI</h1><span>What Peblo may use, and where it runs</span></div>
      </RiverHeader>
      <ConnectionsScreen p="r" />
    </>
  );
}
