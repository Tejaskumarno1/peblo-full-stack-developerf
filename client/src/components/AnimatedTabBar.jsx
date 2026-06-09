import { Link, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState, useCallback } from 'react';

const lastIndicatorByVariant = new Map();

/**
 * Tab bar with a sliding pill indicator (navbar + mobile bottom bar).
 */
export default function AnimatedTabBar({ tabs, variant = 'navbar', className = '' }) {
  const location = useLocation();
  const containerRef = useRef(null);
  const tabRefs = useRef([]);
  const [indicator, setIndicator] = useState(() => lastIndicatorByVariant.get(variant) || { x: 0, width: 0, ready: false });

  const isActive = useCallback(
    (tab) => {
      if (tab.match) return tab.match(location.pathname);
      return location.pathname === tab.to;
    },
    [location.pathname]
  );

  const updateIndicator = useCallback(() => {
    const idx = tabs.findIndex(isActive);
    const el = tabRefs.current[idx];
    const container = containerRef.current;
    if (!el || !container) return;

    const cRect = container.getBoundingClientRect();
    const tRect = el.getBoundingClientRect();
    const nextIndicator = {
      x: tRect.left - cRect.left,
      width: tRect.width,
      ready: true,
    };

    lastIndicatorByVariant.set(variant, nextIndicator);
    setIndicator(nextIndicator);
  }, [tabs, isActive, variant]);

  useEffect(() => {
    updateIndicator();

    const container = containerRef.current;
    if (!container) return;

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(updateIndicator);
    });
    ro.observe(container);
    tabRefs.current.forEach((el) => el && ro.observe(el));

    window.addEventListener('resize', updateIndicator);

    // Re-measure after label expand/collapse animation (mobile)
    const t1 = setTimeout(updateIndicator, 120);
    const t2 = setTimeout(updateIndicator, 480);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', updateIndicator);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [updateIndicator, location.pathname]);

  const isMobile = variant === 'mobile';
  const linkClass = isMobile ? 'mobile-tab' : 'tab-btn';

  return (
    <div
      ref={containerRef}
      className={`animated-tab-bar ${isMobile ? 'animated-tab-bar--mobile' : 'animated-tab-bar--navbar'} ${className}`}
      role="tablist"
    >
      <span
        className="tab-slide-indicator"
        style={{
          transform: `translateX(${indicator.x}px)`,
          width: indicator.width,
          opacity: indicator.ready ? 1 : 0,
        }}
        data-ready={indicator.ready ? 'true' : 'false'}
        aria-hidden="true"
      />
      {tabs.map((tab, i) => {
        const active = isActive(tab);
        return (
          <Link
            key={tab.id}
            to={tab.to}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={active}
            className={`${linkClass} ${active ? 'active' : ''}`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </div>
  );
}
