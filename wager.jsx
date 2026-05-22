// wager.jsx — Wager creation & acceptance variations.

// ─── Wager V1: chip-tray slide-up overlay ────────────────────────────────────
function WagerChipTray() {
  return (
    <Desk label="WAGER · OVERLAY">
      <div style={{ position: "relative", height: "100%", minHeight: 480 }}>
        {/* faded lobby behind */}
        <div style={{ padding: 16, opacity: .35, pointerEvents: "none" }}>
          <div className="hand" style={{ fontSize: 26 }}>Horsey</div>
          <div className="mt-8" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            {[1,2,3,4,5,6].map(i => <div key={i} className="sk p-12" style={{ height: 70 }} />)}
          </div>
        </div>

        {/* overlay sheet */}
        <div className="sk shadow" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: 460, background: "var(--paper)", padding: 18, borderWidth: 1.75 }}>
          <div className="between">
            <div className="hand" style={{ fontSize: 26, lineHeight: 1 }}>Set your stake</div>
            <span className="pill">esc to close</span>
          </div>
          <div className="hand-2 pencil small">vs. anyone in 3+0 blitz</div>

          {/* chip stack visual */}
          <div className="mt-12" style={{ position: "relative", height: 70, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", left: "50%", transform: "translateX(-60px)" }}><Chip value="100" variant="lg green" /></div>
            <div style={{ position: "absolute", left: "50%", transform: "translateX(-30px) translateY(-6px)" }}><Chip value="25" variant="lg" /></div>
            <div style={{ position: "absolute", left: "50%", transform: "translateX(0px) translateY(-12px)" }}><Chip value="25" variant="lg" /></div>
            <div style={{ position: "absolute", left: "50%", transform: "translateX(30px) translateY(-6px)" }}><Chip value="5" variant="lg" /></div>
            <div style={{ position: "absolute", right: 0, top: 0 }} className="hand" >$155</div>
          </div>

          <div className="uc small pencil mt-12">Add a chip</div>
          <div className="row gap-8 mt-4" style={{ flexWrap: "wrap" }}>
            {["1","5","10","25","50","100","250","500","1k"].map((c, i) => (
              <Chip key={c} value={c} variant={i === 3 || i === 5 ? "" : i === 6 ? "red" : ""} />
            ))}
          </div>

          <div className="row gap-8 mt-12">
            <button className="sk p-8 grow" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>↺ Reset</button>
            <button className="sk p-8 grow" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>+1 +5 +25</button>
          </div>

          <div className="sk muted mt-12 p-8 between">
            <div className="hand-2 small">Pot if you win</div>
            <div className="num">+$294 <span className="pencil tiny">(5% rake)</span></div>
          </div>

          <button className="sk gold w-full mt-12" style={{ padding: 14, borderRadius: 8, fontFamily: "Caveat", fontWeight: 700, fontSize: 28 }}>
            LOCK IN $155 →
          </button>
          <div className="leg mt-8 tac" style={{ justifyContent: "center" }}>
            <span className="sw" style={{ background: "var(--gold)", borderRadius: 99 }}></span>
            stake locks in escrow when both players confirm
          </div>
        </div>

        <Anno dir="down" style={{ position: "absolute", left: 12, bottom: 18 }}>
          single keystroke<br/>or chip tap<br/>= all the input
        </Anno>
      </div>
    </Desk>
  );
}

