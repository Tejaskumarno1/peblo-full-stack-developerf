import SoftSettings from '../soft/SoftSettings';
import { RiverHeader } from './RiverShell';

export default function RiverSettings() {
  return (
    <>
      <RiverHeader>
        <div className="r-when"><h1>Settings</h1><span>Everything in one place</span></div>
      </RiverHeader>
      <SoftSettings skin="river" />
    </>
  );
}
