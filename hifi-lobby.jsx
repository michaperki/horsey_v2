// hifi-lobby.jsx — Lobby desktop + mobile hi-fi.

const STAKES = [
  { v: "1",   k: "" },
  { v: "5",   k: "" },
  { v: "10",  k: "" },
  { v: "25",  k: "green" },
  { v: "50",  k: "green" },
  { v: "100", k: "red" },
  { v: "250", k: "red" },
  { v: "500", k: "black" },
  { v: "1K",  k: "purple" },
];

const TIMES = [
  { v: "1+0",   k: "bullet" },
  { v: "2+1",   k: "bullet" },
  { v: "3+0",   k: "blitz"  },
  { v: "3+2",   k: "blitz"  },
  { v: "5+0",   k: "blitz"  },
  { v: "10+0",  k: "rapid"  },
  { v: "15+10", k: "rapid"  },
];

const LIVE_FEED = [
  { a: "Vish", b: "Drei", amt: "$500", t: "blitz", state: "live", win: "+$475" },
  { a: "Mira", b: "Kobe", amt: "$50",  t: "3+0",   state: "live" },
  { a: "Aoi",  b: "Pax",  amt: "$25",  t: "5+0",   state: "wait" },
  { a: "Nox",  b: "Yui",  amt: "$100", t: "3+2",   state: "wait" },
  { a: "Reza", b: "Tomi", amt: "$10",  t: "1+0",   state: "live" },
  { a: "Ko",   b: "Vex",  amt: "$250", t: "10+0",  state: "wait" },
];

const RIVALS = [
  { n: "Vish", r: "2433", state: "ingame", flag: "IN", note: "h2h 2–5", hot: true },
  { n: "Kobe", r: "2104", state: "online", flag: "JP", note: "h2h 3–3" },
  { n: "Aoi",  r: "1985", state: "online", flag: "JP", note: "h2h 4–2" },
  { n: "Drei", r: "1567", state: "idle",   flag: "DE", note: "h2h 6–1" },
];

const OPEN_TABLES = [
  { n: "Mira",  r: 1842, flag: "GR", chip: { v: "50",  k: "green" }, t: "3+0",  style: "aggro · w5",  rep: "★4.6", spark: "up" },
  { n: "Vish",  r: 2433, flag: "IN", chip: { v: "250", k: "red" },   t: "3+0",  style: "solid · w11", rep: "★4.8", spark: "up", rival: true },
  { n: "Kobe",  r: 2104, flag: "JP", chip: { v: "100", k: "red" },   t: "5+0",  style: "tactical",    rep: "★4.5", spark: "flat" },
  { n: "Pax",   r: 1718, flag: "BR", chip: { v: "10",  k: "" },      t: "1+0",  style: "blitz",       rep: "★4.2", spark: "up" },
  { n: "Aoi",   r: 1985, flag: "JP", chip: { v: "25",  k: "green" }, t: "10+0", style: "ice cold",    rep: "★4.7", spark: "flat" },
  { n: "Drei",  r: 1567, flag: "DE", chip: { v: "25",  k: "green" }, t: "3+2",  style: "wild · L3",   rep: "★3.8", spark: "dn" },
];