// ─── Wager V2: drag-to-table — direct manipulation metaphor ───────────────────
function WagerDragTable() {
  return (
    <Desk label="WAGER · DRAG TO SIT">
      <div style={{ position: "relative", height: "100%", minHeight: 480, padding: 16 }}>
        <div className="between">
          <div className="hand" style={{ fontSize: 26 }}>Pick a seat</div>
          <div className="row gap-8 small uc pencil"><span>3+0 blitz</span><span>·</span><span>filter</span></div>
        </div>

        {/* table area */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18, marginTop: 14 }}>
          {[
            { n: "Mira", chip: "100", style: "aggressive" },
            { n: "Vish", chip: "500", style: "solid · 2433" },
            { n: "Kobe", chip: "50",  style: "tactical · 2104" },
          ].map((p, i) => (
            <div key={p.n} className="sk shadow felt" style={{ position: "relative", padding: 16, height: 220, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", borderRadius: 120, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
              <div className="row gap-6" style={{ alignItems: "center" }}>
                <Av name={p.n} status="online" />
                <div className="col" style={{ gap: 0 }}>
                  <span className="hand" style={{ fontSize: 18, color: "#fff" }}>{p.n}</span>
                  <span className="tiny uc" style={{ color: "rgba(255,255,255,.7)" }}>{p.style}</span>
                </div>
              </div>

              <div style={{ background: "rgba(0,0,0,.25)", border: "1.5px dashed rgba(244,237,224,.5)", borderRadius: 99, width: 110, height: 60, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                <span className="num small" style={{ opacity: .7 }}>seat open</span>
                <span className="hand" style={{ fontSize: 18 }}>${p.chip}</span>
              </div>

              <button className="sk gold" style={{ padding: "6px 12px", borderRadius: 99, fontFamily: "Patrick Hand", fontSize: 14 }}>
                drop chip to sit
              </button>

              {i === 0 && (
                <div style={{ position: "absolute", right: -10, top: 90 }}>
                  <Chip value="100" variant="lg" />
                  <Anno dir="right" style={{ marginTop: 6 }}>your chip<br/>dragged here</Anno>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* chip tray dock */}
        <div className="sk shadow mt-16 p-12 between" style={{ background: "var(--paper-2)" }}>
          <div className="row gap-6" style={{ alignItems: "center" }}>
            <span className="hand" style={{ fontSize: 20 }}>Your tray</span>
            <span className="hand-2 pencil small">drag a chip onto a seat</span>
          </div>
          <div className="row gap-8">
            {["1","5","10","25","50","100","250"].map((c, i) => (
              <Chip key={c} value={c} variant={i === 5 ? "green" : ""} />
            ))}
          </div>
          <div className="row gap-6" style={{ alignItems: "center" }}>
            <span className="hand-2 small">bal.</span><span className="num">$1,284</span>
          </div>
        </div>
      </div>
    </Desk>
  );
}

// ─── Wager V3: scouting card — accept with full intel ────────────────────────
function WagerScout() {
  return (
    <Desk label="WAGER · SCOUTING CARD">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100%", minHeight: 480 }}>
        <div style={{ padding: 16, borderRight: "1px dashed var(--rule)" }}>
          <div className="hand-2 pencil small uc">incoming challenge</div>
          <div className="hand" style={{ fontSize: 32, lineHeight: 1, marginTop: 2 }}>Vish wants $250 from you.</div>

          <div className="sk shadow mt-12 p-12">
            <div className="between">
              <div className="row gap-8" style={{ alignItems: "center" }}>
                <HeadShot name="V" size={56} />
                <div>
                  <div className="hand" style={{ fontSize: 22, lineHeight: 1 }}>Vish · <span className="num" style={{ fontSize: 16 }}>2433</span></div>
                  <div className="hand-2 pencil small">India · joined 2 yrs · 4.8★ trust</div>
                </div>
              </div>
              <div className="col tar" style={{ gap: 0 }}>
                <Pill variant="hot">W 11</Pill>
                <span className="tiny pencil uc mt-4">streak</span>
              </div>
            </div>

            <div className="row gap-12 mt-12" style={{ alignItems: "stretch" }}>
              <div className="sk muted p-8 grow">
                <div className="tiny uc pencil">style</div>
                <div className="hand" style={{ fontSize: 18, lineHeight: 1 }}>Solid · Slow</div>
              </div>
              <div className="sk muted p-8 grow">
                <div className="tiny uc pencil">win-rate</div>
                <div className="hand" style={{ fontSize: 18, lineHeight: 1 }}>68%</div>
              </div>
              <div className="sk muted p-8 grow">
                <div className="tiny uc pencil">avg game</div>
                <div className="hand" style={{ fontSize: 18, lineHeight: 1 }}>5m12</div>
              </div>
            </div>

            <div className="mt-12">
              <div className="tiny uc pencil">recent form (last 10)</div>
              <Spark kind="up" />
              <div className="row gap-4" style={{ flexWrap: "wrap" }}>
                {"WWWLWWLWWW".split("").map((r, i) => (
                  <span key={i} className="pill" style={{ background: r === "W" ? "#dff0e4" : "#fff1ee", borderColor: r === "W" ? "#2b6f47" : "var(--hot)", color: r === "W" ? "#1f5635" : "var(--hot)", padding: "2px 6px" }}>{r}</span>
                ))}
              </div>
            </div>

            <div className="mt-12">
              <div className="tiny uc pencil">head to head with you</div>
              <div className="row gap-8 mt-4" style={{ alignItems: "center" }}>
                <span className="hand" style={{ fontSize: 26 }}>2 — 5</span>
                <span className="hand-2 pencil small">7 games · $-340 lifetime</span>
                <Pill variant="hot">RIVAL</Pill>
              </div>
            </div>
          </div>

          <Anno dir="right" style={{ marginTop: 12 }}>this is the <b>scouting</b> moment.<br/>2-second read decides accept/decline.</Anno>
        </div>

        <div style={{ padding: 16, background: "var(--paper-2)", display: "flex", flexDirection: "column" }}>
          <div className="hand" style={{ fontSize: 24 }}>The match</div>
          <div className="sk shadow mt-8 p-12">
            <div className="between">
              <div>
                <div className="tiny uc pencil">stake (each)</div>
                <div className="hand" style={{ fontSize: 32, lineHeight: 1 }}>$250</div>
              </div>
              <div>
                <div className="tiny uc pencil">time</div>
                <div className="hand" style={{ fontSize: 24, lineHeight: 1 }}>3 + 0</div>
              </div>
              <div>
                <div className="tiny uc pencil">pot</div>
                <div className="hand" style={{ fontSize: 28, lineHeight: 1, color: "#2b6f47" }}>$475</div>
              </div>
            </div>
            <div className="leg mt-8"><span className="sw" style={{ background: "var(--gold)", borderRadius: 99 }}></span>both stakes held in escrow until result · 5% rake</div>
          </div>

          <div className="sk muted p-12 mt-8">
            <div className="tiny uc pencil">trust signals</div>
            <div className="col gap-4 mt-4">
              <div className="between"><span className="hand-2 small">✓ ID verified</span><span className="num tiny pencil">apr 2024</span></div>
              <div className="between"><span className="hand-2 small">✓ Fair-play score</span><span className="num tiny pencil">99.2 / 100</span></div>
              <div className="between"><span className="hand-2 small">✓ Disconnect rate</span><span className="num tiny pencil">0.4%</span></div>
              <div className="between"><span className="hand-2 small">⚠ No anti-cheat flags</span><span className="num tiny pencil">past 365d</span></div>
            </div>
          </div>

          <div style={{ flex: 1 }}></div>

          <div className="col gap-8">
            <button className="sk gold" style={{ padding: 16, borderRadius: 8, fontFamily: "Caveat", fontWeight: 700, fontSize: 30 }}>
              ACCEPT · LOCK $250 →
            </button>
            <div className="row gap-8">
              <button className="sk p-8 grow" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>↺ Counter ($100)</button>
              <button className="sk p-8 grow" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>Decline</button>
            </div>
            <div className="hand-2 pencil small tac">auto-decline in 0:42</div>
          </div>
        </div>
      </div>
    </Desk>
  );
}

// ─── Wager V4 mobile: swipe deck ─────────────────────────────────────────────
function WagerSwipeMobile() {
  return (
    <Phone label="WAGER · SWIPE DECK">
      <div style={{ padding: 12, height: "100%", display: "flex", flexDirection: "column" }}>
        <div className="between">
          <span className="hand" style={{ fontSize: 22 }}>Pick a fight</span>
          <span className="pill">3+0 · $25-100</span>
        </div>

        <div style={{ position: "relative", flex: 1, marginTop: 12, display: "flex", justifyContent: "center" }}>
          {/* back card */}
          <div className="sk shadow" style={{ position: "absolute", inset: "0 12px 0 12px", transform: "translateY(8px) rotate(-2deg)", background: "var(--paper-2)" }}></div>
          {/* mid card */}
          <div className="sk shadow" style={{ position: "absolute", inset: "0 6px 0 6px", transform: "translateY(4px) rotate(1.5deg)", background: "var(--paper-2)" }}></div>
          {/* top card */}
          <div className="sk shadow" style={{ position: "absolute", inset: 0, transform: "rotate(-1deg)", background: "var(--paper)", padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="between">
              <div className="row gap-6" style={{ alignItems: "center" }}>
                <Av name="M" flag="GR" status="online" />
                <div>
                  <div className="hand" style={{ fontSize: 18, lineHeight: 1 }}>Mira</div>
                  <div className="num tiny pencil">1842 · aggressive</div>
                </div>
              </div>
              <Chip value="50" variant="green" />
            </div>

            <div style={{ background: "var(--paper-2)", border: "1.25px dashed var(--rule)", borderRadius: 6, padding: 8 }}>
              <div className="row gap-6"><Pill>W 5</Pill><Pill variant="hot">hot</Pill><Pill>3+0</Pill></div>
              <div className="mt-4"><Spark kind="up" /></div>
              <div className="hand-2 small mt-4">68% wr · 4.6★ trust · 0% dc</div>
            </div>

            <div className="sk muted p-8">
              <div className="tiny uc pencil">pot</div>
              <div className="hand" style={{ fontSize: 22, lineHeight: 1 }}>$95</div>
            </div>

            <div style={{ flex: 1 }}></div>

            <div className="row gap-8 mt-8" style={{ justifyContent: "center" }}>
              <button className="sk" style={{ width: 48, height: 48, borderRadius: 99, fontSize: 22 }}>×</button>
              <button className="sk shadow" style={{ width: 48, height: 48, borderRadius: 99, fontSize: 16 }}>🔍</button>
              <button className="sk gold" style={{ width: 60, height: 60, borderRadius: 99, fontFamily: "Caveat", fontWeight: 700, fontSize: 18 }}>SIT</button>
            </div>
            <div className="hand-2 pencil small tac">swipe right · accept · play</div>
          </div>

          <Anno dir="left" style={{ position: "absolute", left: -100, top: 80 }}>
            decline ←
          </Anno>
          <Anno dir="right" style={{ position: "absolute", right: -90, top: 80 }}>
            → accept
          </Anno>
        </div>

        <div className="row gap-4 mt-8" style={{ justifyContent: "center" }}>
          {[1,2,3,4,5].map(i => <span key={i} style={{ width: i === 1 ? 16 : 5, height: 5, borderRadius: 99, background: i === 1 ? "var(--ink)" : "var(--paper-3)" }}></span>)}
        </div>
      </div>
    </Phone>
  );
}

function WagerTab() {
  return (
    <>
      <div className="sec-hd">
        <h2>② Wager — intent to game</h2>
        <div className="note">
          Four reads on the wager moment. V1 keeps the lobby in place and slides chips in. V2 is a literal table — drag your chip onto a seat. V3 is the rich scouting card for incoming challenges (signature moment). V4 is mobile-native swipe.
        </div>
      </div>

      <div className="rail cols-2">
        <div className="art">
          <Stamp id="WGR-01" v="1" label="Chip Tray Overlay" />
          <Strap name="“Chip Tray”" sub="modal overlay · stack chips · lock in" tag="LOW-FRICTION" />
          <div className="canvas flat"><WagerChipTray /></div>
        </div>

        <div className="art">
          <Stamp id="WGR-02" v="1" label="Drag-to-Sit" />
          <Strap name="“Take a Seat”" sub="direct manipulation · drop your chip on an open seat" tag="EXPRESSIVE" />
          <div className="canvas flat"><WagerDragTable /></div>
        </div>
      </div>

      <div className="rail cols-2 mt-16" style={{ alignItems: "start" }}>
        <div className="art">
          <Stamp id="WGR-03" v="1" label="Scouting Card — accept w/ intel" />
          <Strap name="“Read the Room”" sub="full opponent intel before lock-in · the signature moment" tag="HUD" />
          <div className="canvas flat"><WagerScout /></div>
        </div>

        <div className="art" style={{ alignSelf: "start" }}>
          <Stamp id="WGR-04" v="1" label="Mobile Swipe Deck" />
          <Strap name="“Swipe to Sit”" sub="one challenge at a time · accept-decline-scout buttons" tag="MOBILE" />
          <div className="canvas flat" style={{ display: "flex", justifyContent: "center", padding: 18 }}>
            <WagerSwipeMobile />
          </div>
        </div>
      </div>

      <div className="rail cols-1 mt-16">
        <div className="sk dash p-12" style={{ background: "var(--paper-2)" }}>
          <div className="hand" style={{ fontSize: 20, marginBottom: 4 }}>Friction budget</div>
          <div className="hand-2 pencil" style={{ fontSize: 14, lineHeight: 1.5 }}>
            From intent → in-game we allow <b>≤ 3 taps</b> (open lobby → pick chip → confirm). Scouting card adds 1 tap for high-stakes only.
            Escrow lock animates over ~400ms — long enough to feel deliberate, short enough to never feel slow.
            Counter-offer is one chip-tap; decline never requires confirm.
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { WagerTab });
