// hifi-wager.jsx — Scouting card (incoming challenge) hi-fi.

function TellBar({ label, value, sub, accent = "var(--ink)" }) {
  return (
    <div>
      <div className="between">
        <span className="lbl" style={{ fontWeight: 500 }}>{label}</span>
        <span className="mono lbl tnum" style={{ fontWeight: 600 }}>{value}</span>
      </div>
      <div className="meter mt-4">
        <i style={{ width: `${typeof value === "number" ? value : parseInt(value)}%`, background: accent }}></i>
      </div>
      {sub && <div className="lbl-sm op-50 mt-4">{sub}</div>}
    </div>
  );
}

function ResultBead({ r }) {
  const win = r === "W";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 22, height: 22, borderRadius: 6,
      fontFamily: "Inter Tight", fontWeight: 800, fontSize: 11,
      background: win ? "rgba(43,138,79,.12)" : "rgba(193,57,43,.10)",
      color: win ? "var(--green)" : "var(--red)",
      border: `1px solid ${win ? "rgba(43,138,79,.3)" : "rgba(193,57,43,.3)"}`
    }}>{r}</span>
  );
}

// ─── DESKTOP ───────────────────────────────────────────────────────────────
function WagerDesktop() {
  return (
    <div className="screen">
      <TopNav active="play" />
      <div className="stage" style={{ display: "grid", gridTemplateColumns: "1fr 460px", gap: 20, position: "relative" }}>
        {/* subtle felt vignette in background */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 75% 50%, rgba(29,90,60,.08), transparent 60%)", pointerEvents: "none" }}></div>

        {/* LEFT — opponent dossier */}
        <div className="util-col gap-16" style={{ position: "relative" }}>
          <div className="util-row between">
            <div>
              <Eyebrow dot="var(--red)">Incoming challenge · auto-decline 0:42</Eyebrow>
              <div className="h-hero mt-4" style={{ fontSize: 36, color: "var(--ink)" }}>
                <span className="op-50">Vish wants</span> $250 <span className="op-50">from you.</span>
              </div>
            </div>
            <button className="btn btn-ghost">✕ dismiss</button>
          </div>

          <div className="card" style={{ padding: 24 }}>
            <div className="util-row gap-20">
              <Av name="V" size="huge" flag="IN" status="online" />
              <div className="grow">
                <div className="util-row gap-8" style={{ alignItems: "baseline" }}>
                  <span className="h-1" style={{ fontSize: 32 }}>Vish</span>
                  <span className="mono tnum" style={{ fontSize: 18, fontWeight: 600, color: "var(--ink-3)" }}>2433</span>
                  <Pill variant="gold">verified ID</Pill>
                  <Pill variant="green">★ 4.8</Pill>
                </div>
                <div className="lbl mt-4" style={{ color: "var(--ink-3)" }}>India · member since Apr 2024 · 423 games</div>
                <div className="util-row gap-6 mt-12">
                  <Pill variant="hot">W 11 streak</Pill>
                  <Pill>solid · slow</Pill>
                  <Pill>blitz favourite</Pill>
                </div>
              </div>
              <div className="util-col" style={{ alignItems: "flex-end", gap: 4 }}>
                <Pill variant="hot">YOUR RIVAL</Pill>
                <span className="h-1" style={{ fontSize: 28, marginTop: 8 }}>2 — 5</span>
                <span className="lbl-sm op-50">head-to-head · 7 games · −$340</span>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 20 }}>
              {[
                ["Win rate",   "68%", "+3% last mo"],
                ["Avg game",   "5m 12s", "blitz · 3+0"],
                ["Accuracy",   "92.1%", "low CP loss"],
                ["Disconnect", "0.4%",   "very reliable"],
              ].map(([l, v, s]) => (
                <div key={l} className="surf pad-12">
                  <span className="eyebrow">{l}</span>
                  <div className="h-2 mt-4" style={{ fontSize: 22 }}>{v}</div>
                  <div className="lbl-sm op-50 mt-4">{s}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="util-row gap-16" style={{ alignItems: "stretch" }}>
            <div className="card grow" style={{ padding: 20 }}>
              <div className="between">
                <Eyebrow>Recent form · last 10</Eyebrow>
                <Pill variant="green">trending up</Pill>
              </div>
              <div className="util-row gap-12 mt-12" style={{ alignItems: "center" }}>
                <div style={{ width: 180 }}><Spark kind="up" /></div>
                <div className="util-row gap-3" style={{ flexWrap: "wrap" }}>
                  {"WWWLWWLWWW".split("").map((r, i) => <ResultBead key={i} r={r} />)}
                </div>
              </div>
              <div className="hd mt-16"></div>
              <div className="util-row between mt-12">
                <span className="lbl op-70">Earnings last 30d</span>
                <span className="mono tnum h-3" style={{ color: "var(--green)" }}>+$4,182</span>
              </div>
            </div>

            <div className="card" style={{ padding: 20, width: 280 }}>
              <Eyebrow>Tells &amp; tendencies</Eyebrow>
              <div className="util-col gap-12 mt-12">
                <TellBar label="Aggression"     value={70} sub="aggressive opener" accent="var(--red)" />
                <TellBar label="Time pressure"  value={22} sub="rarely flags · steady" accent="var(--green)" />
                <TellBar label="Resign threshold" value={60} sub="fights to the end" accent="var(--ink)" />
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <Eyebrow>Recent encounters vs you</Eyebrow>
            <div className="util-row gap-16 mt-12">
              {[
                { r: "L", a: "$250", d: "2 days ago", o: "Sicilian Najdorf" },
                { r: "L", a: "$100", d: "5 days",     o: "Caro-Kann" },
                { r: "W", a: "$50",  d: "1 week",     o: "Queen's Gambit" },
                { r: "L", a: "$25",  d: "2 weeks",    o: "Italian" },
                { r: "W", a: "$25",  d: "3 weeks",    o: "Sicilian" },
              ].map((g, i) => (
                <div key={i} className="util-col grow" style={{ gap: 4, padding: 12, background: "var(--paper-2)", borderRadius: 10, border: "1px solid var(--rule)" }}>
                  <div className="util-row between">
                    <ResultBead r={g.r} />
                    <span className="mono lbl tnum" style={{ fontWeight: 600, color: g.r === "W" ? "var(--green)" : "var(--red)" }}>{g.r === "W" ? "+" : "−"}{g.a}</span>
                  </div>
                  <span className="lbl-sm op-50 mt-4">{g.d}</span>
                  <span className="lbl-sm" style={{ fontWeight: 500 }}>{g.o}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — match card + actions */}
        <div className="dark-card" style={{ display: "flex", flexDirection: "column", gap: 16, padding: 24 }}>
          <Eyebrow dot="var(--gold-bright)"><span style={{ color: "rgba(245,237,224,.7)" }}>The match</span></Eyebrow>

          <div style={{ padding: "16px 18px", background: "rgba(245,237,224,.05)", border: "1px solid rgba(245,237,224,.1)", borderRadius: 14 }}>
            <div className="between" style={{ alignItems: "flex-start" }}>
              <div>
                <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Stake (each)</span>
                <div className="h-hero mono tnum" style={{ fontSize: 56, color: "#f5ede0", marginTop: 2 }}>$250</div>
              </div>
              <ChipStack chips={[{ v: "100", k: "red" }, { v: "100", k: "red" }, { v: "50", k: "green" }]} />
            </div>
            <div className="util-row gap-16 mt-16">
              <div>
                <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Time</span>
                <div className="h-2 mono tnum" style={{ fontSize: 22, color: "#f5ede0", marginTop: 2 }}>3+0</div>
                <span className="lbl-sm" style={{ color: "rgba(245,237,224,.55)" }}>blitz</span>
              </div>
              <div className="grow tar">
                <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Pot if you win</span>
                <div className="h-1 mono tnum" style={{ fontSize: 30, color: "var(--gold-bright)", marginTop: 2 }}>+$475</div>
                <span className="lbl-sm" style={{ color: "rgba(245,237,224,.55)" }}>5% rake</span>
              </div>
            </div>
          </div>

          {/* trust */}
          <div style={{ padding: 16, background: "rgba(43,138,79,.08)", border: "1px solid rgba(43,138,79,.2)", borderRadius: 14 }}>
            <div className="util-row gap-8">
              <span style={{ width: 28, height: 28, borderRadius: 8, background: "var(--felt)", color: "#f5ede0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>✓</span>
              <div>
                <div className="lbl" style={{ fontWeight: 600, color: "#f5ede0" }}>Stakes lock in escrow</div>
                <div className="lbl-sm" style={{ color: "rgba(245,237,224,.6)" }}>both $250 held server-side · auto-settled on result</div>
              </div>
            </div>
            <div className="hd mt-12" style={{ background: "rgba(245,237,224,.1)" }}></div>
            <div className="util-col gap-6 mt-12">
              {[
                ["Anti-cheat", "ML monitored · 0 flags last 365d"],
                ["Reconnect grace", "30s · auto-resign after"],
                ["Server-validated moves", "no client-side ruling"],
              ].map(([k, v]) => (
                <div key={k} className="util-row between">
                  <span className="lbl-sm" style={{ color: "#f5ede0" }}>{k}</span>
                  <span className="lbl-sm" style={{ color: "rgba(245,237,224,.6)" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }}></div>

          {/* CTAs */}
          <div className="util-col gap-8">
            <button className="btn btn-primary btn-xl" style={{ width: "100%", fontSize: 22, padding: "22px 24px", animation: "ho-glow 2.5s ease-in-out infinite" }}>
              <span>Accept · lock $250</span>
              <span style={{ marginLeft: 4 }}>→</span>
            </button>
            <div className="util-row gap-8">
              <button className="btn" style={{ flex: 1, background: "rgba(245,237,224,.08)", color: "#f5ede0", borderColor: "rgba(245,237,224,.15)" }}>
                ↺ Counter at $100
              </button>
              <button className="btn" style={{ flex: 1, background: "transparent", color: "rgba(245,237,224,.7)", borderColor: "rgba(245,237,224,.15)" }}>
                Decline
              </button>
            </div>
            <div className="lbl-sm tac" style={{ color: "rgba(245,237,224,.45)" }}>
              ⌘+enter to accept · esc to decline
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MOBILE ────────────────────────────────────────────────────────────────
function WagerMobile() {
  return (
    <MobileChrome>
      <div style={{ padding: "8px 16px 24px", height: "100%", overflow: "auto" }}>
        <div className="between" style={{ paddingTop: 6, paddingBottom: 10 }}>
          <button className="btn btn-ghost btn-sm">← back</button>
          <Eyebrow dot="var(--red)">incoming · 0:42</Eyebrow>
          <span className="lbl-sm op-50">✕</span>
        </div>

        {/* hero */}
        <div className="dark-card" style={{ padding: 18 }}>
          <div className="util-row gap-12">
            <Av name="V" size="xl" flag="IN" status="online" />
            <div className="grow">
              <div className="util-row gap-6" style={{ alignItems: "baseline" }}>
                <span className="h-1" style={{ fontSize: 22, color: "#f5ede0" }}>Vish</span>
                <span className="mono lbl op-70" style={{ color: "#f5ede0" }}>2433</span>
              </div>
              <div className="util-row gap-4 mt-4">
                <Pill variant="hot">W 11</Pill>
                <Pill variant="gold">verified</Pill>
              </div>
            </div>
            <Pill variant="hot">RIVAL</Pill>
          </div>

          <div className="util-row gap-12 mt-16" style={{ alignItems: "center" }}>
            <div>
              <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Stake</span>
              <div className="h-hero mono tnum" style={{ fontSize: 36, color: "#f5ede0", marginTop: 2 }}>$250</div>
            </div>
            <div className="grow" style={{ borderLeft: "1px solid rgba(245,237,224,.15)", paddingLeft: 14 }}>
              <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Time</span>
              <div className="h-2 mono tnum" style={{ fontSize: 18, color: "#f5ede0", marginTop: 2 }}>3+0 · blitz</div>
            </div>
            <div className="tar">
              <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Win</span>
              <div className="h-1 mono tnum" style={{ fontSize: 24, color: "var(--gold-bright)", marginTop: 2 }}>+$475</div>
            </div>
          </div>
        </div>

        {/* stats */}
        <div className="util-row gap-8 mt-12">
          {[["WR", "68%"], ["avg", "5m12"], ["h2h", "2–5"], ["DC", "0.4%"]].map(([k, v]) => (
            <div key={k} className="surf pad-12 grow tac">
              <div className="eyebrow">{k}</div>
              <div className="h-3 mt-4" style={{ fontSize: 16 }}>{v}</div>
            </div>
          ))}
        </div>

        <div className="card mt-12" style={{ padding: 14 }}>
          <Eyebrow>Recent form</Eyebrow>
          <div className="util-row gap-2 mt-8" style={{ flexWrap: "wrap" }}>
            {"WWWLWWLWWW".split("").map((r, i) => <ResultBead key={i} r={r} />)}
          </div>
          <div className="mt-8"><Spark kind="up" /></div>
        </div>

        <div className="card mt-12" style={{ padding: 12, background: "rgba(43,138,79,.06)", borderColor: "rgba(43,138,79,.2)" }}>
          <div className="util-row gap-8">
            <span style={{ width: 20, height: 20, borderRadius: 6, background: "var(--felt)", color: "#f5ede0", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>✓</span>
            <div>
              <div className="lbl-sm" style={{ fontWeight: 600 }}>Escrow locked · ID verified · 0 flags</div>
              <div className="lbl-sm op-70">tap for full trust report</div>
            </div>
          </div>
        </div>

        {/* CTAs */}
        <div className="util-col gap-8 mt-16">
          <button className="btn btn-primary btn-xl w-full" style={{ fontSize: 18, padding: "18px 22px" }}>
            Accept · lock $250 →
          </button>
          <div className="util-row gap-8">
            <button className="btn grow">↺ Counter $100</button>
            <button className="btn grow btn-ghost">Decline</button>
          </div>
        </div>
      </div>
    </MobileChrome>
  );
}

Object.assign(window, { WagerDesktop, WagerMobile });
