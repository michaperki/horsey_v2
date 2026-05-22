// lobby.jsx — Lobby / home screen variations.
// Three desktop directions + one mobile direction.

const PLAYERS = [
  { n: "Mira",  flag: "GR", rep: "1842", chip: "100", style: "aggro",  spark: "up",   streak: 5,  trust: "★★★★", risk: "med"  },
  { n: "Kobe",  flag: "JP", rep: "2104", chip: "50",  style: "tactic", spark: "flat", streak: 0,  trust: "★★★",  risk: "low"  },
  { n: "Drei",  flag: "DE", rep: "1567", chip: "25",  style: "wild",   spark: "dn",   streak: -3, trust: "★★",   risk: "high" },
  { n: "Vish",  flag: "IN", rep: "2433", chip: "500", style: "solid",  spark: "up",   streak: 11, trust: "★★★★★", risk: "low"  },
  { n: "Pax",   flag: "BR", rep: "1718", chip: "10",  style: "blitz",  spark: "up",   streak: 2,  trust: "★★★",  risk: "med"  },
  { n: "Aoi",   flag: "JP", rep: "1985", chip: "250", style: "ice",    spark: "flat", streak: -1, trust: "★★★★", risk: "low"  },
];

// ─── Lobby V1: "Tables Floor" — challenges as poker tables in a grid ─────────
function LobbyTablesFloor() {
  return (
    <Desk label="LOBBY · 1440">
      <div style={{ display: "grid", gridTemplateColumns: "200px 1fr 220px", height: "100%", minHeight: 480 }}>
        {/* left rail — nav */}
        <div style={{ borderRight: "1px dashed var(--rule)", padding: "16px 12px", background: "var(--paper-2)" }}>
          <div className="hand" style={{ fontSize: 28, lineHeight: 1, marginBottom: 14 }}>Horsey</div>
          <div className="col gap-4">
            {["▶ Play", "Live Tables", "Friends", "Rivals", "History", "Wallet"].map((x, i) => (
              <div key={x} className="hand-2" style={{ padding: "6px 8px", borderRadius: 4, background: i === 0 ? "var(--ink)" : "transparent", color: i === 0 ? "var(--paper)" : "var(--ink-2)", fontSize: 15 }}>{x}</div>
            ))}
          </div>
          <div className="mt-16">
            <div className="uc small pencil" style={{ marginBottom: 6 }}>Wallet</div>
            <div className="sk shadow p-12">
              <div className="num" style={{ fontSize: 22 }}>$1,284</div>
              <div className="small pencil mt-4">+$140 today</div>
            </div>
          </div>
        </div>

        {/* center — tables floor */}
        <div style={{ padding: "16px 18px", overflow: "hidden" }}>
          <div className="between">
            <div>
              <div className="hand" style={{ fontSize: 32, lineHeight: 1 }}>Open Tables</div>
              <div className="hand-2 pencil" style={{ fontSize: 13 }}>{PLAYERS.length} waiting · 412 playing now</div>
            </div>
            <div className="row gap-6">
              <span className="pill">All</span>
              <span className="pill dark">Bullet</span>
              <span className="pill">Blitz</span>
              <span className="pill">Rapid</span>
              <span className="pill gold">Big $</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginTop: 12 }}>
            {PLAYERS.slice(0, 6).map((p, i) => (
              <div key={p.n} className="sk shadow" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="between">
                  <div className="row gap-6" style={{ alignItems: "center" }}>
                    <Av name={p.n} flag={p.flag} status={i % 3 === 0 ? "online" : i % 3 === 1 ? "idle" : "ingame"} />
                    <div>
                      <div className="h3" style={{ lineHeight: 1 }}>{p.n}</div>
                      <div className="num small pencil">{p.rep} · {p.style}</div>
                    </div>
                  </div>
                  <Chip value={p.chip} variant={p.chip > 100 ? "green" : ""} />
                </div>
                <div className="row gap-4" style={{ alignItems: "center" }}>
                  <Pill>3+0</Pill>
                  <Pill variant={p.streak > 0 ? "hot" : ""}>{p.streak > 0 ? `W${p.streak}` : p.streak < 0 ? `L${-p.streak}` : "—"}</Pill>
                  <span style={{ flex: 1 }}><Spark kind={p.spark} /></span>
                </div>
                <div className="row gap-4">
                  <button className="sk ink-blk grow" style={{ padding: "6px 8px", fontFamily: "Patrick Hand", fontSize: 14, border: "1.5px solid var(--ink)", borderRadius: 5 }}>Accept ${p.chip}</button>
                  <button className="sk" style={{ padding: "6px 8px", fontFamily: "Patrick Hand", fontSize: 14, border: "1.5px solid var(--ink)", borderRadius: 5 }}>Scout</button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 sk dash p-12 between" style={{ background: "var(--paper-2)" }}>
            <div className="hand" style={{ fontSize: 22 }}>+ Create your own table</div>
            <div className="row gap-6"><Chip value="10" variant="sm" /><Chip value="50" variant="green sm" /><Chip value="100" variant="sm" /><Chip value="250" variant="red sm" /></div>
            <button className="sk gold" style={{ padding: "6px 14px", borderRadius: 6, fontFamily: "Patrick Hand", fontSize: 16 }}>Quick Play →</button>
          </div>
        </div>

        {/* right rail — live activity */}
        <div style={{ borderLeft: "1px dashed var(--rule)", padding: "16px 12px", background: "var(--paper-2)" }}>
          <Heart>Live Floor</Heart>
          <div className="col gap-6 mt-8">
            {[
              { a: "Vish", b: "Drei", amt: "$500", out: "+$500" },
              { a: "Mira", b: "Kobe", amt: "$50",  out: "play" },
              { a: "Aoi",  b: "Pax",  amt: "$25",  out: "+$25"  },
              { a: "Nox",  b: "Yui",  amt: "$10",  out: "join?" },
              { a: "Reza", b: "Tomi", amt: "$100", out: "play"  },
            ].map((f, i) => (
              <div key={i} className="sk small p-8 between">
                <span className="hand-2" style={{ fontSize: 13 }}>{f.a} <span className="pencil">vs</span> {f.b}</span>
                <span className="num tiny">{f.amt}</span>
              </div>
            ))}
          </div>

          <div className="uc small pencil mt-16" style={{ marginBottom: 6 }}>Hot Upsets</div>
          <div className="sk hot p-8">
            <div className="hand-2" style={{ fontSize: 14 }}>Drei (1567) just beat Vish (2433)</div>
            <div className="num tiny mt-4">+$500 · 2m ago</div>
          </div>

          <div className="uc small pencil mt-12" style={{ marginBottom: 6 }}>Your Rivals</div>
          {["Kobe", "Aoi"].map(n => (
            <div key={n} className="between mt-4">
              <div className="row gap-6" style={{ alignItems: "center" }}><Av name={n} size="sm" status="online" /><span className="hand-2" style={{ fontSize: 13 }}>{n}</span></div>
              <span className="pill hot">Online</span>
            </div>
          ))}
        </div>
      </div>
    </Desk>
  );
}

// ─── Lobby V2: "Stake Rails" — horizontal rails grouped by buy-in ────────────
function LobbyStakeRails() {
  const rails = [
    { label: "MICRO", sub: "$1 – $25", color: "" , chips: ["1","5","10","25"], players: PLAYERS.filter(p => +p.chip <= 25) },
    { label: "STANDARD", sub: "$50 – $100", color: "green", chips: ["50","75","100"], players: PLAYERS.filter(p => +p.chip > 25 && +p.chip <= 100) },
    { label: "HIGH", sub: "$250+", color: "red", chips: ["250","500","1k"], players: PLAYERS.filter(p => +p.chip >= 250) },
  ];
  return (
    <Desk label="LOBBY · 1440">
      <div style={{ padding: "14px 18px" }}>
        <div className="between">
          <div className="row gap-12" style={{ alignItems: "baseline" }}>
            <div className="hand" style={{ fontSize: 30, lineHeight: 1 }}>Horsey</div>
            <Heart>1,204 online · 412 playing</Heart>
          </div>
          <div className="row gap-8" style={{ alignItems: "center" }}>
            <span className="pill">Bullet</span><span className="pill dark">Blitz</span><span className="pill">Rapid</span>
            <span style={{ width: 1, height: 18, background: "var(--rule)" }} />
            <div className="sk shadow row gap-6" style={{ padding: "4px 10px", alignItems: "center" }}>
              <span className="num small">$1,284</span><span className="hand-2 pencil small">bal.</span>
            </div>
            <Av name="You" />
          </div>
        </div>

        {rails.map(rail => (
          <div key={rail.label} className="mt-12">
            <div className="between" style={{ marginBottom: 6 }}>
              <div className="row gap-8" style={{ alignItems: "baseline" }}>
                <span className="hand" style={{ fontSize: 22 }}>{rail.label}</span>
                <span className="hand-2 pencil small">{rail.sub}</span>
              </div>
              <div className="row gap-4">
                {rail.chips.map(c => <Chip key={c} value={c} variant={`sm ${rail.color}`} />)}
                <span className="pill">+ create</span>
              </div>
            </div>
            <div style={{ display: "grid", gridAutoFlow: "column", gridAutoColumns: "minmax(180px, 1fr)", gap: 8, overflowX: "auto" }}>
              {rail.players.concat(rail.players).slice(0, 4).map((p, i) => (
                <div key={i} className="sk shadow p-8 col gap-4">
                  <div className="between">
                    <div className="row gap-4" style={{ alignItems: "center" }}>
                      <Av name={p.n} size="sm" status={i % 2 === 0 ? "online" : "idle"} />
                      <span className="hand-2 small">{p.n} <span className="num pencil">{p.rep}</span></span>
                    </div>
                    <Chip value={p.chip} variant={`sm ${rail.color}`} />
                  </div>
                  <div className="row gap-4" style={{ alignItems: "center" }}>
                    <Pill>3+0</Pill>
                    <span style={{ flex: 1 }}><Spark kind={p.spark} /></span>
                  </div>
                  <button className="sk ink-blk small" style={{ padding: 5, borderRadius: 4, fontFamily: "Patrick Hand", fontSize: 13 }}>Sit & play</button>
                </div>
              ))}
              <div className="sk dash" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 100, fontFamily: "Caveat", fontSize: 18, color: "var(--pencil)" }}>
                more →
              </div>
            </div>
          </div>
        ))}

        <div className="mt-12 sk felt p-12 between">
          <div>
            <div className="hand" style={{ fontSize: 22, color: "#fff" }}>Quick Match</div>
            <div className="hand-2 small" style={{ opacity: .8 }}>auto-pair me to the nearest open seat</div>
          </div>
          <div className="row gap-8" style={{ alignItems: "center" }}>
            <div className="row gap-4">
              {["10","25","50","100"].map(c => <Chip key={c} value={c} variant="sm" />)}
            </div>
            <button className="sk gold" style={{ padding: "8px 18px", borderRadius: 6, fontFamily: "Caveat", fontWeight: 700, fontSize: 22 }}>FIND →</button>
          </div>
        </div>
      </div>
    </Desk>
  );
}

