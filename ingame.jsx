// ingame.jsx — In-game board variations.

// ─── V1: Cinematic — minimal HUD, board dominant ─────────────────────────────
function IngameCinematic() {
  return (
    <Desk label="IN-GAME · CINEMATIC">
      <div style={{ position: "relative", height: 540, background: "linear-gradient(180deg, var(--paper-2), var(--paper) 30%, var(--paper) 70%, var(--paper-2))", padding: 16, display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 16 }}>
        {/* top opponent strip */}
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="row gap-8" style={{ alignItems: "center" }}>
            <Av name="V" status="ingame" />
            <div className="col" style={{ gap: 0 }}>
              <span className="hand" style={{ fontSize: 18, lineHeight: 1 }}>Vish <span className="num pencil small">2433</span></span>
              <span className="tiny uc pencil">solid · rival 2-5</span>
            </div>
          </div>
          <div className="sk shadow gold" style={{ padding: "4px 10px", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 18 }}>0:02:34</div>
          <div className="row gap-6" style={{ alignItems: "center" }}><Pill>thinking…</Pill><Heart>live</Heart></div>
        </div>

        <div></div>
        <div style={{ width: 380, maxWidth: "100%" }}>
          <Board size="lg" pieces lastMove />
        </div>
        <div></div>

        {/* you strip */}
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div className="row gap-8" style={{ alignItems: "center" }}>
            <Av name="Y" status="online" />
            <div className="col" style={{ gap: 0 }}>
              <span className="hand" style={{ fontSize: 18, lineHeight: 1 }}>You <span className="num pencil small">1932</span></span>
              <span className="tiny uc pencil">your turn · move 14</span>
            </div>
          </div>
          <div className="sk shadow ink-blk" style={{ padding: "6px 12px", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 22, color: "var(--paper)" }}>0:01:48</div>
          <div className="col" style={{ alignItems: "flex-end", gap: 2 }}>
            <span className="hand-2 small pencil">pot</span>
            <span className="hand" style={{ fontSize: 22, lineHeight: 1, color: "#2b6f47" }}>$475</span>
          </div>
        </div>

        {/* floating reactions */}
        <div style={{ position: "absolute", left: 18, bottom: 18, display: "flex", gap: 6 }}>
          {["GG", "🐎", "!", "?", "♟"].map((e, i) => (
            <button key={i} className="sk shadow p-8" style={{ width: 34, height: 34, fontSize: 14, fontFamily: "Caveat", fontWeight: 700 }}>{e}</button>
          ))}
        </div>
        <div style={{ position: "absolute", right: 18, bottom: 18 }}>
          <button className="sk shadow" style={{ padding: "8px 14px", fontFamily: "Patrick Hand", fontSize: 14 }}>resign</button>
        </div>

        <Anno dir="left" style={{ position: "absolute", right: 32, top: 80 }}>
          board owns 70%<br/>of the canvas
        </Anno>
      </div>
    </Desk>
  );
}

