import { Link, useLocation, useNavigate } from 'react-router';
import { scheduleScrollPublicPageTop } from './scrollToPublicHash';

export default function PricifyLogo({ compact = false, decorative = false, onNavigate, to = '/' }) {
  const { pathname, hash, search } = useLocation();
  const navigate = useNavigate();
  const markSize = compact ? 22 : 28;
  const className = compact ? 'px-logo px-logo--compact' : 'px-logo';
  const inner = (
    <>
      <img
        className="px-logo-mark"
        src="/pricify/logo-mark.svg"
        alt=""
        width={markSize}
        height={markSize}
      />
      <span className="px-logo-word">Pricify</span>
    </>
  );

  if (decorative) {
    return <span className={className}>{inner}</span>;
  }

  return (
    <Link
      to={to}
      className={className}
      aria-label={to === '/' ? 'Pricify home' : 'Pricify staff home'}
      onClick={(event) => {
        onNavigate?.();
        if (pathname !== '/' || to !== '/') return;
        event.preventDefault();
        if (hash) {
          navigate({ pathname: '/', search, hash: '' }, { replace: true, preventScrollReset: true });
        }
        // After a section hash, React Router restores the old scroll for `/`.
        // Retry past that restore — a single smooth scrollTo(0) loses on first click.
        scheduleScrollPublicPageTop();
      }}
    >
      {inner}
    </Link>
  );
}
