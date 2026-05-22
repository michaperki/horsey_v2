// profile.jsx — Player profile / opponent HUD variations + flow + system.

// ─── HUD V1: Compact Scout Card (pre-game popup) ─────────────────────────────
function HudCompact() {
  return (
    <div className="sk shadow" style={{ width: 340, background: "var(--paper)", padding: 14 }}>
      <div className="between">
        <div className="row gap-8" style={{ alignItems: "center" }}>
          <HeadShot name="V" size={48} />
          <div>
            <div className="hand" style={{ fontSize: 22, lineHeight: 1 }}>Vish <span className="num pencil small">2433</span></div>
            <div className="hand-2 small pencil">India · joined 2y · ★4.8</div>
          </div>
        </div>
        <Pill variant="hot">RIVAL</Pill>
      </div>

      <div className="row gap-6 mt-12">
        <div className="sk muted grow p-8 tac">
          <div className="tiny uc pencil">style</div>
          <div className="hand-2 small">Solid · slow</div>
        </div>
        <div className="sk muted grow p-8 tac">
          <div className="tiny uc pencil">WR</div>
          <div className="hand" style={{ fontSize: 16 }}>68%</div>
        </div>
        <div className="sk muted grow p-8 tac">
          <div className="tiny uc pencil">avg game</div>
          <div className="hand" style={{ fontSize: 16 }}>5m12</div>
        </div>
      </div>

      <div className="mt-8">
        <div className="tiny uc pencil">last 10</div>
        <div className="row gap-4 mt-4" style={{ flexWrap: "wrap" }}>
          {"WWWLWWLWWW".split("").map((r, i) => (
            <span key={i} className="num tiny" style={{ display: "inline-flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 4, background: r === "W" ? "#dff0e4" : "#fff1ee", color: r === "W" ? "#1f5635" : "var(--hot)", border: `1px solid ${r === "W" ? "#2b6f47" : "var(--hot)"}` }}>{r}</span>
          ))}
        </div>
      </div>

      <div className="row gap-4 mt-8">
        <Pill>W11 streak</Pill><Pill variant="green">trusted</Pill><Pill>0.4% dc</Pill>
      </div>

      <div className="row gap-6 mt-12">
        <button className="sk gold grow" style={{ padding: 8, fontFamily: "Patrick Hand", fontSize: 14 }}>challenge $250</button>
        <button className="sk grow" style={{ padding: 8, fontFamily: "Patrick Hand", fontSize: 14 }}>profile →</button>
      </div>
    </div>
  );
}

// ─── HUD V2: Full Profile Page ───────────────────────────────────────────────
function ProfileFull() {
  return (
    <Desk label="PROFILE · 1440">
      <div style={{ padding: 18, display: "grid", gridTemplateColumns: "300px 1fr 280px", gap: 16, height: "100%", minHeight: 480 }}>
        <div>
          <HeadShot name="V" size={140} />
          <div className="hand mt-8" style={{ fontSize: 32, lineHeight: 1 }}>Vish</div>
          <div className="hand-2 pencil">India · joined apr 2024</div>
          <div className="row gap-4 mt-8" style={{ flexWrap: "wrap" }}>
            <Pill variant="dark">2433 rating</Pill>
            <Pill variant="hot">W11 streak</Pill>
            <Pill variant="green">trust ★4.8</Pill>
            <Pill variant="gold">verified ID</Pill>
          </div>

          <div className="sk muted mt-12 p-12">
            <div className="tiny uc pencil">your h2h</div>
            <div className="hand" style={{ fontSize: 28, lineHeight: 1 }}>2 – 5</div>
            <div className="hand-2 small pencil">7 games · −$340 lifetime</div>
            <div className="row gap-4 mt-4">
              {"VVVuV".split("").map((r, i) => (
                <span key={i} className="num tiny" style={{ display: "inline-flex", width: 18, height: 18, alignItems: "center", justifyContent: "center", borderRadius: 4, background: r === "u" ? "#dff0e4" : "#fff1ee", color: r === "u" ? "#1f5635" : "var(--hot)", border: `1px solid ${r === "u" ? "#2b6f47" : "var(--hot)"}` }}>{r === "u" ? "W" : "L"}</span>
              ))}
            </div>
          </div>

          <div className="col gap-6 mt-12">
            <button className="sk gold p-12" style={{ fontFamily: "Caveat", fontWeight: 700, fontSize: 22 }}>CHALLENGE · $250</button>
            <div className="row gap-4">
              <button className="sk grow p-8 hand-2 small">message</button>
              <button className="sk grow p-8 hand-2 small">follow</button>
              <button className="sk grow p-8 hand-2 small">report</button>
            </div>
          </div>
        </div>

        <div>
          <div className="hand" style={{ fontSize: 22 }}>Recent earnings</div>
          <div className="sk shadow p-12 mt-4">
            <div className="between">
              <div className="hand" style={{ fontSize: 30, color: "#2b6f47" }}>+$4,182 <span className="hand-2 small pencil" style={{ color: "var(--pencil)" }}>last 30d</span></div>
              <div className="row gap-4">
                <Pill>30d</Pill><Pill variant="dark">90d</Pill><Pill>all</Pill>
              </div>
            </div>
            <div style={{ height: 110, marginTop: 8, background: "repeating-linear-gradient(0deg, transparent 0 22px, rgba(27,24,21,.05) 22px 23px)", border: "1.25px dashed var(--rule)", borderRadius: 6, position: "relative", padding: 8 }}>
              <svg viewBox="0 0 300 90" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
                <path d="M0 70 L20 60 L40 65 L60 50 L80 55 L100 40 L120 45 L140 32 L160 38 L180 22 L200 28 L220 18 L240 22 L260 12 L280 18 L300 8" fill="none" stroke="#2b6f47" strokeWidth="2" />
              </svg>
            </div>
          </div>

          <div className="row gap-8 mt-12">
            {[
              ["Games", "423", "lifetime"],
              ["Win rate", "68%", "+3% mo"],
              ["Avg game", "5m 12s", ""],
              ["Time-control", "blitz", "favourite"],
            ].map(([l, v, s]) => (
              <div key={l} className="sk grow p-12">
                <div className="tiny uc pencil">{l}</div>
                <div className="hand" style={{ fontSize: 22, lineHeight: 1 }}>{v}</div>
                {s && <div className="hand-2 small pencil">{s}</div>}
              </div>
            ))}
          </div>

          <div className="hand mt-16" style={{ fontSize: 22 }}>Tells &amp; tendencies</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
            {[
              ["Aggression",       70, "Aggressive ↑"],
              ["Time pressure",    22, "rarely flags"],
              ["Centipawn loss",   35, "low / accurate"],
              ["Resign threshold", 60, "fights to ends"],
              ["Disconnect %",     4,  "very reliable"],
              ["Opening variety",  80, "wide repertoire"],
            ].map(([l, v, sub]) => (
              <div key={l} className="sk p-8">
                <div className="between">
                  <div className="hand-2 small">{l}</div>
                  <div className="num tiny pencil">{v}</div>
                </div>
                <div style={{ height: 6, background: "var(--paper-3)", borderRadius: 99, marginTop: 4 }}>
                  <div style={{ width: `${v}%`, height: "100%", background: v > 50 ? "var(--ink)" : "var(--pencil)", borderRadius: 99 }}></div>
                </div>
                <div className="tiny pencil mt-4">{sub}</div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="hand" style={{ fontSize: 22 }}>Trust &amp; safety</div>
          <div className="sk muted p-12 mt-4 col gap-4">
            {[
              ["✓ Identity verified",  "Apr 2024"],
              ["✓ Fair-play score",    "99.2 / 100"],
              ["✓ No anti-cheat flags","past 365d"],
              ["✓ Disconnect rate",    "0.4%"],
              ["✓ Wallet age",         "2y"],
              ["✓ Reported",           "0 times"],
            ].map(([k, v]) => (
              <div key={k} className="between">
                <span className="hand-2 small">{k}</span>
                <span className="num tiny pencil">{v}</span>
              </div>
            ))}
          </div>

          <div className="hand mt-16" style={{ fontSize: 22 }}>Favourite openings</div>
          <div className="col gap-6 mt-4">
            {[
              ["Sicilian Najdorf", 32, "WR 71%"],
              ["Caro-Kann",        18, "WR 64%"],
              ["Queen's Gambit",   14, "WR 60%"],
            ].map(([n, w, wr]) => (
              <div key={n} className="sk p-8">
                <div className="between">
                  <span className="hand-2 small">{n}</span>
                  <span className="num tiny pencil">{w}% · {wr}</span>
                </div>
                <div style={{ height: 4, background: "var(--paper-3)", borderRadius: 99, marginTop: 4 }}>
                  <div style={{ width: `${w * 2.5}%`, height: "100%", background: "var(--gold)", borderRadius: 99 }}></div>
                </div>
              </div>
            ))}
          </div>

          <div className="hand mt-16" style={{ fontSize: 22 }}>Recent vs you</div>
          <div className="col gap-6 mt-4">
            {[
              { r: "L", a: "$250", d: "2d ago" },
              { r: "L", a: "$100", d: "5d" },
              { r: "W", a: "$50",  d: "1w" },
              { r: "L", a: "$25",  d: "2w" },
              { r: "W", a: "$25",  d: "3w" },
            ].map((g, i) => (
              <div key={i} className="between">
                <Pill variant={g.r === "W" ? "green" : "hot"}>{g.r}</Pill>
                <span className="num small">{g.a}</span>
                <span className="hand-2 small pencil">{g.d}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Desk>
  );
}

// ─── Trust & wallet panel ────────────────────────────────────────────────────
function TrustPanel() {
  return (
    <Desk label="WALLET · TRUST">
      <div style={{ padding: 18, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, height: "100%", minHeight: 480 }}>
        <div>
          <div className="hand" style={{ fontSize: 26, lineHeight: 1 }}>Your wallet</div>
          <div className="sk shadow felt p-16 mt-8" style={{ borderRadius: 10 }}>
            <div className="tiny uc" style={{ color: "rgba(255,255,255,.7)" }}>balance</div>
            <div className="hand" style={{ fontSize: 56, color: "var(--gold-2)", lineHeight: 1 }}>$1,284.00</div>
            <div className="hand-2 small mt-4" style={{ color: "rgba(255,255,255,.75)" }}>+$140 today · escrow $0 · withdrawable $1,284</div>
          </div>

          <div className="row gap-8 mt-12">
            <button className="sk gold grow p-12" style={{ fontFamily: "Caveat", fontWeight: 700, fontSize: 20 }}>+ Deposit</button>
            <button className="sk grow p-12" style={{ fontFamily: "Patrick Hand", fontSize: 16 }}>↓ Withdraw</button>
            <button className="sk grow p-12" style={{ fontFamily: "Patrick Hand", fontSize: 16 }}>history</button>
          </div>

          <div className="hand mt-16" style={{ fontSize: 22 }}>Last settlements</div>
          <div className="col gap-6 mt-4">
            {[
              { o: "Vish",  a: "+$225", t: "3m ago",  st: "settled" },
              { o: "Mira",  a: "+$45",  t: "1h",      st: "settled" },
              { o: "Kobe",  a: "−$50",  t: "1h",      st: "settled" },
              { o: "Drei",  a: "+$22",  t: "3h",      st: "settled" },
              { o: "Aoi",   a: "+$240", t: "yest",    st: "settled" },
            ].map((s, i) => (
              <div key={i} className="sk p-8 between">
                <div className="row gap-6" style={{ alignItems: "center" }}>
                  <Av name={s.o} size="sm" />
                  <span className="hand-2 small">vs {s.o}</span>
                </div>
                <span className="num small" style={{ color: s.a.startsWith("+") ? "#2b6f47" : "var(--hot)" }}>{s.a}</span>
                <span className="pill green">{s.st}</span>
                <span className="hand-2 pencil tiny">{s.t}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="hand" style={{ fontSize: 26, lineHeight: 1 }}>How Horsey keeps it fair</div>
          <div className="hand-2 pencil small">trust signals visible in the product, not buried in docs</div>

          <div className="col gap-8 mt-12">
            {[
              { h: "Escrow",        d: "Both stakes lock the moment a game starts. Settlement is automatic when the position resolves.", icon: "🔒" },
              { h: "Authoritative server", d: "Moves are validated server-side. Client never decides the outcome.", icon: "♛" },
              { h: "Disconnect protection", d: "Reconnect within 30s · auto-resign if abandoned · refund on platform fault.", icon: "📡" },
              { h: "Anti-cheat",    d: "Engine-pattern detection · ML behavioural model · cooldowns &amp; banks frozen on suspicion.", icon: "🛡" },
              { h: "Verified IDs",  d: "KYC on high-stake accounts (>$500) · reduces collusion &amp; chargebacks.", icon: "✓" },
              { h: "Fair-play score", d: "Public reputation number 0-100. Drops fast, recovers slow.", icon: "★" },
            ].map(item => (
              <div key={item.h} className="sk shadow p-12">
                <div className="row gap-8" style={{ alignItems: "flex-start" }}>
                  <div className="sk" style={{ width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "Caveat", fontSize: 22 }}>{item.icon}</div>
                  <div style={{ flex: 1 }}>
                    <div className="hand" style={{ fontSize: 18, lineHeight: 1 }}>{item.h}</div>
                    <div className="hand-2 small pencil" dangerouslySetInnerHTML={{ __html: item.d }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Desk>
  );
}

// ─── Flow / system overview ──────────────────────────────────────────────────
function FlowMap() {
  const nodes = [
    { x: 40,  y: 60,  l: "Open app", t: "→ lobby" },
    { x: 220, y: 60,  l: "Lobby", t: "tables · feed · quick play" },
    { x: 420, y: 60,  l: "Scout / Accept", t: "scouting card overlay" },
    { x: 620, y: 60,  l: "Escrow lock", t: "400ms anim · both stakes" },
    { x: 800, y: 60,  l: "Game", t: "board · clock · pot" },
    { x: 220, y: 200, l: "Quick wager", t: "chip-tray overlay" },
    { x: 420, y: 200, l: "Counter / decline", t: "" },
    { x: 800, y: 200, l: "Resign / mate", t: "" },
    { x: 980, y: 200, l: "Settlement", t: "$ paid out · rating shifts" },
    { x: 980, y: 60,  l: "Rematch", t: "default CTA · 10s countdown" },
  ];
  const links = [
    [0,1],[1,2],[2,3],[3,4],[4,7],[7,8],[8,9],[9,4],[1,5],[5,2],[2,6],[6,1],[8,1]
  ];
  return (
    <div className="sk shadow" style={{ padding: 16, background: "var(--paper)" }}>
      <div className="between">
        <div className="hand" style={{ fontSize: 24, lineHeight: 1 }}>Core loop</div>
        <div className="hand-2 small pencil">open → game → settle → next, with no dead-ends</div>
      </div>
      <div style={{ position: "relative", height: 280, marginTop: 8, background: "repeating-linear-gradient(0deg, transparent 0 22px, rgba(27,24,21,.04) 22px 23px)", border: "1.25px dashed var(--rule)", borderRadius: 6 }}>
        <svg viewBox="0 0 1100 280" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          {links.map(([a, b], i) => {
            const A = nodes[a], B = nodes[b];
            return <path key={i} d={`M${A.x + 70} ${A.y + 20} Q ${(A.x + B.x) / 2 + 60} ${(A.y + B.y) / 2 - 10}, ${B.x} ${B.y + 20}`} stroke="#6b6356" strokeWidth="1.25" strokeDasharray="4 3" fill="none" />;
          })}
        </svg>
        {nodes.map((n, i) => (
          <div key={i} className="sk shadow" style={{ position: "absolute", left: n.x, top: n.y, width: 140, padding: 6, background: i === 4 || i === 8 ? "var(--ink)" : "var(--paper)", color: i === 4 || i === 8 ? "var(--paper)" : "var(--ink)" }}>
            <div className="hand" style={{ fontSize: 15, lineHeight: 1 }}>{n.l}</div>
            <div className="tiny" style={{ opacity: .7 }}>{n.t}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VisualLanguage() {
  return (
    <div className="rail cols-2 mt-12" style={{ alignItems: "start" }}>
      <div className="sk shadow p-16">
        <div className="hand" style={{ fontSize: 22 }}>Color &amp; surfaces</div>
        <div className="row gap-8 mt-8">
          {[
            ["Paper", "#f4ede0", "var(--paper)"],
            ["Ink",   "#1b1815", "var(--ink)"],
            ["Felt",  "#1d5a3c", "var(--felt)"],
            ["Gold",  "#c89738", "var(--gold)"],
            ["Hot",   "#c1392b", "var(--hot)"],
            ["Pencil","#6b6356", "var(--pencil)"],
          ].map(([n, hex, v]) => (
            <div key={n} className="col" style={{ alignItems: "center", gap: 4 }}>
              <div className="sk shadow" style={{ width: 56, height: 56, background: v }}></div>
              <div className="hand-2 small">{n}</div>
              <div className="num tiny pencil">{hex}</div>
            </div>
          ))}
        </div>

        <div className="hand mt-12" style={{ fontSize: 22 }}>Type</div>
        <div className="col gap-4 mt-4">
          <div className="hand" style={{ fontSize: 36, lineHeight: 1 }}>Caveat — hero · big $</div>
          <div className="hand-2" style={{ fontSize: 18 }}>Patrick Hand — labels &amp; ui copy</div>
          <div className="mono small">JetBrains Mono — chips, clocks, $ values</div>
          <div className="small">Inter (system) — long copy, body</div>
        </div>

        <div className="hand mt-12" style={{ fontSize: 22 }}>Components</div>
        <div className="row gap-8 mt-4" style={{ alignItems: "center", flexWrap: "wrap" }}>
          <Chip value="10" /><Chip value="50" variant="green" /><Chip value="250" variant="red" /><Chip value="1k" variant="black" />
          <span className="sk shadow" style={{ padding: "6px 10px", fontFamily: "Patrick Hand" }}>button</span>
          <span className="sk gold" style={{ padding: "6px 10px", fontFamily: "Caveat", fontWeight: 700, fontSize: 18 }}>PRIMARY</span>
          <span className="sk ink-blk" style={{ padding: "6px 10px", fontFamily: "Patrick Hand" }}>dark</span>
          <Pill>pill</Pill><Pill variant="hot">hot</Pill><Pill variant="green">trusted</Pill><Pill variant="gold">escrow</Pill>
          <Av name="A" /><Av name="B" status="idle" /><Av name="C" status="ingame" />
        </div>
      </div>

      <div className="sk shadow p-16">
        <div className="hand" style={{ fontSize: 22 }}>Motion language</div>
        <ul className="hand-2" style={{ paddingLeft: 18, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
          <li><b>Chip stacks</b> animate in on wager confirm (~400ms, springy)</li>
          <li><b>Clock pulse</b> intensifies under 30s · vignette red under 10s</li>
          <li><b>Last move</b> highlighted gold on the board, fades over 1s</li>
          <li><b>Settlement reveal</b>: pot rises, $ count-up, rematch CTA pulses</li>
          <li><b>Live ticker</b> auto-shuffles new results in from the top</li>
          <li><b>Lobby breathing</b> — presence dots gently pulse so it never feels static</li>
          <li><b>Avoid</b> heavy bezels, faux 3D, particle storms — feel premium, not casino</li>
        </ul>

        <div className="hand mt-12" style={{ fontSize: 22 }}>Sound &amp; haptics (mobile)</div>
        <ul className="hand-2" style={{ paddingLeft: 18, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
          <li>Chip drop · short tactile</li>
          <li>Move confirm · soft click</li>
          <li>10-second clock · low double-tick haptic</li>
          <li>Win · gold chime · success haptic</li>
          <li>Loss · short low tone · subtle haptic (no punishment)</li>
        </ul>

        <div className="hand mt-12" style={{ fontSize: 22 }}>What we avoid</div>
        <div className="row gap-4 mt-4" style={{ flexWrap: "wrap" }}>
          {["dense tables","crypto-casino glow","tournament brackets","analysis trees","tutorial overlays","SaaS sidebars","cluttered chat"].map(x => (
            <span key={x} className="pill" style={{ background: "#fff1ee", borderColor: "var(--hot)", color: "var(--hot)", textDecoration: "line-through" }}>{x}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProfileTab() {
  return (
    <>
      <div className="sec-hd">
        <h2>⑤ Identity · HUD · Trust</h2>
        <div className="note">
          Player identity drives the scouting moment and the rivalry loop. Compact card lives in tooltips / pre-game; full profile reachable from any avatar; the wallet/trust panel makes integrity visible without bureaucracy.
        </div>
      </div>

      <div className="rail cols-2" style={{ alignItems: "start" }}>
        <div className="art">
          <Stamp id="HUD-01" v="1" label="Compact scout card" />
          <Strap name="“Scout”" sub="hover avatar → 340px card · 2-second read" tag="OVERLAY" />
          <div className="canvas flat" style={{ padding: 24, display: "flex", justifyContent: "center" }}>
            <HudCompact />
          </div>
        </div>

        <div className="art">
          <Stamp id="HUD-02" v="1" label="Full profile" />
          <Strap name="“Dossier”" sub="earnings · tells · trust · h2h · openings" tag="DESKTOP" />
          <div className="canvas flat"><ProfileFull /></div>
        </div>
      </div>

      <div className="rail cols-1 mt-16">
        <div className="art">
          <Stamp id="TRT-01" v="1" label="Wallet &amp; trust" />
          <Strap name="“Trust, visible”" sub="balance · escrow · settlement log · how-fair card stack" tag="FINANCIAL" />
          <div className="canvas flat"><TrustPanel /></div>
        </div>
      </div>
    </>
  );
}

function SystemTab() {
  return (
    <>
      <div className="sec-hd">
        <h2>⓪ System — flow, type, color</h2>
        <div className="note">
          The shared scaffolding underneath all variations. Use this tab to ground the visual language before drilling into any screen.
        </div>
      </div>

      <FlowMap />
      <VisualLanguage />

      <div className="rail cols-1 mt-16">
        <div className="sk dash p-16" style={{ background: "var(--paper-2)" }}>
          <div className="hand" style={{ fontSize: 22, marginBottom: 6 }}>Information architecture (proposed)</div>
          <div className="row gap-12" style={{ flexWrap: "wrap" }}>
            {[
              ["▶ PLAY (lobby)", "default tab · quick match dock · open tables · live feed"],
              ["LIVE", "spectate-only · top-stake tables · upsets · clip-worthy"],
              ["FRIENDS", "your follows · rivals · direct challenges · h2h records"],
              ["HISTORY", "your games · settlements · clips · review"],
              ["WALLET", "balance · escrow · deposit / withdraw · settlement log · trust"],
              ["YOU", "rating · streak · profile · prefs · safety"],
            ].map(([h, d]) => (
              <div key={h} className="sk p-12" style={{ minWidth: 220, flex: "1 1 220px" }}>
                <div className="hand" style={{ fontSize: 18, lineHeight: 1 }}>{h}</div>
                <div className="hand-2 pencil small mt-4">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { ProfileTab, SystemTab });