// ─── HERO QUICK-PLAY MODULE ─────────────────────────────────────────────────
function QuickplayHero() {
  const [stakeIdx, setStakeIdx] = useState(4);
  const [timeIdx, setTimeIdx] = useState(2);
  const stake = STAKES[stakeIdx];
  const time = TIMES[timeIdx];
  const stakeNum = stake.v === "1K" ? 1000 : parseInt(stake.v);
  const pot = Math.round(stakeNum * 2 * 0.95);

  return (
    <div className="felt-card" style={{ padding: 28 }}>
      <div className="between">
        <div className="util-row gap-8">
          <Pill variant="felt" dot><span style={{ color: "#fff" }}>Quick match</span></Pill>
          <Pill variant="felt">no friction · ~4s wait</Pill>
        </div>
        <div className="util-col" style={{ alignItems: "flex-end" }}>
          <span className="eyebrow" style={{ color: "rgba(245,237,224,.6)" }}>You're playing as</span>
          <div className="util-row gap-6"><Av name="S" size="sm" color="av-c4" /><span className="lbl" style={{ color: "#f5ede0", fontWeight: 600 }}>Sam · 1932</span></div>
        </div>
      </div>

      <div className="h-hero mt-16" style={{ fontSize: 52, color: "#f5ede0", maxWidth: 560 }}>
        Pick a chip.<br />Sit down.
      </div>

      {/* stake selector */}
      <div className="mt-24">
        <div className="util-row between">
          <span className="eyebrow" style={{ color: "rgba(245,237,224,.7)" }}>Stake</span>
          <span className="lbl-sm" style={{ color: "rgba(245,237,224,.6)" }}>or type custom amount</span>
        </div>
        <div className="util-row gap-8 mt-8" style={{ flexWrap: "wrap", alignItems: "center" }}>
          {STAKES.map((c, i) => (
            <button key={c.v} onClick={() => setStakeIdx(i)}
              style={{
                background: "transparent", border: 0, padding: 0, cursor: "pointer",
                transform: i === stakeIdx ? "translateY(-4px) scale(1.08)" : "none",
                filter: i === stakeIdx ? "drop-shadow(0 6px 12px rgba(0,0,0,.4))" : "none",
                transition: "transform .14s ease, filter .14s ease",
              }}>
              <Chip value={c.v} variant={c.k} size="lg" />
              {i === stakeIdx && <div style={{ height: 3, background: "var(--gold-bright)", marginTop: 6, borderRadius: 99, boxShadow: "0 0 10px var(--gold-glow)" }}></div>}
            </button>
          ))}
        </div>
      </div>

      {/* time control */}
      <div className="mt-20">
        <span className="eyebrow" style={{ color: "rgba(245,237,224,.7)" }}>Time control</span>
        <div className="util-row gap-6 mt-8" style={{ flexWrap: "wrap" }}>
          {TIMES.map((t, i) => (
            <button key={t.v} onClick={() => setTimeIdx(i)}
              style={{
                padding: "8px 14px", borderRadius: 8,
                border: `1px solid ${i === timeIdx ? "var(--gold)" : "rgba(255,255,255,.15)"}`,
                background: i === timeIdx ? "rgba(200,151,56,.18)" : "rgba(255,255,255,.04)",
                color: "#f5ede0", fontFamily: "Inter Tight", fontWeight: 600, fontSize: 13,
                cursor: "pointer", display: "flex", alignItems: "baseline", gap: 6,
              }}>
              <span className="mono tnum">{t.v}</span>
              <span className="lbl-sm op-50">{t.k}</span>
            </button>
          ))}
        </div>
      </div>

      {/* CTA + summary */}
      <div className="util-row gap-16 mt-24" style={{ alignItems: "stretch" }}>
        <button className="btn btn-primary btn-xl grow" style={{ fontSize: 22, padding: "20px 28px", animation: "ho-glow 3s ease-in-out infinite" }}>
          <span>Find me a game</span>
          <span style={{ fontSize: 22, marginLeft: 4 }}>→</span>
        </button>
        <div style={{ padding: "12px 18px", background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 14, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 140 }}>
          <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Pot if you win</span>
          <span className="mono tnum" style={{ fontSize: 26, color: "var(--gold-bright)", fontWeight: 700, lineHeight: 1.1 }}>+${pot}</span>
          <span className="lbl-sm" style={{ color: "rgba(245,237,224,.5)" }}>5% rake · escrowed</span>
        </div>
      </div>

      {/* recent rematches */}
      <div className="mt-20" style={{ paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.1)" }}>
        <div className="util-row between">
          <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Pick up where you left off</span>
          <span className="lbl-sm" style={{ color: "rgba(245,237,224,.5)" }}>last 4 opponents</span>
        </div>
        <div className="util-row gap-8 mt-8">
          {[
            { n: "Vish", a: "+$225", w: true,  amt: "$250" },
            { n: "Kobe", a: "−$50",  w: false, amt: "$50" },
            { n: "Mira", a: "+$45",  w: true,  amt: "$50" },
            { n: "Aoi",  a: "+$240", w: true,  amt: "$100" },
          ].map(r => (
            <button key={r.n} className="util-row gap-8 grow"
              style={{ padding: "8px 12px", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, cursor: "pointer" }}>
              <Av name={r.n} size="sm" />
              <div className="util-col" style={{ gap: 0, textAlign: "left" }}>
                <span className="lbl-sm" style={{ color: "#f5ede0", fontWeight: 600 }}>↺ {r.n}</span>
                <span className="mono lbl-sm tnum" style={{ color: r.w ? "var(--gold-bright)" : "rgba(245,237,224,.55)" }}>{r.a}</span>
              </div>
              <span className="mono lbl-sm tnum" style={{ marginLeft: "auto", color: "rgba(245,237,224,.7)" }}>{r.amt}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── LIVE FLOOR PANEL ───────────────────────────────────────────────────────
function LiveFloor() {
  return (
    <div className="util-col gap-12 h-full">
      {/* heartbeat */}
      <div className="surf pad-12 between">
        <div className="util-row gap-8">
          <span className="pill-dot live" style={{ width: 8, height: 8 }}></span>
          <span className="lbl" style={{ fontWeight: 600 }}>1,204 online</span>
          <span className="lbl op-50">·</span>
          <span className="lbl" style={{ color: "var(--ink-3)" }}>412 in active games</span>
        </div>
        <button className="btn btn-ghost btn-sm">view all →</button>
      </div>

      {/* hot upset */}
      <div className="card" style={{ padding: 16, background: "linear-gradient(135deg, var(--surface) 0%, rgba(193,57,43,.06) 100%)", borderColor: "rgba(193,57,43,.2)" }}>
        <div className="util-row between">
          <Pill variant="hot" dot>upset</Pill>
          <span className="lbl-sm op-50">2m ago</span>
        </div>
        <div className="util-row gap-8 mt-12" style={{ alignItems: "center" }}>
          <Av name="D" size="lg" />
          <div className="grow">
            <div className="h-3" style={{ fontSize: 16 }}>Drei <span className="mono lbl-sm op-50">1567</span> beat Vish <span className="mono lbl-sm op-50">2433</span></div>
            <div className="util-row gap-4 mt-4">
              <Pill variant="gold">+$475</Pill>
              <Pill>866 elo gap</Pill>
            </div>
          </div>
        </div>
      </div>

      {/* live games list */}
      <div className="surf pad-12" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="util-row between" style={{ marginBottom: 10 }}>
          <span className="eyebrow">Live games</span>
          <div className="util-row gap-4">
            <Pill variant="dark">all</Pill>
            <Pill>$100+</Pill>
            <Pill>rivals</Pill>
          </div>
        </div>
        <div className="util-col gap-6" style={{ overflow: "hidden", flex: 1 }}>
          {LIVE_FEED.slice(0, 6).map((f, i) => (
            <div key={i} className="util-row gap-8 between" style={{ padding: "8px 10px", borderRadius: 8, background: i === 0 ? "rgba(43,138,79,.06)" : "transparent", border: `1px solid ${i === 0 ? "rgba(43,138,79,.15)" : "transparent"}` }}>
              <div className="util-row gap-6">
                <Av name={f.a} size="sm" status={f.state === "live" ? "ingame" : "online"} />
                <span className="lbl-sm op-50">vs</span>
                <Av name={f.b} size="sm" status={f.state === "live" ? "ingame" : "online"} />
              </div>
              <div className="util-col" style={{ gap: 0, textAlign: "right", minWidth: 60 }}>
                <span className="mono lbl tnum" style={{ fontWeight: 600 }}>{f.amt}</span>
                <span className="lbl-sm op-50">{f.t}</span>
              </div>
              {f.state === "live"
                ? <button className="btn btn-sm" style={{ minWidth: 64 }}>watch</button>
                : <button className="btn btn-sm btn-dark" style={{ minWidth: 64 }}>join</button>}
            </div>
          ))}
        </div>
      </div>

      {/* rivals */}
      <div className="surf pad-12">
        <div className="between" style={{ marginBottom: 10 }}>
          <span className="eyebrow">Your rivals</span>
          <span className="lbl-sm op-50">2 online</span>
        </div>
        <div className="util-col gap-6">
          {RIVALS.map(r => (
            <div key={r.n} className="util-row gap-8 between">
              <div className="util-row gap-8">
                <Av name={r.n} size="sm" flag={r.flag} status={r.state} />
                <div className="util-col" style={{ gap: 0 }}>
                  <span className="lbl" style={{ fontWeight: 600 }}>{r.n} <span className="mono op-50">{r.r}</span></span>
                  <span className="lbl-sm op-50">{r.note}</span>
                </div>
              </div>
              {r.hot
                ? <button className="btn btn-sm" style={{ background: "rgba(193,57,43,.1)", color: "var(--red)", borderColor: "rgba(193,57,43,.3)" }}>spectate</button>
                : r.state === "online" ? <button className="btn btn-sm btn-dark">challenge</button> : <span className="lbl-sm op-50">{r.state}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── OPEN TABLES ROW ────────────────────────────────────────────────────────
function OpenTables() {
  return (
    <div>
      <div className="util-row between" style={{ marginBottom: 12 }}>
        <div className="util-row gap-12" style={{ alignItems: "baseline" }}>
          <span className="h-2" style={{ fontSize: 22 }}>Open tables</span>
          <span className="lbl op-50">{OPEN_TABLES.length} players waiting · auto-refresh</span>
        </div>
        <div className="util-row gap-4">
          <Pill variant="dark">all</Pill>
          <Pill>bullet</Pill>
          <Pill>blitz</Pill>
          <Pill>rapid</Pill>
          <Pill variant="gold">$100+</Pill>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0,1fr))", gap: 10 }}>
        {OPEN_TABLES.map((p, i) => (
          <div key={p.n} className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10, position: "relative", overflow: "hidden", borderColor: p.rival ? "rgba(193,57,43,.3)" : "var(--rule)" }}>
            {p.rival && <div style={{ position: "absolute", top: 0, right: 0, padding: "2px 8px", background: "var(--red)", color: "#fff", fontFamily: "Inter", fontWeight: 700, fontSize: 9, letterSpacing: ".08em", borderBottomLeftRadius: 8 }}>RIVAL</div>}
            <div className="util-row gap-8 between">
              <div className="util-row gap-8">
                <Av name={p.n} size="lg" flag={p.flag} status="online" />
                <div className="util-col" style={{ gap: 0 }}>
                  <span className="h-3" style={{ fontSize: 15 }}>{p.n}</span>
                  <span className="mono lbl-sm op-70 tnum">{p.r} · {p.rep}</span>
                </div>
              </div>
              <Chip value={p.chip.v} variant={p.chip.k} />
            </div>
            <div className="util-row gap-6">
              <Pill>{p.t}</Pill>
              <Pill variant={p.spark === "up" ? "green" : p.spark === "dn" ? "hot" : ""}>{p.style}</Pill>
            </div>
            <Spark kind={p.spark} />
            <button className="btn btn-dark" style={{ width: "100%" }}>Sit · ${p.chip.v === "1K" ? "1,000" : p.chip.v}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── LOBBY DESKTOP ──────────────────────────────────────────────────────────
function LobbyDesktop() {
  return (
    <div className="screen">
      <TopNav active="play" />
      <div className="stage" style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gridTemplateRows: "auto 1fr", gap: 20 }}>
        <QuickplayHero />
        <div style={{ gridRow: "1 / span 2" }}>
          <LiveFloor />
        </div>
        <OpenTables />
      </div>
    </div>
  );
}

// ─── LOBBY MOBILE ───────────────────────────────────────────────────────────
function LobbyMobile() {
  return (
    <MobileChrome>
      <div style={{ padding: "8px 16px 96px", height: "100%", overflow: "auto" }}>
        {/* top bar */}
        <div className="between" style={{ paddingTop: 6, paddingBottom: 12 }}>
          <Logo size="sm" />
          <div className="util-row gap-8">
            <div className="util-row gap-6" style={{ padding: "4px 10px", background: "var(--surface)", border: "1px solid var(--rule)", borderRadius: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: 99, background: "linear-gradient(135deg, var(--gold-bright), var(--gold))" }}></span>
              <span className="mono lbl-sm tnum" style={{ fontWeight: 600 }}>$1,284</span>
            </div>
            <Av name="S" size="sm" status="online" />
          </div>
        </div>

        {/* hero */}
        <div className="felt-card" style={{ padding: 16 }}>
          <div className="util-row between">
            <Pill variant="felt" dot><span style={{ color: "#fff" }}>1.2k online</span></Pill>
            <span className="lbl-sm" style={{ color: "rgba(245,237,224,.6)" }}>~4s wait</span>
          </div>
          <div className="h-hero mt-12" style={{ fontSize: 28, color: "#f5ede0" }}>Quick match</div>
          <div className="util-row gap-6 mt-8" style={{ overflowX: "auto", paddingBottom: 4 }}>
            {STAKES.slice(0, 7).map((c, i) => (
              <span key={c.v} style={{ transform: i === 3 ? "translateY(-2px) scale(1.08)" : "none", transition: "transform .14s", flexShrink: 0 }}>
                <Chip value={c.v} variant={c.k} />
              </span>
            ))}
          </div>
          <div className="util-row gap-4 mt-8">
            {["1+0","3+0","5+0","10+0"].map((t, i) => (
              <span key={t} style={{ padding: "5px 10px", borderRadius: 7, fontFamily: "Inter Tight", fontWeight: 600, fontSize: 12, color: "#f5ede0", border: `1px solid ${i === 1 ? "var(--gold)" : "rgba(255,255,255,.15)"}`, background: i === 1 ? "rgba(200,151,56,.18)" : "rgba(255,255,255,.04)" }}>{t}</span>
            ))}
          </div>
          <button className="btn btn-primary btn-lg mt-12 w-full" style={{ fontSize: 18, padding: "16px 20px", animation: "ho-glow 3s ease-in-out infinite" }}>
            Find a game · $25 →
          </button>
          <div className="lbl-sm tac mt-8" style={{ color: "rgba(245,237,224,.55)" }}>winner takes <b style={{ color: "var(--gold-bright)" }}>$48</b> · 5% rake</div>
        </div>

        {/* filter chips */}
        <div className="util-row gap-4 mt-16" style={{ overflowX: "auto", paddingBottom: 4 }}>
          {["All", "Bullet", "Blitz", "Rapid", "Rivals", "Friends"].map((t, i) => (
            <span key={t} className={`pill ${i === 0 ? "pill-dark" : ""}`} style={{ flexShrink: 0, padding: "5px 11px" }}>{t}</span>
          ))}
        </div>

        {/* live floor strip */}
        <div className="util-row between mt-16">
          <Eyebrow dot="var(--red)">Live now</Eyebrow>
          <span className="lbl-sm op-50">412 games</span>
        </div>
        <div className="util-col gap-6 mt-8">
          {LIVE_FEED.slice(0, 2).map((f, i) => (
            <div key={i} className="util-row gap-8 between" style={{ padding: "8px 10px", border: "1px solid var(--rule)", borderRadius: 10, background: "var(--surface)" }}>
              <div className="util-row gap-4">
                <Av name={f.a} size="sm" status="ingame" />
                <span className="lbl-sm op-50">vs</span>
                <Av name={f.b} size="sm" status="ingame" />
              </div>
              <span className="mono lbl tnum" style={{ fontWeight: 600 }}>{f.amt}</span>
              <button className="btn btn-sm">watch</button>
            </div>
          ))}
        </div>

        {/* open tables list */}
        <div className="util-row between mt-16">
          <Eyebrow>Open tables</Eyebrow>
          <span className="lbl-sm op-50">8 waiting</span>
        </div>
        <div className="util-col gap-8 mt-8">
          {OPEN_TABLES.slice(0, 4).map(p => (
            <div key={p.n} className="card" style={{ padding: 12 }}>
              <div className="util-row gap-8 between">
                <div className="util-row gap-8">
                  <Av name={p.n} size="lg" flag={p.flag} status="online" />
                  <div className="util-col" style={{ gap: 1 }}>
                    <div className="util-row gap-4" style={{ alignItems: "baseline" }}>
                      <span className="h-3" style={{ fontSize: 15 }}>{p.n}</span>
                      <span className="mono lbl-sm op-50">{p.r}</span>
                    </div>
                    <span className="lbl-sm op-50">{p.t} · {p.style}</span>
                  </div>
                </div>
                <div className="util-row gap-8" style={{ alignItems: "center" }}>
                  <Chip value={p.chip.v} variant={p.chip.k} size="sm" />
                  <button className="btn btn-dark btn-sm">Sit</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <MobileTabBar active="play" />
    </MobileChrome>
  );
}

Object.assign(window, { LobbyDesktop, LobbyMobile });
