// Cosmetic avatar renderer. See docs/COSMETICS_FORMALIZATION.md.
//
// First-iteration runtime:
//   - Loads /assets/cosmetics/manifest.json once on init().
//   - renderAvatar(user, { surface }) returns an HTML string composing the
//     user's avatar block per the surface's density mode.
//   - Layer composition uses absolute positioning derived from anchor +
//     offset + natural_size on a conceptual 256x256 canvas, scaled to the
//     wrapper's display size.
//   - Borders with fill_canvas=true override positioning to fill the wrapper.
//   - Live-state overrides (flame_crown hides laurel) are already applied
//     by the server in user.avatar.headwear; the client just renders what
//     the server says.
//   - When no manifest is loaded yet (boot race) or the user payload has no
//     avatar block, falls back to the legacy initial-letter avatar so we
//     never render an empty square.

const MANIFEST_URL = "/assets/cosmetics/manifest.json";
const CANVAS_SIZE = 256;

let manifest = null;
let manifestPromise = null;

export function initCosmetics() {
  if (manifestPromise) return manifestPromise;
  manifestPromise = fetch(MANIFEST_URL, { credentials: "same-origin" })
    .then((r) => {
      if (!r.ok) throw new Error(`manifest fetch failed: ${r.status}`);
      return r.json();
    })
    .then((data) => {
      manifest = data;
      return data;
    })
    .catch((err) => {
      console.warn("[cosmetics] manifest load failed:", err);
      manifest = { items: {} };
      return manifest;
    });
  return manifestPromise;
}

export function getManifest() {
  return manifest;
}

export function setManifest(nextManifest) {
  manifest = nextManifest;
  manifestPromise = Promise.resolve(nextManifest);
}

function densityForSurface(surface) {
  if (!manifest) return "minimal";
  const map = manifest.surface_density || {};
  return map[surface] || "compact";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isAllowedAtDensity(item, densityMode) {
  if (!manifest) return false;
  const mode = manifest.density_modes?.[densityMode];
  if (!mode) return false;
  return mode.allowed_z.includes(item.z);
}

function styleForLayer(item, wrapperSize) {
  const asset = item.asset || {};
  const zIndex = `;z-index:${Number(item.z ?? 0) + 20}`;
  const layerScale = Number(asset.scale ?? 1);
  const opacity = asset.opacity == null ? "" : `;opacity:${Number(asset.opacity)}`;
  if (asset.fill_canvas) {
    const filter = asset.css_filter ? `;filter:${asset.css_filter}` : "";
    const offset = asset.offset || { dx: 0, dy: 0 };
    const scale = wrapperSize / CANVAS_SIZE;
    const centerX = (CANVAS_SIZE / 2 + offset.dx) * scale;
    const centerY = (CANVAS_SIZE / 2 + offset.dy) * scale;
    const sizePx = wrapperSize * layerScale;
    return `position:absolute;top:${centerY.toFixed(2)}px;left:${centerX.toFixed(2)}px;width:${sizePx.toFixed(2)}px;height:${sizePx.toFixed(2)}px;object-fit:contain;transform:translate(-50%,-50%);pointer-events:none${zIndex}${opacity}${filter}`;
  }
  const anchorName = asset.anchor || "canvas_outer";
  const anchor = manifest.canvas?.anchors?.[anchorName] || { x: 128, y: 128 };
  const offset = asset.offset || { dx: 0, dy: 0 };
  const natural = asset.natural_size || { w: 128, h: 128 };
  const scale = wrapperSize / CANVAS_SIZE;
  const topPx = (anchor.y + offset.dy - (natural.h * layerScale) / 2) * scale;
  const leftPx = (anchor.x + offset.dx - (natural.w * layerScale) / 2) * scale;
  const widthPx = natural.w * layerScale * scale;
  const heightPx = natural.h * layerScale * scale;
  const filter = asset.css_filter ? `;filter:${asset.css_filter}` : "";
  return `position:absolute;top:${topPx.toFixed(2)}px;left:${leftPx.toFixed(2)}px;width:${widthPx.toFixed(2)}px;height:${heightPx.toFixed(2)}px;pointer-events:none${zIndex}${opacity}${filter}`;
}

function animationClassFor(item, densityMode) {
  if (!item.rendering?.animation) return "";
  const dmode = manifest.density_modes?.[densityMode];
  if (!dmode?.animation) return "";
  if (dmode.animation === "reduced" && item.rendering.animation.broadcast_only) {
    return "";
  }
  const kind = item.rendering.animation.kind || "";
  return kind ? ` avatar-anim avatar-anim--${kind.replace(/[^a-z0-9_-]/gi, "")}` : "";
}

function layerImg(item, densityMode, wrapperSize) {
  if (!item?.asset?.src) return "";
  if (!isAllowedAtDensity(item, densityMode)) return "";
  // Don't render below density_min if declared.
  const densityMin = item.rendering?.density_min;
  if (densityMin) {
    const order = ["minimal", "compact", "standard", "broadcast"];
    if (order.indexOf(densityMode) < order.indexOf(densityMin)) return "";
  }
  const style = styleForLayer(item, wrapperSize);
  const animClass = animationClassFor(item, densityMode);
  const slot = escapeHtml(item.slot);
  const placeholder = item.placeholder ? ' data-placeholder="true"' : "";
  return `<img class="avatar-layer avatar-layer--${slot}${animClass}" src="${escapeHtml(item.asset.src)}" alt="" style="${style}"${placeholder} onerror="this.hidden=true" />`;
}

function fallbackAvatar(user, wrapperSize) {
  const initial = (user?.handle?.[0] || "?").toUpperCase();
  return `<span class="avatar-fallback" style="width:${wrapperSize}px;height:${wrapperSize}px;font-size:${(wrapperSize * 0.5).toFixed(0)}px">${escapeHtml(initial)}</span>`;
}

// Equip-block layer order (lowest z first). The server's avatar block uses
// the slot names below; we look each up in the manifest.
const SLOT_ORDER = [
  "back_aura",
  "base",
  "border",
  "outerwear",
  "accent",
  "facewear",
  "headwear",
  "front_aura",
  "attached_badge"
];

export function renderAvatar(user, opts = {}) {
  const surface = opts.surface || "dense_row";
  const densityMode = opts.density || densityForSurface(surface);
  const wrapperSize = opts.size != null
    ? Number(opts.size)
    : Number(manifest?.density_modes?.[densityMode]?.size_px ?? 64);

  const avatarBlock = user?.avatar;
  if (!manifest || !avatarBlock) {
    return `<span class="avatar avatar--${escapeHtml(densityMode)}" data-surface="${escapeHtml(surface)}" style="width:${wrapperSize}px;height:${wrapperSize}px">${fallbackAvatar(user, wrapperSize)}</span>`;
  }

  const layers = [];
  for (const slotName of SLOT_ORDER) {
    const itemId = avatarBlock[slotName];
    if (!itemId) continue;
    const item = manifest.items?.[itemId];
    if (!item) continue;
    if (item.enabled === false) continue;
    layers.push(layerImg(item, densityMode, wrapperSize));
  }

  const tierLabel = user?.trustTier ? ` data-tier="${escapeHtml(user.trustTier)}"` : "";
  return `<span class="avatar avatar--${escapeHtml(densityMode)}" data-surface="${escapeHtml(surface)}"${tierLabel} style="width:${wrapperSize}px;height:${wrapperSize}px">${layers.join("")}</span>`;
}
