// hifi-system.jsx — shared primitives + reusable visual components.

const { useState, useEffect, useRef } = React;

// ─── Logo ──────────────────────────────────────────────────────────────────
function Logo({ size = "md" }) {
  const fontSize = size === "lg" ? 28 : size === "sm" ? 18 : 22;
  const markSize = size === "lg" ? 36 : size === "sm" ? 22 : 28;
  return (
    <div className="logo" style={{ fontSize, color: "var(--ink)" }}>
      <span className="logo-mark" style={{ width: markSize, height: markSize, fontSize: markSize * 0.65 }}>♞</span>
      <span>Horsey</span>
    </div>
  );
}

// ─── Avatar (initial + tinted bg) ──────────────────────────────────────────
function Av({ name = "A", size = "", status = null, flag = null, color = null }) {
  const initial = (name || "?").trim().slice(0, 1).toUpperCase();
  // hash name → color
  const colors = ["av-c1", "av-c2", "av-c3", "av-c4", "av-c5", "av-c6"];
  const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const cls = color || colors[hash % colors.length];
  return (
    <div className={`av ${size} ${cls}`}>
      {initial}
      {status && <span className={`av-stat ${status}`}></span>}
      {flag && <span className="av-flag">{flag}</span>}
    </div>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────
function Chip({ value = "10", size = "", variant = "" }) {
  return <span className={`chip ${size} ${variant}`}>{value}</span>;
}

function ChipStack({ chips }) {
  return (
    <span className="chip-stack">
      {chips.map((c, i) => <Chip key={i} value={c.v} variant={c.k || ""} size="lg" />)}
    </span>
  );
}

// ─── Pill ─────────────────────────────────────────────────────────────────
function Pill({ children, variant = "", dot = false }) {
  return (
    <span className={`pill ${variant ? `pill-${variant}` : ""}`}>
      {dot && <span className={`pill-dot ${variant === "live" ? "live" : ""}`}></span>}
      {children}
    </span>
  );
}

// ─── Mini chess board (placeholder grid, optional pieces) ──────────────────
function Board({ dark = false, withPieces = true, lastMove = false, size }) {
  const style = size ? { width: size, height: size } : {};
  return (
    <div className={`board ${dark ? "board-dark" : ""}`} style={style}>
      {lastMove && (
        <>
          <div className="board-last" style={{ left: "50%", top: "62.5%", width: "12.5%", height: "12.5%" }}></div>
          <div className="board-last" style={{ left: "50%", top: "37.5%", width: "12.5%", height: "12.5%" }}></div>
        </>
      )}
      {withPieces && <BoardPieces dark={dark} />}
    </div>
  );
}

function BoardPieces({ dark }) {
  // sparse arrangement of unicode chess pieces — mid-game-ish
  const lightCol = dark ? "#f5ede0" : "#1a1612";
  const darkCol  = dark ? "#c89738" : "#4a4337";
  // pos: [col, row, piece, side]
  const positions = [
    [0,0,"♖","b"],[2,0,"♝","b"],[4,0,"♚","b"],[7,0,"♖","b"],
    [0,1,"♟","b"],[1,1,"♟","b"],[3,1,"♟","b"],[5,1,"♟","b"],[6,1,"♟","b"],[7,1,"♟","b"],
    [3,3,"♞","b"],[4,3,"♞","w"],
    [2,4,"♕","w"],
    [0,6,"♙","w"],[1,6,"♙","w"],[2,6,"♙","w"],[5,6,"♙","w"],[6,6,"♙","w"],[7,6,"♙","w"],
    [0,7,"♖","w"],[2,7,"♗","w"],[4,7,"♔","w"],[7,7,"♖","w"],
  ];
  return (
    <>
      {positions.map(([c, r, p, s], i) => (
        <div key={i} className="pc"
             style={{
               left: `${c * 12.5}%`, top: `${r * 12.5}%`, width: "12.5%", height: "12.5%",
               color: s === "w" ? lightCol : darkCol,
               textShadow: s === "w" && !dark ? "0 0 1px rgba(0,0,0,.3)" : s === "b" && dark ? "0 0 1px rgba(0,0,0,.4)" : "none",
               fontSize: "calc(min(2.4vw, 2.4vh) * 1)" // computed via container — we'll override
             }}>
          <span style={{ fontSize: "calc(100% * 1.0)" }}>{p}</span>
        </div>
      ))}
    </>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────
function Spark({ kind = "up" }) {
  const paths = {
    up:   "M0 26 L12 22 L24 24 L36 16 L48 18 L60 10 L72 12 L84 4",
    dn:   "M0 6 L12 10 L24 8 L36 14 L48 12 L60 18 L72 16 L84 24",
    flat: "M0 14 L12 10 L24 16 L36 12 L48 18 L60 12 L72 16 L84 12",
  };
  const fills = {
    up:   "M0 26 L12 22 L24 24 L36 16 L48 18 L60 10 L72 12 L84 4 L84 28 L0 28 Z",
    dn:   "M0 6 L12 10 L24 8 L36 14 L48 12 L60 18 L72 16 L84 24 L84 28 L0 28 Z",
    flat: "M0 14 L12 10 L24 16 L36 12 L48 18 L60 12 L72 16 L84 12 L84 28 L0 28 Z",
  };
  return (
    <svg className={`spark ${kind}`} viewBox="0 0 84 28" preserveAspectRatio="none">
      <path className="fill" d={fills[kind]} />
      <path className="line" d={paths[kind]} />
    </svg>
  );
}

// ─── Animated count-up text ───────────────────────────────────────────────
function CountUp({ to, prefix = "", suffix = "", duration = 1400, className = "", style = {} }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min((t - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setV(Math.round(to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <span className={className} style={style}>{prefix}{v.toLocaleString()}{suffix}</span>;
}

// ─── Live ticker (rotates through items) ──────────────────────────────────
function Ticker({ items }) {
  return (
    <div className="ticker">
      {items.slice(0, 3).map((it, i) => <div key={i}>{it}</div>)}
    </div>
  );
}

// ─── Eyebrow label ────────────────────────────────────────────────────────
function Eyebrow({ children, dot = null }) {
  return (
    <div className="eyebrow util-row" style={{ gap: 6 }}>
      {dot && <span className="pill-dot" style={{ background: dot }}></span>}
      {children}
    </div>
  );
}

// ─── Top nav bar ──────────────────────────────────────────────────────────
function TopNav({ active = "play", balance = "$1,284.00", you = "S" }) {
  const links = [
    { id: "play", label: "Play" },
    { id: "live", label: "Live" },
    { id: "friends", label: "Friends" },
    { id: "history", label: "History" },
  ];
  return (
    <div className="topnav">
      <div className="util-row gap-20">
        <Logo />
        <div className="links">
          {links.map(l => (
            <div key={l.id} className={`lnk ${l.id === active ? "on" : ""}`}>{l.label}</div>
          ))}
        </div>
      </div>
      <div className="util-row gap-12">
        <div className="util-row gap-8" style={{ padding: "6px 12px", background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 10 }}>
          <span style={{ width: 16, height: 16, borderRadius: 99, background: "linear-gradient(135deg, var(--gold-bright), var(--gold))", boxShadow: "inset 0 -1px 0 rgba(0,0,0,.2)" }}></span>
          <span className="mono tnum" style={{ fontSize: 13, fontWeight: 600 }}>{balance}</span>
          <span className="lbl-sm op-50">▾</span>
        </div>
        <button className="btn btn-sm">+ Deposit</button>
        <Av name={you} size="" status="online" />
      </div>
    </div>
  );
}

// ─── Mobile chrome (status bar + tab bar) ────────────────────────────────
function MobileChrome({ children, label = "9:41" }) {
  return (
    <div className="screen screen-mobile" style={{ position: "relative" }}>
      {/* status bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 22px 4px", fontFamily: "Inter Tight", fontWeight: 600, fontSize: 14 }}>
        <span>{label}</span>
        <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
          <svg width="16" height="10" viewBox="0 0 16 10" fill="currentColor"><rect x="0" y="6" width="2" height="4" rx="1"/><rect x="4" y="4" width="2" height="6" rx="1"/><rect x="8" y="2" width="2" height="8" rx="1"/><rect x="12" y="0" width="2" height="10" rx="1"/></svg>
          <svg width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 4 C 3 2, 11 2, 13 4 M3 6 C 5 4, 9 4, 11 6 M5 8 C 6 7, 8 7, 9 8"/></svg>
          <svg width="22" height="10" viewBox="0 0 22 10" fill="none"><rect x="0.5" y="0.5" width="18" height="9" rx="2" stroke="currentColor"/><rect x="2" y="2" width="14" height="6" rx="1" fill="currentColor"/><rect x="19.5" y="3.5" width="1.5" height="3" rx=".5" fill="currentColor"/></svg>
        </span>
      </div>
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {children}
      </div>
    </div>
  );
}

function MobileTabBar({ active = "play" }) {
  const tabs = [
    { id: "play",    label: "Play",    icon: "♞" },
    { id: "live",    label: "Live",    icon: "●" },
    { id: "find",    label: "",        icon: "+", primary: true },
    { id: "friends", label: "Friends", icon: "◇" },
    { id: "me",      label: "Me",      icon: "○" },
  ];
  return (
    <div style={{ position: "absolute", left: 12, right: 12, bottom: 18, background: "rgba(245,237,224,.92)", backdropFilter: "blur(20px)", border: "1px solid var(--rule)", borderRadius: 20, padding: "8px 12px", display: "flex", justifyContent: "space-around", alignItems: "center", boxShadow: "0 12px 32px -8px rgba(20,17,13,.25)" }}>
      {tabs.map(t => (
        t.primary ? (
          <button key={t.id} className="btn btn-primary" style={{ width: 48, height: 48, padding: 0, fontSize: 26, lineHeight: 1, borderRadius: 14 }}>{t.icon}</button>
        ) : (
          <div key={t.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: t.id === active ? "var(--ink)" : "var(--pencil)", padding: "4px 6px" }}>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{t.icon}</span>
            <span style={{ fontFamily: "Inter", fontWeight: 600, fontSize: 10 }}>{t.label}</span>
          </div>
        )
      ))}
    </div>
  );
}

// ─── Money number (gold styling) ──────────────────────────────────────────
function Money({ amount, sign = "+", className = "h-hero", style = {}, currency = "$" }) {
  return (
    <span className={`mono tnum ${className}`} style={style}>{sign}{currency}{amount}</span>
  );
}

// ─── Clock display ────────────────────────────────────────────────────────
function Clock({ time, urgent = false, active = false }) {
  return (
    <div className="mono tnum" style={{
      padding: "8px 14px",
      borderRadius: 10,
      background: urgent ? "linear-gradient(180deg, var(--red), #8a2519)" : active ? "linear-gradient(180deg, var(--gold-bright), var(--gold))" : "var(--paper-2)",
      color: urgent ? "#fff" : active ? "#1a1108" : "var(--ink-2)",
      fontWeight: 700, fontSize: 22, letterSpacing: "-.02em",
      boxShadow: urgent ? "0 0 24px rgba(193,57,43,.4), inset 0 -1px 0 rgba(0,0,0,.2)" : active ? "0 4px 12px -2px rgba(200,151,56,.5), inset 0 -1px 0 rgba(0,0,0,.15)" : "inset 0 1px 0 rgba(255,255,255,.5)",
      border: urgent ? "1px solid #8a2519" : active ? "1px solid #7a571c" : "1px solid var(--rule)",
      animation: urgent ? "ho-pulse-clock 1s ease-in-out infinite" : "none",
      display: "inline-block"
    }}>{time}</div>
  );
}

Object.assign(window, {
  Logo, Av, Chip, ChipStack, Pill, Board, Spark, CountUp, Ticker, Eyebrow,
  TopNav, MobileChrome, MobileTabBar, Money, Clock,
});
