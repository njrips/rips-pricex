import { useLocation, useNavigate } from 'react-router';
import { parsePublicSectionId, publicSectionHref, scheduleScrollToPublicHash } from './scrollToPublicHash';

export default function PublicSectionLink({ hash, className, children, onNavigate }) {
  const { pathname, hash: locationHash, search } = useLocation();
  const navigate = useNavigate();
  const id = parsePublicSectionId(hash);
  const href = publicSectionHref(id, pathname);
  const current = pathname === '/' && parsePublicSectionId(locationHash) === id;
  const classes = [className, current && className?.includes('px-nav-link') ? 'is-active' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <a
      href={href}
      className={classes || undefined}
      aria-current={current ? 'location' : undefined}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
        if (pathname === '/' && window.location.hash === `#${id}`) {
          scheduleScrollToPublicHash(id);
          return;
        }
        // Hash change is scrolled once by PricifyShell. Do not also scroll here —
        // a second pass (smooth + native hash) is the first-click bounce.
        navigate({ pathname: '/', search, hash: `#${id}` }, { preventScrollReset: true });
      }}
    >
      {children}
    </a>
  );
}
