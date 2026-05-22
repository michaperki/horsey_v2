// hifi-game.jsx — In-game hi-fi (cinematic board + minimal HUD + pot rail).

function CapturedRow({ pieces, color = "dark" }) {
  // pieces is a string like "♟♟♞"
  const fill = color === "dark" ? "var(--ink-3)" : "var(--paper)";
  return (
    <div style={{ display: "inline-flex", gap: 2, fontFamily: "Times New Roman", fontSize: 16, color: fill, lineHeight: 1 }}>
      {pieces.split("").map((p, i) => <span key={i}>{p}</span>)}
    </div>
  );
}

function MoveRow({ moves }) {
  return (
    <div className="util-col gap-2" style={{ maxHeight: 220, overflow: "auto" }}>
      {moves.map((row, i) => (
        <div key={i} className="util-row gap-8" style={{ alignItems: "baseline", padding: "3px 6px", borderRadius: 4, background: i === moves.length - 1 ? "rgba(200,151,56,.12)" : "transparent" }}>
          <span className="mono lbl-sm op-50 tnum" style={{ minWidth: 22 }}>{i + 1}.</span>
          <span className="mono lbl tnum" style={{ fontWeight: 600, minWidth: 50 }}>{row[0]}</span>
          <span className="mono lbl tnum" style={{ minWidth: 50, color: "var(--ink-3)" }}>{row[1] || ""}</span>
        </div>
      ))}
    </div>
  );
}

const MOVES = [
  ["e4", "c5"], ["Nf3", "d6"], ["d4", "cxd4"], ["Nxd4", "Nf6"],
  ["Nc3", "a6"], ["Be2", "e5"], ["Nb3", "Be7"], ["O-O", "O-O"],
  ["Be3", "Be6"], ["Nd5", "Nbd7"], ["Qd3", "Bxd5"], ["exd5", "Rc8"],
  ["c4", "Qc7"], ["Rac1", "Rfd8"],
];

