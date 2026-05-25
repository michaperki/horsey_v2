import { getManifest, setManifest } from "./cosmetics.mjs";

const CANVAS_SIZE = 256;
const DISPLAY_SIZE = 512;
const DENSITIES = ["minimal", "compact", "standard", "broadcast"];
const SLOT_DEFAULTS = {
  back_aura: { z: -10, anchor: "back_aura", density_min: "broadcast" },
  base: { z: 10, anchor: "piece_base", density_min: "minimal" },
  border: { z: 10, anchor: "canvas_outer", density_min: "minimal", fill_canvas: true },
  outerwear: { z: 20, anchor: "chest", density_min: "standard" },
  accent: { z: 30, anchor: "chest", density_min: "standard" },
  facewear: { z: 40, anchor: "eye_line", density_min: "standard" },
  headwear: { z: 50, anchor: "head_top", density_min: "compact" },
  front_aura: { z: 60, anchor: "piece_center", density_min: "standard" },
  attached_badge: { z: 70, anchor: "below_avatar", density_min: "standard" }
};
const SLOT_OPTIONS = Object.keys(SLOT_DEFAULTS);
const CORE_IDS = [
  "base__piece__knight",
  "base__piece__queen",
  "base__piece__pawn",
  "base__piece__bishop",
  "base__piece__rook",
  "trust__border__provisional",
  "trust__border__verified",
  "trust__border__trusted",
  "trust__border__elite",
  "trust__border__champion",
  "milestone__headwear__laurel",
  "milestone__headwear__flame_crown"
];

const state = {
  manifest: null,
  savedManifest: null,
  assetPaths: null,
  baseId: "base__piece__knight",
  enabled: new Set(["trust__border__provisional", "milestone__headwear__laurel"]),
  selectedId: "base__piece__knight",
  catalogDraft: null,
  density: "standard",
  layerFilter: { slot: "all", query: "", coreOnly: false },
  notice: "",
  error: ""
};

const BASE_PIECE_IDS = [
  "base__piece__pawn",
  "base__piece__knight",
  "base__piece__bishop",
  "base__piece__rook",
  "base__piece__queen"
];

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureEditorManifest() {
  if (state.manifest) return state.manifest;
  const source = getManifest();
  if (!source?.items) return null;
  state.manifest = clone(source);
  state.savedManifest = clone(source);
  return state.manifest;
}

async function loadAssetIndex(rerender) {
  if (state.assetPaths) return;
  try {
    const response = await fetch("/api/dev/cosmetics-assets", { credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "asset index failed");
    state.assetPaths = new Set(payload.assets || []);
    state.notice = state.notice || "Asset folder synced.";
    normalizeSelections();
  } catch (error) {
    state.error = error.message;
    state.assetPaths = new Set();
  }
  rerender();
}

function assetExists(src) {
  if (!src) return false;
  if (!state.assetPaths) return true;
  return state.assetPaths.has(src);
}

function itemAssetExists(item) {
  return assetExists(item?.asset?.src);
}

function missingManifestIds() {
  if (!state.manifest || !state.assetPaths) return [];
  return Object.entries(state.manifest.items || {})
    .filter(([, item]) => item?.asset?.src && !itemAssetExists(item))
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b));
}