// ─── V2: Side rail HUD — vertical scout panel + board ────────────────────────
function IngameSideRail() {
  return (
    <Desk label="IN-GAME · SIDE HUD">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", height: 540 }}>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, alignItems: "stretch" }}>
          {/* opponent bar */}
          <div className="sk muted p-8 between">
            <div className="row gap-8" style={{ alignItems: "center" }}>
              <Av name="V" status="ingame" />
              <div className="col" style={{ gap: 0 }}>
                <span className="hand-2 small">Vish · <span className="num">2433</span></span>
                <span className="tiny pencil uc">{"♟"} 14 captured · clock pressure 22%</span>
              </div>
            </div>
            <div className="sk gold" style={{ padding: "4px 10px", fontFamily: "JetBrains Mono", fontWeight: 700 }}>2:34</div>
          </div>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <div style={{ width: 360 }}><Board size="lg" pieces lastMove /></div>
          </div>

          <div className="sk shadow ink-blk between p-8">
            <div className="row gap-8" style={{ alignItems: "center" }}>
              <Av name="Y" />
              <div className="col" style={{ gap: 0 }}>
                <span className="hand-2 small">You · <span className="num">1932</span></span>
                <span className="tiny uc" style={{ color: "var(--gold-2)" }}>your turn</span>
              </div>
            </div>
            <div className="sk gold" style={{ padding: "6px 12px", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 18 }}>1:48</div>
          </div>
        </div>

        <div style={{ borderLeft: "1px dashed var(--rule)", padding: 12, display: "flex", flexDirection: "column", gap: 10, background: "var(--paper-2)" }}>
          <div className="between">
            <span className="hand" style={{ fontSize: 20 }}>The Pot</span>
            <Pill variant="gold">escrowed</Pill>
          </div>
          <div className="sk shadow felt p-12 tac">
            <div className="hand" style={{ fontSize: 36, color: "#fff", lineHeight: 1 }}>$475</div>
            <div className="hand-2 small" style={{ color: "rgba(255,255,255,.7)" }}>winner takes after 5% rake</div>
          </div>

          <div className="uc small pencil">Momentum</div>
          <div className="sk muted p-8">
            <div className="row gap-4 between">
              <span className="hand-2 small">You</span><span className="num small">+0.4</span>
            </div>
            <div style={{ position: "relative", height: 8, background: "var(--paper-3)", borderRadius: 99, marginTop: 6 }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "10%", background: "#2b6f47", borderRadius: 99 }}></div>
              <div style={{ position: "absolute", left: "50%", top: -4, bottom: -4, width: 2, background: "var(--ink)" }}></div>
            </div>
            <Spark kind="up" />
          </div>

          <div className="uc small pencil">Opponent Tells</div>
          <div className="sk p-8 col gap-4">
            <div className="between"><span className="hand-2 small">Avg move time</span><span className="num small">11s</span></div>
            <div className="between"><span className="hand-2 small">Time-pressure error rate</span><span className="num small hot" style={{ color: "var(--hot)" }}>23%</span></div>
            <div className="between"><span className="hand-2 small">Disconnect %</span><span className="num small">0.4%</span></div>
          </div>

          <div style={{ flex: 1 }}></div>
          <div className="col gap-4">
            <button className="sk shadow p-8 hand-2 small">offer draw</button>
            <button className="sk hot p-8 hand-2 small">resign · concede $250</button>
          </div>
        </div>

        <Anno dir="left" style={{ position: "absolute", right: 240, top: 60 }}>
          poker-HUD rail<br/>= scout MID-GAME
        </Anno>
      </div>
    </Desk>
  );
}

// ─── V3: Clock pressure — final seconds drama ────────────────────────────────
function IngameTension() {
  return (
    <Desk label="IN-GAME · TENSION">
      <div style={{ position: "relative", height: 540, background: "radial-gradient(circle at 50% 50%, var(--paper) 0%, var(--paper-2) 80%)", padding: 16 }}>
        {/* glow vignette */}
        <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 80px rgba(193,57,43,.18)", pointerEvents: "none" }}></div>

        <div className="between">
          <div className="row gap-8" style={{ alignItems: "center" }}>
            <Av name="V" status="ingame" />
            <span className="hand-2 small">Vish · <span className="num">2433</span></span>
          </div>
          <div className="sk gold" style={{ padding: "4px 10px", fontFamily: "JetBrains Mono", fontWeight: 700 }}>0:42</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 360px 1fr", alignItems: "center", marginTop: 16, gap: 18 }}>
          {/* left: huge clock w/ pressure */}
          <div className="tac">
            <div className="uc small pencil">you · time left</div>
            <div className="hand" style={{ fontSize: 96, lineHeight: .9, color: "var(--hot)", textShadow: "3px 3px 0 rgba(193,57,43,.18)" }}>0:08</div>
            <div className="hand-2 pencil small">last 10s · move fast</div>
            <div style={{ height: 10, background: "var(--paper-3)", border: "1.5px solid var(--ink)", borderRadius: 99, marginTop: 8, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "13%", background: "var(--hot)", animation: "pulse 1s infinite" }}></div>
            </div>
          </div>

          <div><Board size="lg" pieces lastMove /></div>

          {/* right: pot + momentum */}
          <div className="tac">
            <div className="uc small pencil">on the line</div>
            <div className="hand" style={{ fontSize: 60, lineHeight: 1, color: "#2b6f47" }}>$475</div>
            <div className="row gap-4 mt-8" style={{ justifyContent: "center" }}>
              <Chip value="100" variant="lg green" />
              <Chip value="100" variant="lg" />
              <Chip value="50"  variant="lg" />
            </div>
            <div className="hand-2 small mt-8">eval <b style={{ color: "#2b6f47" }}>+1.2</b> · you're winning</div>
          </div>
        </div>

        <div style={{ position: "absolute", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 10 }}>
          <button className="sk shadow" style={{ padding: "10px 16px", fontFamily: "Patrick Hand", fontSize: 14 }}>offer draw</button>
          <button className="sk ink-blk" style={{ padding: "10px 16px", fontFamily: "Patrick Hand", fontSize: 14 }}>resign</button>
        </div>

        <Anno dir="down" style={{ position: "absolute", left: 18, top: 60 }}>
          board, clock, pot —<br/>nothing else in view
        </Anno>
      </div>
    </Desk>
  );
}

