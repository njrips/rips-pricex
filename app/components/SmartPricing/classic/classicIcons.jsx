import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ExternalIcon,
  MenuHorizontalIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  PlusIcon,
  SearchIcon,
  SelectIcon,
} from '@shopify/polaris-icons';

/**
 * Classic Smart Pricing icons — paths traced from EchoTest Figma
 * (file 4ZiENSDNrhaAOawOSqGZ6C). Prefer currentColor so theme tokens apply.
 * Source SVG exports: ./assets/figma-icons/
 */

const strokeProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/** Setup type selected + stepper done (Figma 13:411 / 13:559). */
export function IconCheck({ size = 16 }) {
  const vb = size <= 14 ? 14 : 16;
  const d = vb === 14 ? 'M11.667 3.5 5.25 9.917 2.333 7' : 'M13.333 4 6 11.333 2.667 8';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} aria-hidden>
      <path d={d} {...strokeProps} strokeWidth={vb === 14 ? '1.167' : '1.333'} />
    </svg>
  );
}

/** Back / Cancel — Lucide ArrowLeft with stem (Figma 13:426). */
export function IconArrowLeft({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M8 12.667 3.333 8 8 3.333" {...strokeProps} strokeWidth="1.333" />
      <path d="M12.667 8H3.333" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

/** Continue — Lucide ArrowRight with stem (Figma 16:5175). */
export function IconArrowRight({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M3.333 8H12.667" {...strokeProps} strokeWidth="1.333" />
      <path d="M8 3.333 12.667 8 8 12.667" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

/** List row open — Lucide arrow-up-right (Figma 13:106). */
export function IconArrowUpRight({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M4.667 4.667H11.333V11.333" {...strokeProps} strokeWidth="1.333" />
      <path d="M4.667 11.333 11.333 4.667" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

export function IconPlus({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M3.333 8H12.667" {...strokeProps} strokeWidth="1.333" />
      <path d="M8 3.333V12.667" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

export function IconSearch({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path
        d="M6.417 11.083a4.667 4.667 0 1 0 0-9.333 4.667 4.667 0 0 0 0 9.333Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path d="M12.25 12.25 9.718 9.718" {...strokeProps} strokeWidth="1.167" />
    </svg>
  );
}

/** Traffic banner — Figma Scale (18:6905 / assets/figma-icons/scales.svg). */
export function IconScales({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2V14" {...strokeProps} strokeWidth="1.333" />
      <path
        d="M12.6667 5.33333L14.6667 10.6667C14.0897 11.0994 13.3879 11.3333 12.6667 11.3333C11.9454 11.3333 11.2437 11.0994 10.6667 10.6667L12.6667 5.33333ZM12.6667 5.33333V4.66667"
        {...strokeProps}
        strokeWidth="1.333"
      />
      <path
        d="M2 4.66667H2.667C4.52693 4.66667 6.35859 4.20875 8 3.33333C9.64141 4.20875 11.4731 4.66667 13.3333 4.66667H14"
        {...strokeProps}
        strokeWidth="1.333"
      />
      <path
        d="M3.33333 5.33333L5.33333 10.6667C4.75635 11.0994 4.05457 11.3333 3.33333 11.3333C2.6121 11.3333 1.91032 11.0994 1.33333 10.6667L3.33333 5.33333ZM3.33333 5.33333V4.66667"
        {...strokeProps}
        strokeWidth="1.333"
      />
      <path d="M4.66667 14H11.3333" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

/** Control arm — current catalog/storefront baseline, distinct from A/B/C challengers. */
export function IconControlBaseline({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.667 7.333 8 2.667l5.333 4.666"
        {...strokeProps}
        strokeWidth="1.333"
      />
      <path
        d="M4 6.667v6h8v-6M6.667 12.667V9.333h2.666v3.334"
        {...strokeProps}
        strokeWidth="1.333"
      />
    </svg>
  );
}

/** Pick manually / Manual pricing — Lucide Box (Figma 60:9155 / 13:1139). */
export function IconHandPick({ size = 16, className, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={className} aria-hidden {...rest}>
      <path
        d="M7.333 14.487a1.333 1.333 0 0 0 1.334 0L13.333 11.82a1.333 1.333 0 0 0 .667-1.153V5.333a1.333 1.333 0 0 0-.667-1.153L8.667 1.513a1.333 1.333 0 0 0-1.334 0L2.667 4.18A1.333 1.333 0 0 0 2 5.333v5.334a1.333 1.333 0 0 0 .667 1.153l4.666 2.667Z"
        {...strokeProps}
        strokeWidth="1.333"
      />
      <path d="M8 14.667V8" {...strokeProps} strokeWidth="1.333" />
      <path d="M2.193 4.667 8 8l5.807-3.333" {...strokeProps} strokeWidth="1.333" />
      <path d="M5 2.847 11 6.28" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

/** All products / catalog grid — Lucide LayoutGrid. */
export function IconBoxes({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="2" y="2" width="5.5" height="5.5" rx="1" {...strokeProps} strokeWidth="1.333" />
      <rect x="8.5" y="2" width="5.5" height="5.5" rx="1" {...strokeProps} strokeWidth="1.333" />
      <rect x="2" y="8.5" width="5.5" height="5.5" rx="1" {...strokeProps} strokeWidth="1.333" />
      <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="1" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

export function IconSparkles({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 1.5 8.8 4.5 12 5.2 8.8 5.9 8 8.9 7.2 5.9 4 5.2l3.2-.7L8 1.5Z"
        {...strokeProps}
        strokeWidth="1.2"
      />
      <path
        d="M12.5 9.5 13 11.2 14.7 11.7 13 12.2 12.5 13.9 12 12.2 10.3 11.7 12 11.2 12.5 9.5Z"
        {...strokeProps}
        strokeWidth="1.1"
      />
    </svg>
  );
}

export function IconPercent({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="5.333" cy="5.333" r="1.5" {...strokeProps} strokeWidth="1.333" />
      <circle cx="10.667" cy="10.667" r="1.5" {...strokeProps} strokeWidth="1.333" />
      <path d="M11.667 4.333 4.333 11.667" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

/** Guardrail header — Lucide ShieldCheck (Figma 13:4198). */
export function IconShield({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path
        d="M11.667 7.583c0 2.917-2.042 4.375-4.469 5.221a.875.875 0 0 1-.39 0C4.375 11.958 2.333 10.5 2.333 7.583V3.5c0-.155.062-.303.171-.412.11-.11.258-.171.413-.171 1.166 0 2.625-.7 3.64-1.587a.875.875 0 0 1 1.086 0c1.021.892 2.473 1.587 3.64 1.587.155 0 .303.062.412.171.11.11.171.257.171.412v4.083Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path d="M5.25 7 6.417 8.167 8.75 5.833" {...strokeProps} strokeWidth="1.167" />
    </svg>
  );
}

export function IconRocket({ size = 16, className, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path
        d="M14 4c3.5 0 6 2.5 6 6-4.5 5-9 7.5-13 8.5L5.5 17 7 14.5C8 10.5 10.5 6 14 4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="14.5" cy="9.5" r="1.4" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 16.5 5 19M10 18l-1.5 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Running now KPI — Lucide Zap (Figma 13:24). */
export function IconBolt({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path
        d="M2.333 8.167a.875.875 0 0 1-.481-.952.875.875 0 0 1 .126-.701L7.653 1.266a.583.583 0 0 1 1.002.268L7.035 5.046a.875.875 0 0 0 .068.538c.054.077.126.141.21.184a.875.875 0 0 0 .27.066H11.667a.875.875 0 0 1 .455.862.875.875 0 0 1-.126.701L6.347 12.734a.583.583 0 0 1-1.002-.268L6.965 8.954a.875.875 0 0 0-.068-.538.875.875 0 0 0-.48-.25H2.333Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
    </svg>
  );
}

/**
 * Visitors KPI — Lucide Users (Figma 13:32), not a single-person icon.
 * Also used for Audience overview tabs.
 */
export function IconPerson({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path
        d="M9.333 12.25v-1.167a2.333 2.333 0 0 0-2.333-2.333H3.5a2.333 2.333 0 0 0-2.333 2.333V12.25"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path d="M9.333 1.825a2.333 2.333 0 0 1 0 4.517" {...strokeProps} strokeWidth="1.167" />
      <path
        d="M12.833 12.25v-1.167a2.333 2.333 0 0 0-1.75-2.257"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path
        d="M5.25 6.417a2.333 2.333 0 1 0 0-4.667 2.333 2.333 0 0 0 0 4.667Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
    </svg>
  );
}

/** Winning experiments KPI — Lucide TrendingUp (Figma 13:43). */
export function IconTrendUp({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden>
      <path d="M9.333 4.083H12.833V7.583" {...strokeProps} strokeWidth="1.167" />
      <path
        d="M12.833 4.083 7.875 9.042 4.958 6.125 1.167 9.917"
        {...strokeProps}
        strokeWidth="1.167"
      />
    </svg>
  );
}

export function IconPause({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path d="M5 3.5v9M11 3.5v9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconTrophy({ size = 14, className, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path d="M4.5 2.5h7v3.2a3.5 3.5 0 0 1-7 0V2.5Z" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4.5 4H3a2 2 0 0 0 2 2.8M11.5 4H13a2 2 0 0 1-2 2.8M6.5 12.5h3M8 9v3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconMore({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

/** Advanced options / expand — Lucide ChevronDown (Figma 13:422). */
export function IconChevron({ size = 16, up = false }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden
      style={up ? { transform: 'rotate(180deg)' } : undefined}
    >
      <path d="M4 6 8 10l4-4" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

/** Overview tab — Lucide Gauge (Figma 13:4929). */
export function IconOverview({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 8.167 9.333 5.833" {...strokeProps} strokeWidth="1.167" />
      <path
        d="M1.948 11.083C1.436 10.197 1.167 9.191 1.167 8.167c0-1.024.269-2.03.781-2.917a5.833 5.833 0 0 1 8.208 0c.512.887.781 1.893.781 2.917 0 1.024-.27 2.03-.781 2.916"
        {...strokeProps}
        strokeWidth="1.167"
      />
    </svg>
  );
}

/** Performance tab — Lucide ChartColumn (Figma 13:4936). */
export function IconChart({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M1.75 1.75v9.333c0 .31.123.606.342.825.219.219.515.342.825.342H12.25"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path d="M10.5 9.917V5.25" {...strokeProps} strokeWidth="1.167" />
      <path d="M7.583 9.917V2.917" {...strokeProps} strokeWidth="1.167" />
      <path d="M4.667 9.917V8.167" {...strokeProps} strokeWidth="1.167" />
    </svg>
  );
}

/** Variations tab — Lucide Trophy (Figma 13:4943). */
export function IconFlask({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M5.833 8.552v.948a1.75 1.75 0 0 1-.569 1.239c-.365.27-.661.621-.866 1.026A3.5 3.5 0 0 0 4.083 12.82"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path
        d="M8.167 8.552v.948a1.75 1.75 0 0 0 .569 1.239c.365.27.661.621.866 1.026A3.5 3.5 0 0 1 9.917 12.82"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path
        d="M10.5 5.25h.875a1.458 1.458 0 1 0 0-2.917H10.5"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path d="M2.333 12.833h9.334" {...strokeProps} strokeWidth="1.167" />
      <path
        d="M3.5 5.25a3.5 3.5 0 0 0 7 0V1.75A.583.583 0 0 0 9.917 1.167H4.083A.583.583 0 0 0 3.5 1.75v3.5Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path
        d="M3.5 5.25h-.875a1.458 1.458 0 1 1 0-2.917H3.5"
        {...strokeProps}
        strokeWidth="1.167"
      />
    </svg>
  );
}

/** Metrics tab — Lucide Crosshair / target rings (Figma 13:4962). */
export function IconTarget({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M7 12.833A5.833 5.833 0 1 0 7 1.167a5.833 5.833 0 0 0 0 11.666Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path
        d="M7 10.5A3.5 3.5 0 1 0 7 3.5a3.5 3.5 0 0 0 0 7Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path
        d="M7 8.167A1.167 1.167 0 1 0 7 5.833a1.167 1.167 0 0 0 0 2.334Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
    </svg>
  );
}

/** Activity tab — Lucide Activity (Figma 13:4969). */
export function IconPulse({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M12.833 7h-1.446a1.167 1.167 0 0 0-1.126.852L8.89 12.728a.292.292 0 0 1-.556 0L5.39 1.272a.292.292 0 0 0-.556 0L3.739 6.148A1.167 1.167 0 0 1 2.619 7H1.167"
        {...strokeProps}
        strokeWidth="1.167"
      />
    </svg>
  );
}

/** Settings tab — Lucide SlidersHorizontal (Figma 13:4974). */
export function IconGear({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M8.167 9.917H2.917" {...strokeProps} strokeWidth="1.167" />
      <path d="M11.083 4.083H5.833" {...strokeProps} strokeWidth="1.167" />
      <path
        d="M9.917 11.667a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path
        d="M4.083 5.833a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z"
        {...strokeProps}
        strokeWidth="1.167"
      />
    </svg>
  );
}

/** QR / scan affordance for variation preview. */
export function IconQr({ size = 14, className, ...rest }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      aria-hidden
      {...rest}
    >
      <path d="M2.333 2.333h3.5v3.5h-3.5V2.333Z" {...strokeProps} strokeWidth="1.167" />
      <path d="M8.167 2.333h3.5v3.5h-3.5V2.333Z" {...strokeProps} strokeWidth="1.167" />
      <path d="M2.333 8.167h3.5v3.5h-3.5V8.167Z" {...strokeProps} strokeWidth="1.167" />
      <path d="M8.167 8.167h1.167v1.167" {...strokeProps} strokeWidth="1.167" />
      <path d="M10.5 8.167H11.667V9.333" {...strokeProps} strokeWidth="1.167" />
      <path d="M8.167 10.5v1.167H9.333" {...strokeProps} strokeWidth="1.167" />
      <path d="M11.667 10.5v1.167H10.5" {...strokeProps} strokeWidth="1.167" />
    </svg>
  );
}

export function IconExternalLink({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M10.5 7.583V11.083a.875.875 0 0 1-.875.875H2.917a.875.875 0 0 1-.875-.875V4.375A.875.875 0 0 1 2.917 3.5H6.417"
        {...strokeProps}
        strokeWidth="1.167"
      />
      <path d="M8.75 1.75h3.5v3.5" {...strokeProps} strokeWidth="1.167" />
      <path d="M6.417 7.583 12.25 1.75" {...strokeProps} strokeWidth="1.167" />
    </svg>
  );
}

export function IconLightbulb({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.8c.6.5 1 1.2 1.1 2h4.8c.1-.8.5-1.5 1.1-2A6 6 0 0 0 12 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconList({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 4h10M3 8h10M3 12h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Bulk adjust — Lucide CirclePlus (Figma 13:1169). */
export function IconPlusCircle({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        d="M8 14.667A6.667 6.667 0 1 0 8 1.333a6.667 6.667 0 0 0 0 13.334Z"
        {...strokeProps}
        strokeWidth="1.333"
      />
      <path d="M5.333 8H10.667" {...strokeProps} strokeWidth="1.333" />
      <path d="M8 5.333V10.667" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

export function IconMinusCircle({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 12h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** All products — Lucide CircleCheck (Figma 60:9170). */
export function IconCheckCircle({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 14.667A6.667 6.667 0 1 0 8 1.333a6.667 6.667 0 0 0 0 13.334Z"
        {...strokeProps}
        strokeWidth="1.333"
      />
      <path d="M5.833 8 7.167 9.333 10.333 6.167" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

/** AI suggested — Lucide WandSparkles (Figma 13:1154). */
export function IconWand({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <path
        d="M13.573 1.573 14.427 2.427a1 1 0 0 1 0 1.146L3.573 14.427a1 1 0 0 1-1.146 0L1.573 13.573a1 1 0 0 1 0-1.146L12.427 1.573a1 1 0 0 1 1.146 0Z"
        {...strokeProps}
        strokeWidth="1.333"
      />
      <path d="M9.333 4.667 11.333 6.667" {...strokeProps} strokeWidth="1.333" />
      <path d="M3.333 4V6.667" {...strokeProps} strokeWidth="1.333" />
      <path d="M12.667 9.333V12" {...strokeProps} strokeWidth="1.333" />
      <path d="M6.667 1.333V2.667" {...strokeProps} strokeWidth="1.333" />
      <path d="M4.667 5.333H2" {...strokeProps} strokeWidth="1.333" />
      <path d="M14 10.667H11.333" {...strokeProps} strokeWidth="1.333" />
      <path d="M7.333 2H6" {...strokeProps} strokeWidth="1.333" />
    </svg>
  );
}

export function IconSliders({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h10M18 7h2M14 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM4 17h2M10 17h10M8 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconChevronRight({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M4.5 2.5 8 6l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconGlobe({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M3.8 12h16.4M12 3.8c2.2 2.4 3.3 5.1 3.3 8.2s-1.1 5.8-3.3 8.2c-2.2-2.4-3.3-5.1-3.3-8.2S9.8 6.2 12 3.8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconInfo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="5.5" {...strokeProps} strokeWidth="1.333" />
      <path d="M8 7.2v4" {...strokeProps} strokeWidth="1.333" />
      <circle cx="8" cy="5.2" r="0.7" fill="currentColor" />
    </svg>
  );
}

export function IconPencil({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.5 5.5 18.5 9.5M5 19l1.2-4.4L16.2 4.6a1.6 1.6 0 0 1 2.3 0l1 1a1.6 1.6 0 0 1 0 2.3L8.4 17.8 5 19Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Polaris Button `icon` source. Forwards `className` onto the SVG so it
 * fills the 20px Admin icon slot (no nested span / mixed baseline).
 */
export function buttonIcon(Icon, size = 20) {
  function Source({ className, ...rest }) {
    return <Icon size={size} className={className} {...rest} />;
  }
  Source.displayName = `${Icon.name || 'Icon'}ButtonSource`;
  return Source;
}

export const ButtonIconPlus = PlusIcon;
export const ButtonIconArrowLeft = ArrowLeftIcon;
export const ButtonIconArrowRight = ArrowRightIcon;
export const ButtonIconSearch = SearchIcon;
export const ButtonIconSelect = SelectIcon;
export const ButtonIconExternalLink = ExternalIcon;
export const ButtonIconPause = PauseCircleIcon;
export const ButtonIconPlay = PlayCircleIcon;
export const ButtonIconMore = MenuHorizontalIcon;
export const ButtonIconHandPick = buttonIcon(IconHandPick, 20);
export const ButtonIconTrophy = buttonIcon(IconTrophy, 20);
export const ButtonIconRocket = buttonIcon(IconRocket, 20);
export const ButtonIconQr = buttonIcon(IconQr, 20);
