// primitives.jsx — sketchy wireframe primitives shared across screens.

const { useState, useMemo } = React;

// Tiny chessboard placeholder.
function Board({ size = "md", pieces = false, lastMove = false, className = "" }) {
  const cells = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const dark = (r + c) % 2 === 1;
      const isLast = lastMove && ((r === 5 && c === 4) || (r === 3 && c === 4));
      cells.push(
        <div key={`${r}-${c}`} className={dark ? "d" : ""} style={isLast ? { background: "rgba(200,151,56,.45)" } : null}>
          {pieces && r === 0 && c === 4 && <span style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: "Caveat", fontWeight: 700, color: "#1b1815" }}>♚</span>}
          {pieces && r === 7 && c === 4 && <span style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: "Caveat", fontWeight: 700, color: "#1b1815" }}>♔</span>}
          {pieces && r === 3 && c === 4 && <span style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: "Caveat", fontWeight: 700, color: "#1b1815" }}>♞</span>}
        </div>
      );
    }
  }
  return <div className={`board ${size} ${className}`}>{cells}</div>;
}

// Avatar w/ optional status dot
function Av({ name = "A", size = "", status = "online", flag = null }) {
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  return (
    <div className={`av ${size}`} title={name}>
      {initial}
      <span className={`stat ${status}`}></span>
      {flag && <span style={{ position: "absolute", top: -4, left: -4, fontSize: 9, fontFamily: "JetBrains Mono", background: "#1b1815", color: "#f4ede0", borderRadius: 3, padding: "1px 3px" }}>{flag}</span>}
    </div>
  );
}

function Chip({ value = "10", variant = "" }) {
  return <span className={`chip ${variant}`}>{value}</span>;
}

function Pill({ children, variant = "" }) {
  return <span className={`pill ${variant}`}>{children}</span>;
}

// Sketchy hand-drawn arrow annotation.
function Anno({ children, dir = "left", style = {} }) {
  const arrow = dir === "down" ? (
    <svg className="anno-arrow" width="14" height="22" viewBox="0 0 14 22" fill="none">
      <path d="M7 1 C 5 6, 10 12, 7 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M3 16 L7 21 L12 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ) : dir === "right" ? (
    <svg className="anno-arrow" width="28" height="14" viewBox="0 0 28 14" fill="none">
      <path d="M1 7 C 8 5, 16 9, 26 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M21 2 L27 7 L21 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  ) : (
    <svg className="anno-arrow" width="28" height="14" viewBox="0 0 28 14" fill="none">
      <path d="M27 7 C 20 5, 12 9, 2 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M7 2 L1 7 L7 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
  return (
    <div className="anno-row" style={style}>
      {arrow}
      <div className="anno">{children}</div>
    </div>
  );
}

// Sparkline placeholder. Up = winning, dn = losing, flat = mixed.
function Spark({ kind = "up" }) {
  const paths = {
    up: "M0 24 L12 20 L24 22 L36 14 L48 16 L60 10 L72 12 L84 4",
    dn: "M0 6 L12 10 L24 8 L36 14 L48 12 L60 18 L72 16 L84 24",
    flat: "M0 14 L12 10 L24 16 L36 12 L48 18 L60 12 L72 16 L84 12",
  };
  return (
    <svg className={`spark ${kind}`} viewBox="0 0 84 28" preserveAspectRatio="none">
      <path d={paths[kind] || paths.flat} />
    </svg>
  );
}

// Visual section header inside an artboard's canvas.
function Strap({ name, sub, tag }) {
  return (
    <div className="strap">
      <div className="nm">
        {name}
        {sub && <small>{sub}</small>}
      </div>
      {tag && <span className="tag">{tag}</span>}
    </div>
  );
}

// Stamp at top-left of an artboard.
function Stamp({ id, v, label }) {
  return (
    <div className="stamp">
      {id} <span className="v">v{v}</span> · {label}
    </div>
  );
}

// Image / shot placeholder.
function Ph({ label, h = 80, style = {} }) {
  return (
    <div className="ph" style={{ height: h, ...style }}>
      {label}
    </div>
  );
}

// "Photo" of an opponent — circular placeholder with monogram inside an arc.
function HeadShot({ name = "?", size = 64 }) {
  return (
    <div
      className="ph"
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background:
          "repeating-linear-gradient(45deg,#ede3d2,#ede3d2 5px,#e3d6bd 5px,#e3d6bd 10px)",
        borderStyle: "dashed",
        fontFamily: "Caveat",
        fontWeight: 700,
        fontSize: size * 0.42,
        color: "#1b1815",
      }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

// A "live activity dot" pulsing element.
function Heart({ children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", fontFamily: "JetBrains Mono", fontSize: 10, textTransform: "uppercase", letterSpacing: ".12em", color: "#c1392b" }}>
      <span className="heart"></span>
      {children}
    </span>
  );
}

// Generic artboard wrapper.
function Art({ id, v = 1, label, name, sub, tag, children, flat = false }) {
  return (
    <div className="art">
      <Stamp id={id} v={v} label={label} />
      <Strap name={name} sub={sub} tag={tag} />
      <div className={`canvas ${flat ? "flat" : ""}`}>{children}</div>
    </div>
  );
}

// Desktop & phone frame wrappers
function Desk({ children, label = "1440 × 900" }) {
  return (
    <div className="frame-desk desk-only">
      <div style={{ position: "absolute", right: 14, top: 9, fontFamily: "JetBrains Mono", fontSize: 9, color: "#6b6356", letterSpacing: ".14em", textTransform: "uppercase", zIndex: 2 }}>{label}</div>
      <div className="vp">{children}</div>
    </div>
  );
}

function Phone({ children, label = "iPhone · 390" }) {
  return (
    <div className="frame-phone mob-only">
      <div className="notch">{label}</div>
      <div className="vp">{children}</div>
    </div>
  );
}

Object.assign(window, {
  Board, Av, Chip, Pill, Anno, Spark, Strap, Stamp, Ph, HeadShot, Heart, Art, Desk, Phone,
});
