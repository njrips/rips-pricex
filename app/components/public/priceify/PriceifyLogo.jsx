import { Link, useLocation, useNavigate } from 'react-router';
import { scheduleScrollPublicPageTop } from './scrollToPublicHash';

export default function PriceifyLogo({
  compact = false,
  decorative = false,
  onNavigate,
  to = '/',
  className: classNameProp,
}) {
  const { pathname, hash, search } = useLocation();
  const navigate = useNavigate();
  const markHeight = compact ? 22 : 28;
  const markWidth = Math.round(markHeight * (49.9759 / 82.3133));
  const className = classNameProp
    ? `px-logo ${classNameProp}`
    : compact
      ? 'px-logo px-logo--compact'
      : 'px-logo';
  const inner = (
    <>
      <img
        className="px-logo-mark"
        src="/priceify/logo-mark.svg"
        alt=""
        width={markWidth}
        height={markHeight}
      />
      <span className="px-logo-word">Priceify</span>
    </>
  );

  if (decorative) {
    return <span className={className}>{inner}</span>;
  }

  return (
    <Link
      to={to}
      className={className}
      aria-label={to === '/' ? 'Priceify home' : 'Priceify staff home'}
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
