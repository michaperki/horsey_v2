// Trust-tier border SVGs — spike for replacing the PNG borders with inline
// SVG that scales cleanly at every density without rasterization fuzz and
// composes as part of the wrapper rather than a stacked image.
//
// Currently only consumed by the /dev-cosmetics PNG/SVG toggle so we can
// compare side-by-side. Live renderer (apps/web/src/cosmetics.mjs) still
// emits the PNG <img> until we commit to the SVG path.
//
// Design intent per docs/COSMETICS_FORMALIZATION.md § 5.1.1:
//   provisional (and claimed) → muted single ring, low contrast
//   verified                  → gold gradient ring + check-pip glyph
//   established (trusted)     → dual concentric gold rings, premium tenure
//
// IDs in <defs> are suffixed with a unique counter so multiple avatars on
// the same page don't collide on gradient references.

const CANVAS = 256;
const CORNER = 58;  // matches wrapper border-radius proportion (~23% of width)

let idCounter = 0;
function nextSuffix() {
  idCounter = (idCounter + 1) % 1_000_000;
  return `b${idCounter.toString(36)}`;
}

function svgWrap(inner) {
  return `<svg class="avatar-svg-border" viewBox="0 0 ${CANVAS} ${CANVAS}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${inner}</svg>`;
}

function provisionalBorder() {
  return svgWrap(`
    <rect x="4" y="4" width="248" height="248" rx="${CORNER}" ry="${CORNER}"
      fill="none" stroke="rgba(168, 153, 120, 0.65)" stroke-width="2.5" />
  `);
}

function verifiedBorder() {
  const id = nextSuffix();
  return svgWrap(`
    <defs>
      <linearGradient id="${id}-rim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f0d182" />
        <stop offset="55%" stop-color="#cda64a" />
        <stop offset="100%" stop-color="#8a6a1d" />
      </linearGradient>
      <linearGradient id="${id}-pip" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f5dc8e" />
        <stop offset="100%" stop-color="#a17a26" />
      </linearGradient>
    </defs>
    <rect x="4" y="4" width="248" height="248" rx="${CORNER}" ry="${CORNER}"
      fill="none" stroke="url(#${id}-rim)" stroke-width="3.2" />
    <g transform="translate(212, 44)">
      <circle r="22" fill="url(#${id}-pip)" stroke="#7a5a18" stroke-width="1.5" />
      <path d="M -9 0 L -2 7 L 9 -8"
        fill="none" stroke="#1b1815" stroke-width="3.2"
        stroke-linecap="round" stroke-linejoin="round" />
    </g>
  `);
}

function trustedBorder() {
  const id = nextSuffix();
  return svgWrap(`
    <defs>
      <linearGradient id="${id}-outer" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f5dc8e" />
        <stop offset="100%" stop-color="#8a6a1d" />
      </linearGradient>
      <linearGradient id="${id}-inner" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#e6c876" />
        <stop offset="100%" stop-color="#735619" />
      </linearGradient>
    </defs>
    <rect x="3" y="3" width="250" height="250" rx="${CORNER + 2}" ry="${CORNER + 2}"
      fill="none" stroke="url(#${id}-outer)" stroke-width="3.4" />
    <rect x="11" y="11" width="234" height="234" rx="${CORNER - 5}" ry="${CORNER - 5}"
      fill="none" stroke="url(#${id}-inner)" stroke-width="1.6" opacity="0.85" />
    <!-- four cardinal accent ticks -->
    <g fill="#cda64a">
      <circle cx="128" cy="6.5" r="2.4" />
      <circle cx="128" cy="249.5" r="2.4" />
      <circle cx="6.5" cy="128" r="2.4" />
      <circle cx="249.5" cy="128" r="2.4" />
    </g>
  `);
}

const BUILDERS = {
  trust__border__provisional: provisionalBorder,
  trust__border__verified: verifiedBorder,
  trust__border__trusted: trustedBorder
};

export function hasSvgBorder(borderId) {
  return Object.prototype.hasOwnProperty.call(BUILDERS, borderId);
}

// Returns an SVG markup string for the given border id, or "" if no SVG
// version exists for that id (caller should fall back to the PNG path).
export function getSvgBorder(borderId) {
  const build = BUILDERS[borderId];
  return build ? build() : "";
}

export const SVG_BORDER_IDS = Object.freeze(Object.keys(BUILDERS));
