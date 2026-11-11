import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import '../styles/toasts.css';

/**
 * The one place every notification (undo, saved, error, connecting, someone joined) appears: bottom left, stacked,
 * clear of the dock and the Capture button. The host sits inside the look that is on screen (Soft, River or Orbit),
 * so the messages keep that look's colours; on pages with none of them it sits on the body.
 */
function findHost() {
  const root = document.querySelector('.soft, .river, .orbit') || document.body;
  let el = root.querySelector(':scope > #pb-toasts');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pb-toasts';
    el.setAttribute('aria-live', 'polite');
    root.appendChild(el);
  }
  return el;
}

/** <Toast>{message element}</Toast> puts the message in the shared host instead of where it was written. */
export default function Toast({ children }) {
  const [host, setHost] = useState(null);
  useEffect(() => { setHost(findHost()); }, []);
  return host ? createPortal(children, host) : null;
}
