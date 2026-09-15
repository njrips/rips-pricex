import { LANDING_ASSETS } from './landingContent';

export default function LogoMarquee() {
  const src = LANDING_ASSETS.logoMarquee;
  return (
    <div className="px-logo-marquee" aria-hidden>
      <div className="px-logo-marquee-fade px-logo-marquee-fade--left" />
      <div className="px-logo-marquee-fade px-logo-marquee-fade--right" />
      <div className="px-logo-marquee-track">
        <div className="px-logo-marquee-inner">
          <img src={src} alt="" width={1200} height={80} decoding="async" draggable={false} />
          <img src={src} alt="" width={1200} height={80} decoding="async" draggable={false} />
        </div>
      </div>
    </div>
  );
}