function uncataloguedAssets() {
  if (!state.manifest || !state.assetPaths) return [];
  const catalogued = new Set(
    Object.values(state.manifest.items || {})
      .map((item) => item?.asset?.src)
      .filter(Boolean)
  );
  return [...state.assetPaths]
    .filter((src) => !catalogued.has(src))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeSelections() {
  if (!state.manifest) return;
  if (!itemAssetExists(state.manifest.items[state.baseId])) {
    const firstBase = sortedItemIds(state.manifest)
      .find((id) => state.manifest.items[id]?.slot === "base" && itemAssetExists(state.manifest.items[id]));
    if (firstBase) state.baseId = firstBase;
  }
  for (const id of [...state.enabled]) {
    if (!itemAssetExists(state.manifest.items[id])) state.enabled.delete(id);
  }
  if (!itemAssetExists(state.manifest.items[state.selectedId])) {
    state.selectedId = state.baseId;
  }
}

function itemLabel(id, item) {
  return item?.label || id.replace(/__/g, " / ").replace(/_/g, " ");
}

function filenameStem(src) {
  return src.split("/").pop().replace(/\.(png|webp|jpe?g)$/i, "");
}

function slugify(value) {
  return String(value || "asset")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "asset";
}

function inferSlotFromAsset(src) {
  const stem = filenameStem(src).toLowerCase();
  if (stem.includes("border")) return "border";
  if (stem.includes("pawn") || stem.includes("knight") || stem.includes("bishop") || stem.includes("rook") || stem.includes("queen")) return "base";
  if (stem.includes("crown") || stem.includes("hat") || stem.includes("laurel")) return "headwear";
  if (stem.includes("halo") || stem.includes("aura")) return "front_aura";
  if (stem.includes("badge") || stem.includes("shield")) return "attached_badge";
  if (stem.includes("glasses") || stem.includes("eye")) return "facewear";
  if (stem.includes("cape") || stem.includes("coat") || stem.includes("scarf")) return "outerwear";
  return "accent";
}

function inferPieceFromAsset(src) {
  const stem = filenameStem(src).toLowerCase();
  for (const piece of ["pawn", "knight", "bishop", "rook", "queen"]) {
    if (stem.includes(piece)) return piece;
  }
  return "";
}

function idFromAsset(src, slot) {
  const stem = slugify(filenameStem(src));
  if (stem.startsWith(`${slot}__`) || stem.startsWith("base__piece__")) return stem;
  if (stem.includes("border")) return `trust__border__${stem.replace(/^.*border_?/, "")}`;
  return `dev__${slot}__${stem}`;
}

function uniqueItemId(baseId) {
  let id = slugify(baseId);
  let i = 2;
  while (state.manifest?.items?.[id]) {
    id = `${slugify(baseId)}_${i}`;
    i += 1;
  }
  return id;
}

function startCatalogDraft(src) {
  const slot = inferSlotFromAsset(src);
  const defaults = SLOT_DEFAULTS[slot];
  state.catalogDraft = {
    src,
    id: uniqueItemId(idFromAsset(src, slot)),
    slot,
    z: defaults.z,
    anchor: defaults.anchor,
    density_min: defaults.density_min,
    fill_canvas: !!defaults.fill_canvas,
    piece: inferPieceFromAsset(src),
    persona: slot === "border" ? "trust" : "base",
    function: slot === "border" ? "trust_signal" : "identity",
    rarity: slot === "border" ? "tier_locked" : "common"
  };
  state.notice = "";
  state.error = "";
}

function updateCatalogDraftField(field, value) {
  if (!state.catalogDraft) return;
  state.catalogDraft[field] = value;
  if (field === "slot") {
    const defaults = SLOT_DEFAULTS[value];
    state.catalogDraft.id = uniqueItemId(idFromAsset(state.catalogDraft.src, value));
    state.catalogDraft.z = defaults.z;
    state.catalogDraft.anchor = defaults.anchor;
    state.catalogDraft.density_min = defaults.density_min;
    state.catalogDraft.fill_canvas = !!defaults.fill_canvas;
  }
}

function imageSize(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

function sortedItemIds(manifest) {
  const ids = Object.keys(manifest.items || {}).filter((id) => itemAssetExists(manifest.items[id]));
  return ids.sort((a, b) => {
    const ac = CORE_IDS.includes(a) ? 0 : 1;
    const bc = CORE_IDS.includes(b) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return a.localeCompare(b);
  });
}

function filteredLayerIds(manifest) {
  const { slot, query, coreOnly } = state.layerFilter;
  const needle = (query || "").trim().toLowerCase();
  return sortedItemIds(manifest).filter((id) => {
    const item = manifest.items[id];
    if (!item) return false;
    if (coreOnly && !CORE_IDS.includes(id)) return false;
    if (slot && slot !== "all" && item.slot !== slot) return false;
    if (needle) {
      const haystack = `${id} ${itemLabel(id, item)} ${item.persona || ""} ${item.slot || ""}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

function availableSlots(manifest) {
  const slots = new Set();
  for (const id of Object.keys(manifest.items || {})) {
    const item = manifest.items[id];
    if (item?.slot && itemAssetExists(item)) slots.add(item.slot);
  }
  return ["all", ...SLOT_OPTIONS.filter((slot) => slots.has(slot))];
}

function activeLayerIds() {
  return [state.baseId, ...state.enabled]
    .filter(Boolean)
    .filter((id) => itemAssetExists(state.manifest?.items?.[id]));
}

function densityAllows(item, density) {
  const mode = state.manifest?.density_modes?.[density];
  if (!mode) return false;
  if (!mode.allowed_z.includes(item.z)) return false;
  const densityMin = item.rendering?.density_min;
  if (!densityMin) return true;
  return DENSITIES.indexOf(density) >= DENSITIES.indexOf(densityMin);
}

function anchorFor(item) {
  const asset = item.asset || {};
  return state.manifest?.canvas?.anchors?.[asset.anchor || "canvas_outer"] || { x: 128, y: 128 };
}

function layerMetrics(item, displaySize) {
  const asset = item.asset || {};
  const offset = asset.offset || { dx: 0, dy: 0 };
  const scale = displaySize / CANVAS_SIZE;
  const layerScale = Number(asset.scale ?? 1);
  if (asset.fill_canvas) {
    const size = displaySize * layerScale;
    const left = (CANVAS_SIZE / 2 + offset.dx) * scale - size / 2;
    const top = (CANVAS_SIZE / 2 + offset.dy) * scale - size / 2;
    return { left, top, width: size, height: size };
  }
  const anchor = anchorFor(item);
  const natural = asset.natural_size || { w: 128, h: 128 };
  const width = natural.w * layerScale * scale;
  const height = natural.h * layerScale * scale;
  const left = (anchor.x + offset.dx) * scale - width / 2;
  const top = (anchor.y + offset.dy) * scale - height / 2;
  return { left, top, width, height };
}

function renderLayer(id, displaySize, { density = state.density, interactive = false } = {}) {
  const item = state.manifest.items[id];
  if (!item?.asset?.src || item.enabled === false) return "";
  if (!itemAssetExists(item)) return "";
  if (!densityAllows(item, density)) return "";
  const m = layerMetrics(item, displaySize);
  const opacity = item.asset.opacity ?? 1;
  const selected = id === state.selectedId ? " selected" : "";
  const placeholder = item.placeholder ? " placeholder" : "";
  const attrs = interactive ? ` data-editor-layer="${escapeHtml(id)}"` : "";
  return `<img class="cos-editor-layer${selected}${placeholder}"${attrs} src="${escapeHtml(item.asset.src)}" alt="" style="left:${m.left.toFixed(2)}px;top:${m.top.toFixed(2)}px;width:${m.width.toFixed(2)}px;height:${m.height.toFixed(2)}px;z-index:${Number(item.z ?? 0) + 50};opacity:${Number(opacity)}" />`;
}

function renderCanvas(displaySize = DISPLAY_SIZE, density = state.density, interactive = false) {
  const layers = activeLayerIds()
    .map((id) => ({ id, z: Number(state.manifest.items[id]?.z ?? 0) }))
    .sort((a, b) => a.z - b.z)
    .map(({ id }) => renderLayer(id, displaySize, { density, interactive }))
    .join("");
  const grid = interactive ? `
    <span class="cos-editor-crosshair x"></span>
    <span class="cos-editor-crosshair y"></span>
  ` : "";
  return `<div class="cos-editor-canvas" style="width:${displaySize}px;height:${displaySize}px">${grid}${layers}</div>`;
}

function selectedItem() {
  const item = state.manifest?.items?.[state.selectedId] || null;
  return itemAssetExists(item) ? item : null;
}

function manifestPatch() {
  if (!state.savedManifest || !state.manifest) return {};
  const changed = {};
  for (const id of Object.keys(state.manifest.items || {})) {
    const before = JSON.stringify(state.savedManifest.items?.[id]);
    const after = JSON.stringify(state.manifest.items?.[id]);
    if (before !== after) changed[id] = state.manifest.items[id];
  }
  return { items: changed };
}

function renderLayerFilterBar(manifest) {
  const { slot, query, coreOnly } = state.layerFilter;
  const slots = availableSlots(manifest);
  return `
    <div class="cos-editor-filter-bar">
      <label class="cos-editor-filter-search">
        <span class="picker-label">Search</span>
        <input type="search" placeholder="name, persona, slot..." value="${escapeHtml(query)}"
          data-cos-layer-search>
      </label>
      <div class="cos-editor-filter-slots">
        ${slots.map((s) => `
          <button type="button" class="${s === slot ? "active" : ""}" data-cos-layer-slot="${escapeHtml(s)}">${escapeHtml(s)}</button>
        `).join("")}
      </div>
      <label class="cos-editor-filter-core">
        <input type="checkbox" ${coreOnly ? "checked" : ""} data-cos-layer-core-only>
        Core only
      </label>
    </div>
  `;
}

function renderLayerControls(manifest) {
  const ids = filteredLayerIds(manifest);
  if (ids.length === 0) {
    return `<p class="muted small">No layers match the current filter.</p>`;
  }
  // Group by slot once the catalog gets dense; preserves core-first within each group.
  const groups = new Map();
  for (const id of ids) {
    const item = manifest.items[id];
    const slot = item.slot || "other";
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(id);
  }
  return [...groups.entries()].map(([slot, slotIds]) => `
    <div class="cos-editor-layer-group">
      <h3>${escapeHtml(slot)}<small>${slotIds.length}</small></h3>
      ${slotIds.map((id) => {
        const item = manifest.items[id];
        const isBase = item.slot === "base";
        const checked = isBase ? state.baseId === id : state.enabled.has(id);
        const core = CORE_IDS.includes(id) ? " core" : "";
        return `
          <label class="cos-editor-layer-row${core}${state.selectedId === id ? " active" : ""}">
            <input type="${isBase ? "radio" : "checkbox"}" name="${isBase ? "cos-base" : `cos-${escapeHtml(item.slot)}`}"
              data-cos-layer-toggle="${escapeHtml(id)}" ${checked ? "checked" : ""}>
            <button type="button" data-cos-select-layer="${escapeHtml(id)}">${escapeHtml(itemLabel(id, item))}</button>
            <small>z ${escapeHtml(item.z)}</small>
          </label>
        `;
      }).join("")}
    </div>
  `).join("");
}

function renderBasePieceSwitcher(manifest) {
  const present = BASE_PIECE_IDS.filter((id) => itemAssetExists(manifest.items[id]));
  if (present.length === 0) return "";
  return `
    <div class="cos-editor-base-switcher">
      <span class="picker-label">Base piece</span>
      <div class="cos-editor-base-switcher-row">
        ${present.map((id) => {
          const piece = (id.split("__").pop() || "").trim();
          const active = state.baseId === id ? " active" : "";
          return `<button type="button" class="${active.trim()}" data-cos-base-piece="${escapeHtml(id)}">${escapeHtml(piece)}</button>`;
        }).join("")}
      </div>
    </div>
  `;
}

function renderCatalogDraft() {
  const draft = state.catalogDraft;
  if (!draft) return "";
  return `
    <form class="cos-catalog-form" data-cos-catalog-form>
      <div class="cos-catalog-preview">
        <img src="${escapeHtml(draft.src)}" alt="">
        <div>
          <h3>Catalog asset</h3>
          <small>${escapeHtml(filenameStem(draft.src))}</small>
        </div>
      </div>
      <label>Manifest ID <input value="${escapeHtml(draft.id)}" data-cos-catalog-field="id"></label>
      <label>Slot
        <select data-cos-catalog-field="slot">
          ${SLOT_OPTIONS.map((slot) => `<option value="${slot}" ${draft.slot === slot ? "selected" : ""}>${slot}</option>`).join("")}
        </select>
      </label>
      <label>Piece <input value="${escapeHtml(draft.piece)}" placeholder="blank for generic" data-cos-catalog-field="piece"></label>
      <label>Persona <input value="${escapeHtml(draft.persona)}" data-cos-catalog-field="persona"></label>
      <label>Function <input value="${escapeHtml(draft.function)}" data-cos-catalog-field="function"></label>
      <label>Rarity <input value="${escapeHtml(draft.rarity)}" data-cos-catalog-field="rarity"></label>
      <label>Z-index <input type="number" value="${escapeHtml(draft.z)}" data-cos-catalog-field="z"></label>
      <label>Anchor
        <select data-cos-catalog-field="anchor">
          ${Object.keys(state.manifest.canvas?.anchors || {}).map((anchor) => `<option value="${anchor}" ${draft.anchor === anchor ? "selected" : ""}>${anchor}</option>`).join("")}
        </select>
      </label>
      <label>Density min
        <select data-cos-catalog-field="density_min">
          ${DENSITIES.map((density) => `<option value="${density}" ${draft.density_min === density ? "selected" : ""}>${density}</option>`).join("")}
        </select>
      </label>
      <label class="cos-catalog-checkbox">
        <input type="checkbox" ${draft.fill_canvas ? "checked" : ""} data-cos-catalog-field="fill_canvas">
        Fill canvas
      </label>
      <div class="cos-catalog-actions">
        <button type="submit" class="primary">Create manifest item</button>
        <button type="button" data-cos-catalog-cancel>Cancel</button>
      </div>
    </form>
  `;
}

function renderAssetDiagnostics() {
  const missing = missingManifestIds();
  const uncatalogued = uncataloguedAssets();
  if (!state.assetPaths) return `<p class="muted small">Syncing asset folder...</p>`;
  if (missing.length === 0 && uncatalogued.length === 0) {
    return `<p class="muted small">Manifest and asset folder are in sync.</p>`;
  }
  return `
    <section class="card cos-asset-diagnostics">
      <div class="cos-asset-diagnostics-head">
        <h2>Asset folder</h2>
        ${missing.length ? `<button type="button" data-cos-prune-missing>Prune missing refs</button>` : ""}
      </div>
      ${missing.length ? `
        <div>
          <h3>Missing manifest refs</h3>
          <ul>${missing.map((id) => `<li><code>${escapeHtml(id)}</code> <small>${escapeHtml(state.manifest.items[id]?.asset?.src)}</small></li>`).join("")}</ul>
        </div>
      ` : ""}
      ${uncatalogued.length ? `
        <div>
          <h3>Uncatalogued assets</h3>
          <ul>${uncatalogued.map((src) => `
            <li>
              <code>${escapeHtml(src.replace("/assets/cosmetics/", ""))}</code>
              <button type="button" data-cos-catalog-asset="${escapeHtml(src)}">Catalog</button>
            </li>
          `).join("")}</ul>
        </div>
      ` : ""}
      ${renderCatalogDraft()}
    </section>
  `;
}

function renderInspector() {
  const item = selectedItem();
  if (!item) return `<p class="muted">Select a layer.</p>`;
  const asset = item.asset || {};
  const offset = asset.offset || { dx: 0, dy: 0 };
  const scale = Number(asset.scale ?? 1);
  const opacity = Number(asset.opacity ?? 1);
  return `
    <div class="cos-editor-inspector">
      <h3>${escapeHtml(itemLabel(state.selectedId, item))}</h3>
      <p class="muted small">${escapeHtml(state.selectedId)}</p>
      <div class="cos-editor-fields">
        <label>X offset <input type="number" step="1" data-cos-field="offset.dx" value="${escapeHtml(offset.dx ?? 0)}"></label>
        <label>Y offset <input type="number" step="1" data-cos-field="offset.dy" value="${escapeHtml(offset.dy ?? 0)}"></label>
        <label>Scale <input type="number" step="0.01" min="0.1" max="4" data-cos-field="asset.scale" value="${escapeHtml(scale)}"></label>
        <label>Z-index <input type="number" step="1" data-cos-field="z" value="${escapeHtml(item.z ?? 0)}"></label>
        <label>Opacity <input type="number" step="0.05" min="0" max="1" data-cos-field="asset.opacity" value="${escapeHtml(opacity)}"></label>
      </div>
      <div class="cos-editor-nudge">
        <button type="button" data-cos-nudge="0,-1">Up</button>
        <button type="button" data-cos-nudge="-1,0">Left</button>
        <button type="button" data-cos-nudge="1,0">Right</button>
        <button type="button" data-cos-nudge="0,1">Down</button>
      </div>
    </div>
  `;
}

export function renderCosmeticsEditor() {
  const manifest = ensureEditorManifest();
  if (!manifest) {
    return `<section class="dev-cosmetics"><p class="muted">Loading cosmetics manifest...</p></section>`;
  }
  const patch = JSON.stringify(manifestPatch(), null, 2);
  return `
    <section class="dev-cosmetics">
      <header class="dev-cosmetics-head">
        <div>
          <span class="picker-label">Dev tools</span>
          <h1>Cosmetics composition canvas</h1>
          <p class="muted">Tune the core family on a 256x256 model. Drag layers directly; save writes manifest.json.</p>
        </div>
        <div class="dev-cosmetics-actions">
          <button type="button" data-cos-copy>Copy diff</button>
          <button type="button" class="primary" data-cos-save>Save manifest</button>
        </div>
      </header>
      ${state.notice ? `<p class="notice">${escapeHtml(state.notice)}</p>` : ""}
      ${state.error ? `<p class="error-line">${escapeHtml(state.error)}</p>` : ""}
      ${renderAssetDiagnostics()}
      <div class="dev-cosmetics-grid">
        <aside class="card cos-editor-panel">
          <h2>Layers</h2>
          ${renderLayerFilterBar(manifest)}
          <div class="cos-editor-layer-list">${renderLayerControls(manifest)}</div>
        </aside>
        <section class="card cos-editor-stage">
          ${renderBasePieceSwitcher(manifest)}
          <div class="cos-editor-density-tabs">
            ${DENSITIES.map((d) => `<button type="button" class="${state.density === d ? "active" : ""}" data-cos-density="${d}">${d}</button>`).join("")}
          </div>
          ${renderCanvas(DISPLAY_SIZE, state.density, true)}
        </section>
        <aside class="card cos-editor-panel">
          ${renderInspector()}
        </aside>
      </div>
      <section class="card cos-density-preview">
        <h2>Density preview</h2>
        <div class="cos-density-row">
          ${DENSITIES.map((d) => `
            <div>
              ${renderCanvas(Number(manifest.density_modes?.[d]?.size_px ?? 64), d, false)}
              <small>${d}</small>
            </div>
          `).join("")}
        </div>
      </section>
      <section class="card cos-editor-json">
        <h2>Manifest diff</h2>
        <textarea readonly>${escapeHtml(patch)}</textarea>
      </section>
    </section>
  `;
}

function updateSelectedField(path, rawValue) {
  const item = selectedItem();
  if (!item) return;
  const value = Number(rawValue);
  if (path === "z") item.z = value;
  if (path === "offset.dx") {
    item.asset.offset = item.asset.offset || { dx: 0, dy: 0 };
    item.asset.offset.dx = value;
  }
  if (path === "offset.dy") {
    item.asset.offset = item.asset.offset || { dx: 0, dy: 0 };
    item.asset.offset.dy = value;
  }
  if (path === "asset.scale") item.asset.scale = value;
  if (path === "asset.opacity") item.asset.opacity = value;
}

function nudgeSelected(dx, dy) {
  const item = selectedItem();
  if (!item) return;
  item.asset.offset = item.asset.offset || { dx: 0, dy: 0 };
  item.asset.offset.dx = Number(item.asset.offset.dx ?? 0) + dx;
  item.asset.offset.dy = Number(item.asset.offset.dy ?? 0) + dy;
}

function pruneMissingManifestRefs() {
  const missing = missingManifestIds();
  for (const id of missing) {
    delete state.manifest.items[id];
    state.enabled.delete(id);
  }
  normalizeSelections();
  state.notice = `Pruned ${missing.length} missing manifest ${missing.length === 1 ? "reference" : "references"}. Save manifest to persist.`;
}

async function createCatalogItem(rerender) {
  const draft = state.catalogDraft;
  if (!draft) return;
  state.error = "";
  try {
    const id = uniqueItemId(draft.id);
    const size = await imageSize(draft.src);
    const acquisitionMode = draft.slot === "border" ? "auto_tier_grant" : draft.slot === "base" ? "rating_class" : "dev_catalog";
    const item = {
      kind: ["atom"],
      slot: draft.slot,
      z: Number(draft.z),
      coupling: draft.piece ? "piece_coupled" : "generic",
      persona: draft.persona || null,
      function: draft.function || "identity",
      rarity: draft.rarity || "common",
      acquisition: { mode: acquisitionMode },
      asset: {
        src: draft.src,
        natural_size: size,
        anchor: draft.anchor,
        offset: { dx: 0, dy: 0 },
        scale: 1,
        opacity: 1
      },
      rendering: { density_min: draft.density_min }
    };
    if (draft.piece) item.piece = draft.piece;
    if (draft.fill_canvas) item.asset.fill_canvas = true;
    if (draft.slot === "border") item.trust_exclusivity = true;
    state.manifest.items[id] = item;
    if (draft.slot === "base") state.baseId = id;
    else state.enabled.add(id);
    state.selectedId = id;
    state.catalogDraft = null;
    state.notice = `Catalogued ${id}. Tune it, then save manifest.`;
  } catch (error) {
    state.error = error.message;
  }
  rerender();
}

async function saveManifest(rerender) {
  state.error = "";
  state.notice = "";
  try {
    const response = await fetch("/api/dev/cosmetics-manifest", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ manifest: state.manifest })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.message || "save failed");
    state.manifest = payload.manifest;
    state.savedManifest = clone(payload.manifest);
    setManifest(clone(payload.manifest));
    state.notice = "Saved manifest.json.";
  } catch (error) {
    state.error = error.message;
  }
  rerender();
}

async function copyDiff() {
  const text = JSON.stringify(manifestPatch(), null, 2);
  await navigator.clipboard.writeText(text);
  state.notice = "Copied manifest diff.";
}

export function bindCosmeticsEditor(rerender) {
  if (!state.manifest) return;
  loadAssetIndex(rerender);
  document.querySelectorAll("[data-cos-layer-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.cosLayerToggle;
      const item = state.manifest.items[id];
      if (item?.slot === "base") state.baseId = id;
      else if (input.checked) state.enabled.add(id);
      else state.enabled.delete(id);
      state.selectedId = id;
      rerender();
    });
  });
  document.querySelectorAll("[data-cos-select-layer]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.cosSelectLayer;
      rerender();
    });
  });
  document.querySelectorAll("[data-cos-density]").forEach((button) => {
    button.addEventListener("click", () => {
      state.density = button.dataset.cosDensity;
      rerender();
    });
  });
  document.querySelectorAll("[data-cos-base-piece]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.cosBasePiece;
      if (!state.manifest?.items?.[id]) return;
      state.baseId = id;
      state.selectedId = id;
      rerender();
    });
  });
  document.querySelectorAll("[data-cos-layer-slot]").forEach((button) => {
    button.addEventListener("click", () => {
      state.layerFilter.slot = button.dataset.cosLayerSlot;
      rerender();
    });
  });
  const searchInput = document.querySelector("[data-cos-layer-search]");
  if (searchInput) {
    // Preserve cursor/focus across rerenders: only re-render after the user
    // stops typing for 80ms. Otherwise every keystroke loses focus.
    let timer = null;
    searchInput.addEventListener("input", () => {
      state.layerFilter.query = searchInput.value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(rerender, 80);
    });
  }
  document.querySelector("[data-cos-layer-core-only]")?.addEventListener("change", (event) => {
    state.layerFilter.coreOnly = event.target.checked;
    rerender();
  });
  document.querySelectorAll("[data-cos-field]").forEach((input) => {
    input.addEventListener("input", () => {
      updateSelectedField(input.dataset.cosField, input.value);
      rerender();
    });
  });
  document.querySelectorAll("[data-cos-nudge]").forEach((button) => {
    button.addEventListener("click", () => {
      const [dx, dy] = button.dataset.cosNudge.split(",").map(Number);
      nudgeSelected(dx, dy);
      rerender();
    });
  });
  document.querySelector("[data-cos-save]")?.addEventListener("click", () => saveManifest(rerender));
  document.querySelector("[data-cos-prune-missing]")?.addEventListener("click", () => {
    pruneMissingManifestRefs();
    rerender();
  });
  document.querySelectorAll("[data-cos-catalog-asset]").forEach((button) => {
    button.addEventListener("click", () => {
      startCatalogDraft(button.dataset.cosCatalogAsset);
      rerender();
    });
  });
  document.querySelectorAll("[data-cos-catalog-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const value = input.type === "checkbox" ? input.checked : input.value;
      updateCatalogDraftField(input.dataset.cosCatalogField, value);
      rerender();
    });
  });
  document.querySelector("[data-cos-catalog-cancel]")?.addEventListener("click", () => {
    state.catalogDraft = null;
    rerender();
  });
  document.querySelector("[data-cos-catalog-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    createCatalogItem(rerender);
  });
  document.querySelector("[data-cos-copy]")?.addEventListener("click", () => {
    copyDiff().then(rerender).catch((error) => {
      state.error = error.message;
      rerender();
    });
  });

  const canvas = document.querySelector(".cos-editor-canvas");
  canvas?.querySelectorAll("[data-editor-layer]").forEach((layer) => {
    layer.addEventListener("pointerdown", (event) => {
      const id = layer.dataset.editorLayer;
      const item = state.manifest.items[id];
      if (!item) return;
      state.selectedId = id;
      item.asset.offset = item.asset.offset || { dx: 0, dy: 0 };
      const startX = event.clientX;
      const startY = event.clientY;
      const startDx = Number(item.asset.offset.dx ?? 0);
      const startDy = Number(item.asset.offset.dy ?? 0);
      const displayScale = DISPLAY_SIZE / CANVAS_SIZE;
      const move = (moveEvent) => {
        item.asset.offset.dx = Math.round(startDx + (moveEvent.clientX - startX) / displayScale);
        item.asset.offset.dy = Math.round(startDy + (moveEvent.clientY - startY) / displayScale);
        const metrics = layerMetrics(item, DISPLAY_SIZE);
        layer.style.left = `${metrics.left.toFixed(2)}px`;
        layer.style.top = `${metrics.top.toFixed(2)}px`;
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        rerender();
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  });
}
