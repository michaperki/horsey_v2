// postgame.jsx — Settlement, rematch, victory/defeat variations.

// ─── V1: Settlement Reveal — big-money victory ───────────────────────────────
function PGSettlement() {
  return (
    <Desk label="POST-GAME · SETTLEMENT">
      <div style={{ position: "relative", height: 540, padding: 16, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 18, background: "linear-gradient(180deg, rgba(43,111,71,.08), transparent 40%)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
          <div className="row gap-6"><Pill variant="green">CHECKMATE</Pill><Pill>move 38</Pill><Pill>3:14 played</Pill></div>
          <div className="hand" style={{ fontSize: 64, lineHeight: .95, color: "#1f5635" }}>YOU WIN</div>
          <div className="hand-2 pencil" style={{ fontSize: 16, marginTop: -4 }}>vs Vish · stake $250 each · 3+0 blitz</div>

          <div className="sk shadow felt p-12 w-full" style={{ borderRadius: 10 }}>
            <div className="between">
              <div>
                <div className="tiny uc" style={{ color: "rgba(255,255,255,.7)" }}>credited to wallet</div>
                <div className="hand" style={{ fontSize: 56, lineHeight: 1, color: "var(--gold-2)" }}>+ $225</div>
              </div>
              <div className="tar">
                <div className="tiny uc" style={{ color: "rgba(255,255,255,.7)" }}>pot</div>
                <div className="hand" style={{ fontSize: 26, color: "#fff" }}>$475</div>
                <div className="tiny" style={{ color: "rgba(255,255,255,.7)" }}>− $25 rake</div>
              </div>
            </div>
            <div className="row gap-4 mt-8">
              <Chip value="100" variant="lg" /><Chip value="100" variant="lg green" /><Chip value="25" variant="lg" />
            </div>
          </div>

          <div className="row gap-12 w-full">
            <div className="sk muted grow p-12">
              <div className="tiny uc pencil">balance</div>
              <div className="hand" style={{ fontSize: 24, lineHeight: 1 }}>$1,509</div>
              <div className="hand-2 small pencil">was $1,284</div>
            </div>
            <div className="sk muted grow p-12">
              <div className="tiny uc pencil">rating</div>
              <div className="hand" style={{ fontSize: 24, lineHeight: 1, color: "#2b6f47" }}>1932 <span style={{ fontSize: 14 }}>+18</span></div>
              <div className="hand-2 small pencil">vs 2433 (rival)</div>
            </div>
            <div className="sk muted grow p-12">
              <div className="tiny uc pencil">streak</div>
              <div className="hand" style={{ fontSize: 24, lineHeight: 1 }}>W 3</div>
              <div className="hand-2 small pencil">hot streak ↑</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="sk shadow p-12 between">
            <div className="row gap-8" style={{ alignItems: "center" }}>
              <HeadShot name="V" size={44} />
              <div>
                <div className="hand" style={{ fontSize: 20, lineHeight: 1 }}>Vish</div>
                <div className="hand-2 pencil small">your rival · h2h now 3-5</div>
              </div>
            </div>
            <Pill variant="hot">−18 rating</Pill>
          </div>

          <div className="sk p-12">
            <div className="tiny uc pencil">final position</div>
            <div className="mt-4" style={{ display: "flex", justifyContent: "center" }}>
              <div style={{ width: 200 }}><Board size="lg" pieces /></div>
            </div>
          </div>

          <div style={{ flex: 1 }}></div>

          <button className="sk gold w-full" style={{ padding: 16, borderRadius: 8, fontFamily: "Caveat", fontWeight: 700, fontSize: 30 }}>
            REMATCH · $250 ↺
          </button>
          <div className="row gap-8">
            <button className="sk grow p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>↑ raise to $500</button>
            <button className="sk grow p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>find new</button>
            <button className="sk grow p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>review →</button>
          </div>
          <div className="hand-2 small pencil tac">auto-requeue in 0:14 ·  press space to cancel</div>
        </div>

        <Anno dir="left" style={{ position: "absolute", right: 32, top: 64 }}>
          $$$ first.<br/>rating second.<br/>rematch is dominant CTA.
        </Anno>
      </div>
    </Desk>
  );
}

// ─── V2: Defeat reveal — calmer, more "find redemption" ──────────────────────
function PGDefeat() {
  return (
    <Desk label="POST-GAME · DEFEAT">
      <div style={{ height: 540, padding: 16, display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row gap-6"><Pill variant="hot">CHECKMATED</Pill><Pill>move 38</Pill><Pill>3:14</Pill></div>
          <div className="hand" style={{ fontSize: 56, lineHeight: .95, color: "var(--ink-2)" }}>Tough one.</div>
          <div className="hand-2 pencil" style={{ fontSize: 16, marginTop: -4 }}>Vish takes the pot · you played a strong opening</div>

          <div className="sk shadow p-12">
            <div className="between">
              <div>
                <div className="tiny uc pencil">debited from wallet</div>
                <div className="hand" style={{ fontSize: 44, lineHeight: 1, color: "var(--hot)" }}>− $250</div>
              </div>
              <div className="tar">
                <div className="tiny uc pencil">balance now</div>
                <div className="hand" style={{ fontSize: 22 }}>$1,034</div>
              </div>
            </div>
          </div>

          <div className="sk muted p-12">
            <div className="tiny uc pencil">what happened</div>
            <div className="row gap-8 mt-4">
              <span className="hand" style={{ fontSize: 18, color: "var(--hot)" }}>Blunder · move 31</span>
              <Spark kind="dn" />
            </div>
            <div className="hand-2 small pencil mt-4">your eval went +0.8 → −3.4 — replay to see</div>
            <button className="sk mt-8 p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>↻ replay key moments</button>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="sk p-12 felt" style={{ borderRadius: 10 }}>
            <div className="hand" style={{ fontSize: 22, color: "#fff", lineHeight: 1 }}>Get it back</div>
            <div className="hand-2 small" style={{ color: "rgba(255,255,255,.75)" }}>three ways to claw back $250 right now</div>

            <div className="col gap-6 mt-12">
              <button className="sk gold between" style={{ padding: 12 }}>
                <span className="hand" style={{ fontSize: 18 }}>↺ Rematch Vish</span>
                <span className="num">$250</span>
              </button>
              <button className="sk between" style={{ padding: 12, background: "rgba(255,255,255,.92)" }}>
                <span className="hand" style={{ fontSize: 16 }}>↑ Double or nothing</span>
                <span className="num">$500</span>
              </button>
              <button className="sk between" style={{ padding: 12, background: "rgba(255,255,255,.92)" }}>
                <span className="hand" style={{ fontSize: 16 }}>find someone in your range</span>
                <span className="num">~$200</span>
              </button>
            </div>
          </div>

          <div className="sk p-12">
            <div className="tiny uc pencil">rivalry update</div>
            <div className="hand mt-4" style={{ fontSize: 18 }}>Vish leads 6 — 2</div>
            <div className="hand-2 small pencil">last 5: V V V you V</div>
          </div>

          <div style={{ flex: 1 }}></div>
          <div className="row gap-8">
            <button className="sk grow p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>review later</button>
            <button className="sk grow p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>back to lobby</button>
          </div>
        </div>

        <Anno dir="right" style={{ position: "absolute", right: 32, top: 60 }}>
          defeat ≠ punishment.<br/>3 redemption paths<br/>back to the table.
        </Anno>
      </div>
    </Desk>
  );
}

// ─── V3: Quick requeue overlay — minimal interrupt ───────────────────────────
function PGQuickQueue() {
  return (
    <Desk label="POST-GAME · QUICK REQUEUE">
      <div style={{ position: "relative", height: 540, padding: 16 }}>
        {/* faded final board behind */}
        <div style={{ opacity: .25, pointerEvents: "none", display: "flex", justifyContent: "center", paddingTop: 20 }}>
          <div style={{ width: 320 }}><Board size="lg" pieces lastMove /></div>
        </div>

        <div className="sk shadow" style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 460, background: "var(--paper)", padding: 18 }}>
          <div className="between">
            <Pill variant="green">WIN · +$225</Pill>
            <span className="hand-2 pencil small">↑ +18 · streak 3</span>
          </div>
          <div className="hand mt-8" style={{ fontSize: 28, lineHeight: 1 }}>Queue another?</div>

          <div className="row gap-8 mt-12">
            <button className="sk gold grow between" style={{ padding: 12 }}>
              <span className="hand" style={{ fontSize: 18 }}>↺ Rematch Vish</span>
              <span className="num">$250</span>
            </button>
            <button className="sk grow p-12" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>find new</button>
          </div>

          <div className="uc small pencil mt-12">switch stake</div>
          <div className="row gap-4 mt-4">
            {["25","50","100","250","500","1k"].map((c, i) => <Chip key={c} value={c} variant={`sm ${i === 3 ? "green" : ""}`} />)}
          </div>

          <div className="mt-12 sk muted p-8">
            <div className="between">
              <div className="hand-2 small">Auto-requeue</div>
              <span className="pill dark">ON</span>
            </div>
            <div className="hand-2 small pencil mt-4">starting in 0:09 · press space to cancel</div>
            <div style={{ height: 6, background: "var(--paper-3)", borderRadius: 99, marginTop: 6, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "62%", background: "var(--ink)" }}></div>
            </div>
          </div>

          <div className="row gap-6 mt-12 between">
            <button className="hand-2 small pencil" style={{ background: "none", border: 0 }}>review game →</button>
            <button className="hand-2 small pencil" style={{ background: "none", border: 0 }}>back to lobby</button>
            <button className="hand-2 small pencil" style={{ background: "none", border: 0 }}>share clip ↗</button>
          </div>
        </div>

        <Anno dir="down" style={{ position: "absolute", left: 18, top: 18 }}>
          minimal interrupt:<br/>requeue is the default,<br/>back-to-lobby is opt-out
        </Anno>
      </div>
    </Desk>
  );
}

// ─── V4 mobile: settlement card ──────────────────────────────────────────────
function PGMobile() {
  return (
    <Phone label="POST-GAME · MOBILE">
      <div style={{ padding: 10, display: "flex", flexDirection: "column", height: "100%", gap: 8 }}>
        <div className="sk felt p-12 tac" style={{ borderRadius: 10 }}>
          <Pill variant="gold">CHECKMATE · WIN</Pill>
          <div className="hand" style={{ fontSize: 48, color: "var(--gold-2)", lineHeight: 1, marginTop: 4 }}>+$225</div>
          <div className="hand-2 small" style={{ color: "rgba(255,255,255,.7)" }}>vs Vish · $250 stake · 3+0</div>
        </div>

        <div className="row gap-6">
          <div className="sk grow p-8 tac">
            <div className="tiny uc pencil">balance</div>
            <div className="hand" style={{ fontSize: 18 }}>$1,509</div>
          </div>
          <div className="sk grow p-8 tac">
            <div className="tiny uc pencil">rating</div>
            <div className="hand" style={{ fontSize: 18, color: "#2b6f47" }}>+18</div>
          </div>
          <div className="sk grow p-8 tac">
            <div className="tiny uc pencil">streak</div>
            <div className="hand" style={{ fontSize: 18 }}>W3</div>
          </div>
        </div>

        <button className="sk gold mt-4" style={{ padding: 14, borderRadius: 6, fontFamily: "Caveat", fontWeight: 700, fontSize: 22 }}>↺ REMATCH $250</button>
        <button className="sk p-12" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>find new opponent</button>
        <button className="sk p-12" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>↑ double · $500</button>

        <div className="hand-2 pencil tac small">auto-requeue in 0:09</div>

        <div style={{ flex: 1 }}></div>
        <div className="row gap-6">
          <button className="sk grow p-8 hand-2 small">review</button>
          <button className="sk grow p-8 hand-2 small">share ↗</button>
          <button className="sk grow p-8 hand-2 small">lobby</button>
        </div>
      </div>
    </Phone>
  );
}

function PostGameTab() {
  return (
    <>
      <div className="sec-hd">
        <h2>④ Post-Game — settlement &amp; the next loop</h2>
        <div className="note">
          The fastest path back to a new game wins. Settlement is dramatic (the $ moves visibly). Rematch is the dominant CTA on every variant; auto-requeue is a soft countdown the user can stop at any time. Defeat is treated as a redemption opportunity, never punishment.
        </div>
      </div>

      <div className="rail cols-2" style={{ alignItems: "start" }}>
        <div className="art">
          <Stamp id="PST-01" v="1" label="Win Settlement" />
          <Strap name="“Pay Out”" sub="big-number win reveal · rating & streak deltas · rematch dock" tag="SIGNATURE" />
          <div className="canvas flat"><PGSettlement /></div>
        </div>

        <div className="art">
          <Stamp id="PST-02" v="1" label="Defeat — redemption" />
          <Strap name="“Get It Back”" sub="loss is soft · 3 redemption paths · key-moment replay" tag="EMOTIONAL" />
          <div className="canvas flat"><PGDefeat /></div>
        </div>
      </div>

      <div className="rail cols-2 mt-16" style={{ alignItems: "start" }}>
        <div className="art">
          <Stamp id="PST-03" v="1" label="Quick Requeue overlay" />
          <Strap name="“One More”" sub="modal overlay · default = rematch · auto-requeue countdown" tag="LOW INTERRUPT" />
          <div className="canvas flat"><PGQuickQueue /></div>
        </div>

        <div className="art" style={{ alignSelf: "start" }}>
          <Stamp id="PST-04" v="1" label="Mobile settlement" />
          <Strap name="“Pocket Payout”" sub="hero $ · 3-stat row · rematch + double + new" tag="MOBILE" />
          <div className="canvas flat" style={{ display: "flex", justifyContent: "center", padding: 18 }}>
            <PGMobile />
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { PostGameTab });
