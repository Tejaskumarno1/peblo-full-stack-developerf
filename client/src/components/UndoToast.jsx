import '../styles/undo.css';
import Toast from './Toast';

/** The message from useUndoToast(). Same look in every style. */
export default function UndoToast({ toast, dismiss }) {
  if (!toast) return null;
  return (
    <Toast><div className="pb-undo" role="status">
      <span>{toast.msg}</span>
      {toast.undo ? <button type="button" onClick={() => { const u = toast.undo; dismiss(); u(); }}>Undo</button> : <button type="button" onClick={dismiss}>Dismiss</button>}
    </div></Toast>
  );
}