// ─── DESKTOP ───────────────────────────────────────────────────────────────
function IngameDesktop() {
  return (
    <div className="screen">
      {/* slim game bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 28px", borderBottom: "1px solid var(--rule)", background: "rgba(245,237,224,.85)", backdropFilter: "blur(20px)" }}>
        <div className="util-row gap-12">
          <Logo size="sm" />
          <span className="vd" style={{ height: 18 }}></span>
          <span className="mono lbl-sm tnum op-70">game · #HRS-8742-A</span>
          <Pill variant="live" dot>live</Pill>
        </div>
        <div className="util-row gap-12">
          <div className="util-row gap-4">
            <span className="pill-dot" style={{ background: "var(--green)", width: 6, height: 6 }}></span>
            <span className="lbl-sm op-70">conn · 24ms</span>
          </div>
          <span className="vd" style={{ height: 18 }}></span>
          <button className="btn btn-ghost btn-sm">⚙</button>
        </div>
      </div>

      <div className="stage" style={{ display: "grid", gridTemplateColumns: "260px 1fr 320px", gap: 20, padding: "20px 28px", overflow: "hidden" }}>
        {/* LEFT — move list, eval, opp tells */}
        <div className="util-col gap-12">
          <div className="card-tight">
            <Eyebrow>Eval</Eyebrow>
            <div className="util-row gap-8 mt-8" style={{ alignItems: "stretch", height: 110 }}>
              <div className="eval-bar">
                <i style={{ top: 0, height: "38%" }}></i>
              </div>
              <div className="util-col grow" style={{ justifyContent: "space-between" }}>
                <div>
                  <span className="mono h-1 tnum" style={{ fontSize: 24, color: "var(--green)" }}>+1.2</span>
                  <div className="lbl-sm op-50">you're winning</div>
                </div>
                <div className="util-row gap-2">
                  {[6,8,12,7,10,14,12,16,14,18,15,20].map((h, i) => (
                    <div key={i} style={{ flex: 1, height: h, background: "var(--green)", opacity: i / 12 + 0.3, borderRadius: 1, alignSelf: "flex-end" }}></div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="card-tight" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <Eyebrow>Move history</Eyebrow>
            <div className="util-row gap-4 lbl-sm op-50 mt-4" style={{ paddingLeft: 28 }}>
              <span style={{ minWidth: 50, fontWeight: 600 }}>White</span>
              <span>Black</span>
            </div>
            <div className="mt-4" style={{ flex: 1, overflow: "auto" }}>
              <MoveRow moves={MOVES} />
            </div>
          </div>

          <div className="card-tight">
            <Eyebrow>Vish's tells</Eyebrow>
            <div className="util-col gap-8 mt-8">
              <div className="between"><span className="lbl-sm">avg move</span><span className="mono lbl-sm tnum" style={{ fontWeight: 600 }}>11s</span></div>
              <div className="between"><span className="lbl-sm">err under pressure</span><span className="mono lbl-sm tnum" style={{ fontWeight: 600, color: "var(--red)" }}>23%</span></div>
              <div className="between"><span className="lbl-sm">resign threshold</span><span className="mono lbl-sm tnum" style={{ fontWeight: 600 }}>−3.5</span></div>
            </div>
          </div>
        </div>

        {/* CENTER — board with player strips */}
        <div className="util-col gap-12" style={{ minWidth: 0 }}>
          {/* opponent strip */}
          <div className="surf pad-12 between">
            <div className="util-row gap-12">
              <Av name="V" size="lg" flag="IN" status="ingame" />
              <div>
                <div className="util-row gap-6" style={{ alignItems: "baseline" }}>
                  <span className="h-3" style={{ fontSize: 17 }}>Vish</span>
                  <span className="mono lbl-sm op-50 tnum">2433</span>
                  <Pill variant="hot">rival</Pill>
                </div>
                <div className="util-row gap-8 mt-4">
                  <CapturedRow pieces="♟♟" color="light" />
                  <span className="mono lbl-sm tnum op-50">+2</span>
                  <span className="lbl-sm op-50">·</span>
                  <span className="lbl-sm op-70">thinking…</span>
                  <div style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                    <span style={{ width: 4, height: 4, borderRadius: 99, background: "var(--ink-3)", animation: "ho-pulse-soft 1.4s ease-in-out infinite" }}></span>
                    <span style={{ width: 4, height: 4, borderRadius: 99, background: "var(--ink-3)", animation: "ho-pulse-soft 1.4s ease-in-out .2s infinite" }}></span>
                    <span style={{ width: 4, height: 4, borderRadius: 99, background: "var(--ink-3)", animation: "ho-pulse-soft 1.4s ease-in-out .4s infinite" }}></span>
                  </div>
                </div>
              </div>
            </div>
            <Clock time="2:34" />
          </div>

          {/* board frame */}
          <div className="board-frame" style={{ alignSelf: "center", width: "min(100%, 540px)" }}>
            <Board lastMove />
            {/* file/rank labels could go here */}
          </div>

          {/* you strip — your turn, low time */}
          <div className="dark-card between" style={{ padding: 12, background: "linear-gradient(180deg, #1a1612, #14110d)" }}>
            <div className="util-row gap-12">
              <Av name="S" size="lg" status="online" />
              <div>
                <div className="util-row gap-6" style={{ alignItems: "baseline" }}>
                  <span className="h-3" style={{ fontSize: 17, color: "#f5ede0" }}>You</span>
                  <span className="mono lbl-sm tnum" style={{ color: "rgba(245,237,224,.6)" }}>1932</span>
                </div>
                <div className="util-row gap-8 mt-4">
                  <CapturedRow pieces="♙♙♙♘" color="dark" />
                  <span className="mono lbl-sm tnum" style={{ color: "rgba(245,237,224,.6)" }}>+4</span>
                  <span className="lbl-sm" style={{ color: "rgba(245,237,224,.6)" }}>·</span>
                  <span className="lbl-sm" style={{ color: "var(--gold-bright)", fontWeight: 600 }}>your turn — move 15</span>
                </div>
              </div>
            </div>
            <Clock time="0:14" urgent />
          </div>
        </div>

        {/* RIGHT — pot, escrow, reactions, resign */}
        <div className="util-col gap-12">
          <div className="felt-card" style={{ padding: 20 }}>
            <div className="between">
              <Eyebrow><span style={{ color: "rgba(245,237,224,.6)" }}>The pot</span></Eyebrow>
              <Pill variant="gold">escrowed</Pill>
            </div>
            <div className="h-hero mono tnum tac mt-12" style={{ fontSize: 56, color: "var(--gold-bright)" }}>$475</div>
            <div className="lbl-sm tac" style={{ color: "rgba(245,237,224,.55)" }}>winner takes after 5% rake</div>
            <div className="util-row gap-8 tac mt-12" style={{ justifyContent: "center" }}>
              <ChipStack chips={[{ v: "100", k: "red" }, { v: "100", k: "red" }, { v: "50", k: "green" }]} />
            </div>
            <div className="hd mt-16" style={{ background: "rgba(245,237,224,.1)" }}></div>
            <div className="util-row between mt-12">
              <div>
                <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Your stake</span>
                <div className="mono tnum h-3" style={{ fontSize: 16, color: "#f5ede0", marginTop: 2 }}>$250</div>
              </div>
              <div className="tar">
                <span className="eyebrow" style={{ color: "rgba(245,237,224,.55)" }}>Their stake</span>
                <div className="mono tnum h-3" style={{ fontSize: 16, color: "#f5ede0", marginTop: 2 }}>$250</div>
              </div>
            </div>
          </div>

          <div className="card-tight">
            <Eyebrow>Momentum</Eyebrow>
            <div className="util-row between mt-8">
              <span className="mono lbl tnum" style={{ fontWeight: 600, color: "var(--green)" }}>YOU</span>
              <span className="mono lbl tnum op-50">VISH</span>
            </div>
            <div style={{ position: "relative", height: 6, background: "var(--paper-3)", borderRadius: 99, marginTop: 6 }}>
              <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: "8%", background: "var(--green)", borderRadius: 99 }}></div>
              <div style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 2, background: "var(--ink)", opacity: .4 }}></div>
            </div>
            <Spark kind="up" />
          </div>

          <div className="card-tight">
            <Eyebrow>Quick chat</Eyebrow>
            <div className="util-row gap-6 mt-8" style={{ flexWrap: "wrap" }}>
              {[
                { e: "♟", l: "good move" },
                { e: "GG", l: "" },
                { e: "!", l: "" },
                { e: "?", l: "" },
                { e: "♛", l: "" },
                { e: "⚡", l: "fast!" },
              ].map((x, i) => (
                <button key={i} className="btn btn-sm" style={{ padding: "8px 12px", fontFamily: "Inter Tight", fontWeight: 700, fontSize: 13 }}>{x.e}</button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1 }}></div>
          <div className="util-row gap-8">
            <button className="btn grow">offer draw</button>
            <button className="btn grow" style={{ color: "var(--red)", borderColor: "rgba(193,57,43,.3)", background: "rgba(193,57,43,.05)" }}>resign</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MOBILE ────────────────────────────────────────────────────────────────
function IngameMobile() {
  return (
    <MobileChrome>
      <div style={{ padding: "8px 14px", display: "flex", flexDirection: "column", height: "100%", gap: 10 }}>
        {/* slim game bar */}
        <div className="between" style={{ padding: "4px 0" }}>
          <div className="util-row gap-6">
            <span className="pill-dot" style={{ background: "var(--green)", width: 6, height: 6 }}></span>
            <span className="lbl-sm op-70">24ms</span>
          </div>
          <Pill variant="live" dot>live</Pill>
          <span className="lbl-sm op-50">⋯</span>
        </div>

        {/* opponent */}
        <div className="surf pad-12 between">
          <div className="util-row gap-8">
            <Av name="V" flag="IN" status="ingame" />
            <div className="util-col" style={{ gap: 0 }}>
              <div className="util-row gap-4" style={{ alignItems: "baseline" }}>
                <span className="h-3" style={{ fontSize: 14 }}>Vish</span>
                <span className="mono lbl-sm op-50">2433</span>
              </div>
              <div className="util-row gap-4">
                <CapturedRow pieces="♟♟" color="light" />
                <span className="lbl-sm op-50">thinking…</span>
              </div>
            </div>
          </div>
          <Clock time="2:34" />
        </div>

        {/* board with pot overlay */}
        <div className="board-frame" style={{ position: "relative", padding: 10 }}>
          <Board lastMove />
          <div style={{ position: "absolute", top: 14, right: 14, background: "rgba(0,0,0,.55)", padding: "4px 8px", borderRadius: 6, color: "var(--gold-bright)", fontFamily: "JetBrains Mono", fontWeight: 700, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>$475</div>
        </div>

        {/* you */}
        <div className="dark-card between" style={{ padding: 10 }}>
          <div className="util-row gap-8">
            <Av name="S" />
            <div className="util-col" style={{ gap: 0 }}>
              <div className="util-row gap-4" style={{ alignItems: "baseline" }}>
                <span className="h-3" style={{ fontSize: 14, color: "#f5ede0" }}>You</span>
                <span className="mono lbl-sm" style={{ color: "rgba(245,237,224,.55)" }}>1932</span>
              </div>
              <span className="lbl-sm" style={{ color: "var(--gold-bright)", fontWeight: 600 }}>your turn</span>
            </div>
          </div>
          <Clock time="0:14" urgent />
        </div>

        {/* emote rail */}
        <div className="util-row gap-4">
          {["♟","GG","!","?","♛","⚡"].map((e, i) => (
            <button key={i} className="btn btn-sm grow" style={{ padding: 8, fontWeight: 700 }}>{e}</button>
          ))}
        </div>

        <div className="util-row gap-6">
          <button className="btn btn-sm grow">draw?</button>
          <button className="btn btn-sm grow" style={{ color: "var(--red)", borderColor: "rgba(193,57,43,.3)", background: "rgba(193,57,43,.05)" }}>resign</button>
        </div>
      </div>
    </MobileChrome>
  );
}

Object.assign(window, { IngameDesktop, IngameMobile });
