import { useRef } from 'react';
import { useMenuNav } from './a11y';

/** A role="menu" box that takes focus when it opens and answers Up, Down, Home, End and Escape. */
export default function NavMenu({ onClose, children, ...rest }) {
  const ref = useRef(null);
  useMenuNav(ref, onClose);
  return <div role="menu" ref={ref} {...rest}>{children}</div>;
}
