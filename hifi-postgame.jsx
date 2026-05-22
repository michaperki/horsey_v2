// hifi-postgame.jsx — Settlement / win reveal hi-fi.

function Confetti() {
  // pre-distribute confetti pieces
  const pieces = Array.from({ length: 24 }).map((_, i) => ({
    left: `${(i * 37) % 100}%`,
    delay: (i * 0.13) % 2,
    dur: 1.8 + (i % 5) * 0.2,
  }));
  return (
    <div className="confetti">
      {pieces.map((p, i) => (
        <i key={i} style={{ left: p.left, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s` }}></i>
      ))}
    </div>
  );
}

function StatBlock({ label, value, sub, accent }) {
  return (
    <div className="surf pad-16">
      <Eyebrow>{label}</Eyebrow>
      <div className="h-1 mono tnum mt-4" style={{ fontSize: 30, color: accent || "var(--ink)" }}>{value}</div>
      <div className="lbl-sm op-70 mt-4">{sub}</div>
    </div>
  );
}

// ─── DESKTOP ───────────────────────────────────────────────────────────────
function PostgameDesktop() {
  return (
    <div className="screen" style={{ background: "linear-gradient(180deg, var(--bg) 0%, rgba(43,138,79,.04) 100%)" }}>
      {/* slim victory bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 28px", background: "linear-gradient(90deg, rgba(43,138,79,.08), transparent 70%)", borderBottom: "1px solid var(--rule)" }}>
        <div className="util-row gap-12">
          <Logo size="sm" />
          <span className="vd" style={{ height: 18 }}></span>
          <Pill variant="green">CHECKMATE · WIN</Pill>
          <span className="lbl-sm op-50">38 moves · 3:14 played · #HRS-8742-A</span>
        </div>
        <div className="util-row gap-12">
          <button className="btn btn-ghost btn-sm">share clip ↗</button>
          <button className="btn btn-ghost btn-sm">review →</button>
          <button className="btn btn-ghost btn-sm">✕ lobby</button>
        </div>
      </div>

      <div className="stage" style={{ display: "grid", gridTemplateColumns: "1.45fr 1fr", gap: 24, padding: "28px 36px", overflow: "hidden", position: "relative" }}>
        <Confetti />

        {/* LEFT — the reveal */}
        <div className="util-col gap-20" style={{ position: "relative" }}>
          <div>
            <Eyebrow dot="var(--green)">Settlement · auto-credited</Eyebrow>
            <div className="h-hero mt-8" style={{ fontSize: 52, color: "var(--ink)" }}>
              You took <span style={{ color: "var(--gold)" }}>Vish</span>.
            </div>
            <div className="lbl mt-8" style={{ color: "var(--ink-3)" }}>3+0 blitz · stake $250 each · checkmate on move 38</div>
          </div>

          {/* big $ */}
          <div className="felt-card" style={{ padding: 32, position: "relative", overflow: "visible" }}>
            <div className="flare"></div>
            <div className="between">
              <div>
                <Eyebrow><span style={{ color: "rgba(245,237,224,.6)" }}>Credited to wallet</span></Eyebrow>
                <div className="util-row gap-12 mt-8" style={{ alignItems: "baseline" }}>
                  <CountUp to={225} prefix="+$" className="h-hero mono tnum" style={{ fontSize: 104, color: "var(--gold-bright)", textShadow: "0 0 30px rgba(227,181,87,.4)", lineHeight: 1 }} />
                </div>
                <div className="util-row gap-12 mt-8">
                  <span className="lbl" style={{ color: "rgba(245,237,224,.7)" }}>
                    pot <span className="mono tnum" style={{ fontWeight: 600, color: "#f5ede0" }}>$500</span>
                  </span>
                  <span className="lbl" style={{ color: "rgba(245,237,224,.5)" }}>− <span className="mono tnum">$25</span> rake</span>
                </div>
              </div>
              <ChipStack chips={[{ v: "100", k: "red" }, { v: "100", k: "red" }, { v: "25", k: "green" }]} />
            </div>

            <div className="hd mt-20" style={{ background: "rgba(245,237,224,.1)" }}></div>

            <div className="util-row gap-16 mt-16">
              <div className="grow">
                <Eyebrow><span style={{ color: "rgba(245,237,224,.6)" }}>Balance</span></Eyebrow>
                <div className="util-row gap-6 mt-4" style={{ alignItems: "baseline" }}>
                  <span className="mono tnum h-2" style={{ color: "#f5ede0", fontSize: 22 }}>$1,509</span>
                  <span className="lbl-sm" style={{ color: "rgba(245,237,224,.45)" }}>was $1,284</span>
                </div>
              </div>
              <div className="grow">
                <Eyebrow><span style={{ color: "rgba(245,237,224,.6)" }}>Rating</span></Eyebrow>
                <div className="util-row gap-6 mt-4" style={{ alignItems: "baseline" }}>
                  <span className="mono tnum h-2" style={{ color: "#f5ede0", fontSize: 22 }}>1,932</span>
                  <span className="mono tnum lbl" style={{ color: "var(--gold-bright)", fontWeight: 700 }}>+18</span>
                </div>
              </div>
              <div className="grow">
                <Eyebrow><span style={{ color: "rgba(245,237,224,.6)" }}>Streak</span></Eyebrow>
                <div className="util-row gap-6 mt-4" style={{ alignItems: "baseline" }}>
                  <span className="mono tnum h-2" style={{ color: "#f5ede0", fontSize: 22 }}>W 3</span>
                  <span className="lbl-sm" style={{ color: "rgba(245,237,224,.55)" }}>hot ↑</span>
                </div>
              </div>
            </div>
          </div>

          {/* rivalry update */}
          <div className="card" style={{ padding: 16 }}>
            <div className="util-row between">
              <div className="util-row gap-12">
                <Av name="V" size="lg" flag="IN" />
                <div>
                  <div className="util-row gap-6" style={{ alignItems: "baseline" }}>
                    <span className="h-3" style={{ fontSize: 16 }}>Vish</span>
                    <span className="mono lbl op-50">2433 → <span style={{ color: "var(--red)" }}>2415</span></span>
                    <Pill variant="hot">−18</Pill>
                  </div>
                  <span className="lbl-sm op-70">your rival · head-to-head now <b className="mono tnum">3 — 5</b></span>
                </div>
              </div>
              <div className="util-row gap-4">
                {"VVVuV".split("").map((r, i) => (
                  <span key={i} style={{ display: "inline-flex", width: 22, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", fontFamily: "Inter Tight", fontSize: 11, fontWeight: 800, background: r === "u" ? "rgba(43,138,79,.12)" : "rgba(193,57,43,.10)", color: r === "u" ? "var(--green)" : "var(--red)", border: `1px solid ${r === "u" ? "rgba(43,138,79,.3)" : "rgba(193,57,43,.3)"}` }}>{r === "u" ? "W" : "L"}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — rematch dock */}
        <div className="util-col gap-16">
          <div className="card" style={{ padding: 16 }}>
            <Eyebrow>Final position</Eyebrow>
            <div className="util-row gap-12 mt-12">
              <div style={{ width: 160 }}><Board /></div>
              <div className="util-col grow gap-8">
                <div>
                  <span className="lbl-sm op-50">winning move</span>
                  <div className="mono h-3 tnum mt-4" style={{ fontSize: 18 }}>38. Qxf7#</div>
                </div>
                <div>
                  <span className="lbl-sm op-50">accuracy</span>
                  <div className="mono h-3 tnum mt-4" style={{ fontSize: 18, color: "var(--green)" }}>94.2%</div>
                </div>
                <button className="btn btn-sm">↻ replay key moments</button>
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: 20, flex: 1, display: "flex", flexDirection: "column" }}>
            <div className="between">
              <Eyebrow>Queue another</Eyebrow>
              <div className="util-row gap-4">
                <Pill variant="dark">auto-requeue ON</Pill>
              </div>
            </div>

            <button className="btn btn-primary btn-xl mt-16" style={{ padding: "20px 24px", fontSize: 22, animation: "ho-glow 2.5s ease-in-out infinite" }}>
              ↺ Rematch Vish · $250
            </button>

            <div className="util-row gap-8 mt-8">
              <button className="btn btn-dark grow" style={{ padding: "12px 16px" }}>
                <span style={{ fontWeight: 700 }}>↑ Double or nothing</span>
                <span className="mono lbl op-70" style={{ marginLeft: 6 }}>$500</span>
              </button>
              <button className="btn grow" style={{ padding: "12px 16px" }}>find new opponent</button>
            </div>

            <div className="hd mt-20"></div>

            <div className="mt-16">
              <span className="eyebrow">Switch stake for next match</span>
              <div className="util-row gap-6 mt-8" style={{ flexWrap: "wrap" }}>
                {[
                  { v: "25", k: "" },
                  { v: "50", k: "green" },
                  { v: "100", k: "red" },
                  { v: "250", k: "red", on: true },
                  { v: "500", k: "black" },
                  { v: "1K",  k: "purple" },
                ].map(c => (
                  <span key={c.v} style={{ transform: c.on ? "translateY(-2px) scale(1.06)" : "none", transition: "transform .14s" }}>
                    <Chip value={c.v} variant={c.k} />
                  </span>
                ))}
              </div>
            </div>

            <div style={{ flex: 1 }}></div>

            <div className="surf pad-12 mt-16">
              <div className="between">
                <span className="lbl-sm" style={{ fontWeight: 500 }}>Auto-requeue starting…</span>
                <span className="mono lbl-sm tnum op-70">0:09</span>
              </div>
              <div className="meter gold mt-8"><i style={{ width: "62%" }}></i></div>
              <div className="lbl-sm op-50 mt-4">press <kbd style={{ padding: "1px 5px", border: "1px solid var(--rule)", borderRadius: 3, background: "var(--paper-2)", fontSize: 10, fontFamily: "JetBrains Mono" }}>space</kbd> to cancel</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MOBILE ────────────────────────────────────────────────────────────────
function PostgameMobile() {
  return (
    <MobileChrome>
      <div style={{ padding: "8px 14px 24px", height: "100%", overflow: "auto", position: "relative" }}>
        <Confetti />

        <div className="between" style={{ padding: "4px 0", position: "relative" }}>
          <button className="btn btn-ghost btn-sm">✕ lobby</button>
          <Pill variant="green">WIN</Pill>
          <button className="btn btn-ghost btn-sm">share ↗</button>
        </div>

        <div className="felt-card mt-8" style={{ padding: 20, position: "relative", overflow: "visible" }}>
          <div className="flare"></div>
          <Eyebrow><span style={{ color: "rgba(245,237,224,.6)" }}>Credited</span></Eyebrow>
          <CountUp to={225} prefix="+$" className="h-hero mono tnum" style={{ display: "block", fontSize: 64, color: "var(--gold-bright)", textShadow: "0 0 30px rgba(227,181,87,.4)", marginTop: 4 }} />
          <div className="lbl" style={{ color: "rgba(245,237,224,.6)", marginTop: 4 }}>vs Vish · $250 stake · 3+0 blitz</div>
          <div className="util-row gap-8 mt-12" style={{ justifyContent: "flex-end" }}>
            <ChipStack chips={[{ v: "100", k: "red" }, { v: "100", k: "red" }, { v: "25", k: "green" }]} />
          </div>
        </div>

        <div className="util-row gap-8 mt-12">
          <StatBlock label="Balance" value="$1,509" sub="was $1,284" />
          <StatBlock label="Rating"  value="+18"    sub="now 1,932" accent="var(--green)" />
          <StatBlock label="Streak"  value="W 3"    sub="hot ↑" />
        </div>

        <div className="card mt-12" style={{ padding: 12 }}>
          <div className="util-row between">
            <div className="util-row gap-8">
              <Av name="V" size="sm" flag="IN" />
              <span className="lbl" style={{ fontWeight: 600 }}>Vish</span>
              <Pill variant="hot">RIVAL</Pill>
            </div>
            <span className="lbl-sm op-50">h2h <b className="mono tnum" style={{ color: "var(--ink)" }}>3 — 5</b></span>
          </div>
        </div>

        <div className="util-col gap-8 mt-16">
          <button className="btn btn-primary btn-xl w-full" style={{ fontSize: 18, padding: "18px 22px" }}>
            ↺ Rematch · $250
          </button>
          <div className="util-row gap-8">
            <button className="btn btn-dark grow">↑ Double · $500</button>
            <button className="btn grow">find new</button>
          </div>
          <div className="surf pad-8 between mt-4">
            <span className="lbl-sm op-70">auto-requeue · 0:09</span>
            <div style={{ flex: 1, marginLeft: 12 }}>
              <div className="meter gold"><i style={{ width: "62%" }}></i></div>
            </div>
          </div>
        </div>
      </div>
    </MobileChrome>
  );
}

Object.assign(window, { PostgameDesktop, PostgameMobile });