// ─── Lobby V3: "Hero Quickplay + Feed" — single dominant action ──────────────
function LobbyHero() {
  return (
    <Desk label="LOBBY · 1440">
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", height: "100%", minHeight: 480 }}>
        <div style={{ padding: "20px 24px", background: "linear-gradient(180deg, transparent 0%, rgba(29,90,60,.06) 100%)" }}>
          <div className="between">
            <div className="hand" style={{ fontSize: 30, lineHeight: 1 }}>Horsey</div>
            <div className="row gap-12 small uc pencil"><span>Lobby</span><span>Friends</span><span>Wallet · $1,284</span></div>
          </div>

          <div className="hand mt-12" style={{ fontSize: 44, lineHeight: 1, maxWidth: 480 }}>
            What's your stake tonight?
          </div>
          <div className="hand-2 pencil mt-4" style={{ fontSize: 14 }}>Pick a chip, pick a time, we'll find you a seat.</div>

          <div className="sk shadow mt-12 p-16" style={{ background: "var(--paper)" }}>
            <div className="uc small pencil">Stake</div>
            <div className="row gap-8 mt-8" style={{ alignItems: "center", flexWrap: "wrap" }}>
              {["1","5","10","25","50","100","250","500"].map((c, i) => (
                <Chip key={c} value={c} variant={i === 4 ? "green" : i === 6 ? "red" : ""} />
              ))}
              <span className="hand-2 pencil small" style={{ marginLeft: 4 }}>or type ▢ </span>
              <span className="sk muted small p-8" style={{ width: 60, textAlign: "center", padding: "4px 8px" }}>—</span>
            </div>

            <div className="uc small pencil mt-12">Time control</div>
            <div className="row gap-6 mt-8">
              {["1+0","2+1","3+0","3+2","5+0","10+0","15+10"].map((t, i) => (
                <span key={t} className={`pill ${i === 2 ? "dark" : ""}`}>{t}</span>
              ))}
            </div>

            <div className="row gap-12 mt-16" style={{ alignItems: "center" }}>
              <button className="sk gold grow" style={{ padding: "14px 16px", borderRadius: 8, fontFamily: "Caveat", fontWeight: 700, fontSize: 28, letterSpacing: ".02em" }}>
                FIND ME A GAME →
              </button>
              <div className="col" style={{ gap: 2 }}>
                <span className="hand-2 small pencil">est. wait</span>
                <span className="num">~4s</span>
              </div>
            </div>

            <div className="row gap-8 mt-12 between">
              <div className="leg"><span className="sw" style={{ background: "var(--gold)", borderRadius: 99 }}></span>escrow locks both stakes</div>
              <div className="leg">winner takes <b>$200</b> (pot · 5%) </div>
            </div>
          </div>

          <div className="mt-12 row gap-8">
            <button className="sk shadow p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>↺ Rematch Kobe ($50)</button>
            <button className="sk shadow p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>Challenge a friend</button>
            <button className="sk shadow p-8" style={{ fontFamily: "Patrick Hand", fontSize: 14 }}>Spectate ▸</button>
          </div>
        </div>

        <div style={{ borderLeft: "1px dashed var(--rule)", padding: "16px 14px", background: "var(--paper-2)" }}>
          <div className="between">
            <Heart>Live Floor</Heart>
            <span className="pill">filter</span>
          </div>
          <div className="col gap-8 mt-8">
            {[
              { a: "Vish", b: "Drei", amt: "$500", time: "blitz", state: "live" },
              { a: "Mira", b: "Kobe", amt: "$50",  time: "3+0",   state: "live" },
              { a: "Aoi",  b: "Pax",  amt: "$25",  time: "5+0",   state: "wait" },
              { a: "Nox",  b: "Yui",  amt: "$100", time: "3+2",   state: "wait" },
              { a: "Reza", b: "Tomi", amt: "$10",  time: "1+0",   state: "live" },
              { a: "Ko",   b: "Vex",  amt: "$250", time: "10+0",  state: "wait" },
            ].map((f, i) => (
              <div key={i} className="sk p-8 between">
                <div className="row gap-6" style={{ alignItems: "center" }}>
                  <Av name={f.a} size="sm" /><span className="hand-2 small">vs</span><Av name={f.b} size="sm" />
                </div>
                <div className="col" style={{ gap: 0, textAlign: "right" }}>
                  <span className="num small">{f.amt}</span>
                  <span className="tiny uc pencil">{f.time} · {f.state}</span>
                </div>
                <button className="sk small" style={{ padding: "4px 8px", fontFamily: "Patrick Hand", fontSize: 12 }}>
                  {f.state === "live" ? "watch" : "join"}
                </button>
              </div>
            ))}
          </div>

          <div className="uc small pencil mt-16" style={{ marginBottom: 6 }}>Trending</div>
          <div className="sk hot p-8">
            <div className="hand-2 small">3 players just won 5+ in a row</div>
          </div>
        </div>
      </div>
    </Desk>
  );
}