// ─── V4 mobile in-game ───────────────────────────────────────────────────────
function IngameMobile() {
  return (
    <Phone label="IN-GAME · MOBILE">
      <div style={{ padding: 10, display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
        <div className="sk p-8 between">
          <div className="row gap-6" style={{ alignItems: "center" }}>
            <Av name="V" size="sm" status="ingame" />
            <span className="hand-2 small">Vish 2433</span>
          </div>
          <div className="sk gold" style={{ padding: "2px 8px", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 13 }}>2:34</div>
        </div>

        <div style={{ position: "relative" }}>
          <Board size="lg" pieces lastMove />
          <div style={{ position: "absolute", top: 6, right: 6 }}>
            <div className="sk gold" style={{ padding: "2px 8px", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 13 }}>$475</div>
          </div>
        </div>

        <div className="sk ink-blk between p-8" style={{ marginTop: -2 }}>
          <div className="row gap-6" style={{ alignItems: "center" }}>
            <Av name="Y" size="sm" />
            <span className="hand-2 small">You · your turn</span>
          </div>
          <div className="hand" style={{ fontSize: 24, color: "var(--gold-2)", lineHeight: 1 }}>1:48</div>
        </div>

        <div className="row gap-4">
          {["♟", "GG", "!", "?", "🐎"].map((e, i) => (
            <button key={i} className="sk small" style={{ flex: 1, padding: 6, fontFamily: "Caveat", fontSize: 14 }}>{e}</button>
          ))}
        </div>

        <div className="row gap-4">
          <button className="sk small grow" style={{ padding: 8, fontFamily: "Patrick Hand", fontSize: 12 }}>draw?</button>
          <button className="sk hot small grow" style={{ padding: 8, fontFamily: "Patrick Hand", fontSize: 12 }}>resign</button>
        </div>
      </div>
    </Phone>
  );
}

function IngameTab() {
  return (
    <>
      <div className="sec-hd">
        <h2>③ In-Game — board first, always</h2>
        <div className="note">
          Board never below ~60% of the canvas. Three desktop directions show how much HUD sits beside it. Mobile compresses to a single column with the clock + pot pinned above/below the board.
        </div>
      </div>

      <div className="rail cols-2" style={{ alignItems: "start" }}>
        <div className="art">
          <Stamp id="GME-01" v="1" label="Cinematic — minimal HUD" />
          <Strap name="“Cinema”" sub="board dominant · top/bottom strips · floating emotes" tag="MINIMAL" />
          <div className="canvas flat"><IngameCinematic /></div>
        </div>

        <div className="art">
          <Stamp id="GME-02" v="1" label="Side-rail HUD" />
          <Strap name="“Live HUD”" sub="vertical rail · pot · momentum bar · opponent tells" tag="HIGH-INFO" />
          <div className="canvas flat"><IngameSideRail /></div>
        </div>
      </div>

      <div className="rail cols-2 mt-16" style={{ alignItems: "start" }}>
        <div className="art">
          <Stamp id="GME-03" v="1" label="Tension — final 10s" />
          <Strap name="“Final Seconds”" sub="dramatic clock · pot prominent · vignette glow" tag="SIGNATURE MOMENT" />
          <div className="canvas flat"><IngameTension /></div>
        </div>

        <div className="art" style={{ alignSelf: "start" }}>
          <Stamp id="GME-04" v="1" label="Mobile in-game" />
          <Strap name="“Thumbboard”" sub="board fills width · clock/pot stacked · 5-emote quick rail" tag="MOBILE" />
          <div className="canvas flat" style={{ display: "flex", justifyContent: "center", padding: 18 }}>
            <IngameMobile />
          </div>
        </div>
      </div>

      <div className="rail cols-1 mt-16">
        <div className="sk dash p-12" style={{ background: "var(--paper-2)" }}>
          <div className="hand" style={{ fontSize: 20, marginBottom: 4 }}>HUD signals to choose from</div>
          <div className="row gap-12" style={{ flexWrap: "wrap" }}>
            {[
              ["Clock pressure", "pulse intensifies under 30s"],
              ["Momentum bar", "engine eval ±, never numeric"],
              ["Pot ticker", "$ floats above board"],
              ["Opp. tells", "avg move-time, error-under-pressure"],
              ["Connection", "tiny bar, red when latency spikes"],
              ["Reactions", "5 chess-flavored emotes"],
              ["Escrow lock", "always-visible gold pill"],
              ["Resign", "always last, never near accept"],
            ].map(([h, d]) => (
              <div key={h} className="sk p-8" style={{ minWidth: 170, flex: "1 1 170px" }}>
                <div className="hand" style={{ fontSize: 16, lineHeight: 1 }}>{h}</div>
                <div className="hand-2 pencil small">{d}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { IngameTab });