// ─── Mobile Lobby variant ────────────────────────────────────────────────────
function LobbyMobile() {
  return (
    <Phone label="LOBBY · MOBILE">
      <div style={{ padding: 12 }}>
        <div className="between">
          <div className="hand" style={{ fontSize: 26, lineHeight: 1 }}>Horsey</div>
          <div className="row gap-6" style={{ alignItems: "center" }}>
            <span className="num small">$1,284</span>
            <Av name="Y" size="sm" />
          </div>
        </div>

        <div className="sk felt mt-8 p-12" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="row gap-4" style={{ alignItems: "center" }}>
            <Heart>1.2k online</Heart>
          </div>
          <div className="hand" style={{ fontSize: 22, color: "#fff" }}>Quick Match</div>
          <div className="row gap-4" style={{ flexWrap: "wrap" }}>
            {["5","10","25","50","100"].map((c, i) => <Chip key={c} value={c} variant={`sm ${i === 2 ? "green" : ""}`} />)}
          </div>
          <button className="sk gold mt-4" style={{ padding: 10, borderRadius: 6, fontFamily: "Caveat", fontWeight: 700, fontSize: 22 }}>FIND →</button>
        </div>

        <div className="row gap-4 mt-12" style={{ overflow: "auto" }}>
          {["All","Bullet","Blitz","Rapid","Friends","Rivals"].map((t, i) => (
            <span key={t} className={`pill ${i === 0 ? "dark" : ""}`} style={{ flexShrink: 0 }}>{t}</span>
          ))}
        </div>

        <div className="col gap-6 mt-8">
          {PLAYERS.slice(0, 5).map((p, i) => (
            <div key={p.n} className="sk shadow p-8 between">
              <div className="row gap-6" style={{ alignItems: "center" }}>
                <Av name={p.n} flag={p.flag} status={i % 2 ? "idle" : "online"} />
                <div className="col" style={{ gap: 0 }}>
                  <span className="hand-2 small">{p.n} · <span className="num tiny pencil">{p.rep}</span></span>
                  <span className="tiny pencil uc">3+0 · {p.style}{p.streak > 0 ? ` · W${p.streak}` : ""}</span>
                </div>
              </div>
              <div className="row gap-4" style={{ alignItems: "center" }}>
                <Chip value={p.chip} variant="sm" />
                <button className="sk ink-blk" style={{ padding: "5px 10px", borderRadius: 4, fontFamily: "Patrick Hand", fontSize: 13 }}>Sit</button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 sk dash p-8 tac hand-2 pencil small">↓ pull to load more open tables</div>

        {/* tab bar */}
        <div style={{ position: "absolute", bottom: 14, left: 8, right: 8, background: "var(--paper-2)", border: "1.5px solid var(--ink)", borderRadius: 12, padding: "6px 10px", display: "flex", justifyContent: "space-around", alignItems: "center", boxShadow: "2px 2px 0 var(--ink)" }}>
          {["▶ Play", "Live", "+", "Friends", "Me"].map((x, i) => (
            <span key={x} style={{ fontFamily: "Patrick Hand", fontSize: 13, color: i === 0 ? "var(--ink)" : "var(--pencil)", padding: "4px 6px", borderRadius: 4, background: i === 2 ? "var(--gold)" : "transparent", fontWeight: i === 2 ? 700 : 400 }}>{x}</span>
          ))}
        </div>
      </div>
    </Phone>
  );
}

function LobbyTab() {
  return (
    <>
      <div className="sec-hd">
        <h2>① Lobby — three energies</h2>
        <div className="note">All-in on liveness. V1 reads as a poker floor; V2 sorts by stake tier for fast scanning at a glance; V3 collapses everything into one hero action with a live ticker beside. Mobile mirrors V3.</div>
      </div>

      <div className="rail cols-1">
        <div className="art">
          <Stamp id="LBY-01" v="1" label="Tables Floor — grid of open seats" />
          <Strap name="“The Floor”" sub="every open table visible at once · scout & accept inline" tag="DESKTOP" />
          <div className="canvas flat"><LobbyTablesFloor /></div>
        </div>

        <div className="art">
          <Stamp id="LBY-02" v="1" label="Stake Rails — sorted by buy-in" />
          <Strap name="“Stake Rails”" sub="horizontal rails by buy-in tier · micro / standard / high · Quick Match dock" tag="DESKTOP" />
          <div className="canvas flat"><LobbyStakeRails /></div>
        </div>
      </div>

      <div className="rail cols-2 mt-16" style={{ alignItems: "start" }}>
        <div className="art">
          <Stamp id="LBY-03" v="1" label="Hero Quickplay + Live Feed" />
          <Strap name="“One Action”" sub="single dominant CTA · stake + time control · feed runs beside it" tag="DESKTOP" />
          <div className="canvas flat"><LobbyHero /></div>
        </div>

        <div className="art" style={{ alignSelf: "start" }}>
          <Stamp id="LBY-04" v="1" label="Mobile Lobby — thumb-first" />
          <Strap name="“Pocket Floor”" sub="quick-match dock on top · vertical scroll of tables · 5-tab bottom bar" tag="MOBILE" />
          <div className="canvas flat" style={{ display: "flex", justifyContent: "center", padding: 18 }}>
            <LobbyMobile />
          </div>
        </div>
      </div>

      <div className="rail cols-1 mt-16">
        <div className="sk dash p-12" style={{ background: "var(--paper-2)" }}>
          <div className="hand" style={{ fontSize: 20, marginBottom: 4 }}>Notes on liveness</div>
          <div className="hand-2 pencil" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Even at low traffic the lobby should hum. All three lean on:
            <b> a heartbeat ticker</b> (recent settlements + upsets),
            <b> presence dots</b> on every avatar (online · idle · in-game),
            <b> animated chip stacks</b> when wagers form,
            and <b> a single dominant CTA</b> (FIND →) that never disappears. Avoid showing zero-state tables — collapse empty rails.
          </div>
        </div>
      </div>
    </>
  );
}

Object.assign(window, { LobbyTab });
