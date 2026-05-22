// app.jsx — Wireframe doc shell, tab nav, tweaks panel.

const { useEffect } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "tab": "system",
  "density": "regular",
  "annotations": true,
  "view": "all",
  "paper": "warm"
}/*EDITMODE-END*/;

const PAPER_PRESETS = {
  warm:   { paper: "#f4ede0", paper2: "#ede3d2", paper3: "#e3d6bd" },
  cool:   { paper: "#e9eef0", paper2: "#dbe3e7", paper3: "#c7d1d6" },
  dark:   { paper: "#1f1c19", paper2: "#2a2622", paper3: "#3a342c" },
  cream:  { paper: "#fbf6ea", paper2: "#f3ecdb", paper3: "#e8dfc8" },
};

const TABS = [
  { id: "system",   label: "System",     n: "00" },
  { id: "lobby",    label: "Lobby",      n: "01" },
  { id: "wager",    label: "Wager",      n: "02" },
  { id: "ingame",   label: "In-Game",    n: "03" },
  { id: "postgame", label: "Post-Game",  n: "04" },
  { id: "profile",  label: "Identity",   n: "05" },
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // body class for global tweaks
  useEffect(() => {
    const b = document.body;
    b.classList.remove("dense", "roomy");
    if (t.density === "dense") b.classList.add("dense");
    if (t.density === "roomy") b.classList.add("roomy");

    b.classList.toggle("no-anno", !t.annotations);

    b.classList.remove("only-mobile", "only-desk");
    if (t.view === "mobile") b.classList.add("only-mobile");
    if (t.view === "desktop") b.classList.add("only-desk");

    const p = PAPER_PRESETS[t.paper] || PAPER_PRESETS.warm;
    const r = document.documentElement.style;
    r.setProperty("--paper",   p.paper);
    r.setProperty("--paper-2", p.paper2);
    r.setProperty("--paper-3", p.paper3);
    if (t.paper === "dark") {
      r.setProperty("--ink", "#f4ede0");
      r.setProperty("--ink-2", "#d4ccbb");
      r.setProperty("--pencil", "#a89e8a");
      r.setProperty("--rule", "rgba(244,237,224,.28)");
    } else {
      r.setProperty("--ink", "#1b1815");
      r.setProperty("--ink-2", "#3a342c");
      r.setProperty("--pencil", "#6b6356");
      r.setProperty("--rule", "rgba(27,24,21,.32)");
    }
  }, [t.density, t.annotations, t.view, t.paper]);

  const activeTab = TABS.find(x => x.id === t.tab) || TABS[0];

  return (
    <div className="doc" data-screen-label={`Horsey · ${activeTab.label}`}>
      <div className="masthead">
        <div>
          <h1 className="title">Horsey</h1>
          <div className="sub">low-fi wireframe exploration · 5 surfaces · ~20 directions</div>
        </div>
        <div className="meta">
          <span className="dot"></span>
          <span>v0.1 · pencil draft</span>
          <span style={{ borderLeft: "1px solid var(--rule)", paddingLeft: 16 }}>
            poker-floor energy · chip-based wagers · mobile-native
          </span>
        </div>
      </div>

      <div className="legend">
        <span className="h">how to read</span>
        <div className="item"><span className="sw" style={{ background: "var(--ink)" }}></span>solid borders + shadow = real UI elements</div>
        <div className="item"><span className="sw" style={{ background: "repeating-linear-gradient(45deg,var(--paper-2),var(--paper-2) 4px,var(--paper-3) 4px,var(--paper-3) 8px)", borderStyle: "dashed" }}></span>diagonal hatch = image / asset placeholder</div>
        <div className="item"><span className="sw" style={{ background: "var(--gold)" }}></span>gold = wager / escrow surfaces</div>
        <div className="item"><span className="sw" style={{ background: "var(--felt)" }}></span>felt = table / hero stakes</div>
        <div className="item"><span style={{ fontFamily: "Caveat", color: "var(--hot)", fontSize: 18, lineHeight: 1 }}>red writing</span>= designer's note · toggle in Tweaks</div>
      </div>

      <div className="tabs">
        {TABS.map(tab => (
          <button key={tab.id} className={`tab ${tab.id === t.tab ? "on" : ""}`} onClick={() => setTweak("tab", tab.id)}>
            <span className="num">{tab.n}</span>{tab.label}
          </button>
        ))}
      </div>

      {t.tab === "system"   && <SystemTab />}
      {t.tab === "lobby"    && <LobbyTab />}
      {t.tab === "wager"    && <WagerTab />}
      {t.tab === "ingame"   && <IngameTab />}
      {t.tab === "postgame" && <PostGameTab />}
      {t.tab === "profile"  && <ProfileTab />}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Section" />
        <TweakSelect label="Tab"
          value={t.tab}
          options={TABS.map(x => ({ value: x.id, label: `${x.n} · ${x.label}` }))}
          onChange={v => setTweak("tab", v)} />

        <TweakSection label="View" />
        <TweakRadio label="Device"
          value={t.view}
          options={[
            { value: "all", label: "Both" },
            { value: "desktop", label: "Desktop" },
            { value: "mobile", label: "Mobile" },
          ]}
          onChange={v => setTweak("view", v)} />
        <TweakRadio label="Density"
          value={t.density}
          options={[
            { value: "dense", label: "Dense" },
            { value: "regular", label: "Regular" },
            { value: "roomy", label: "Roomy" },
          ]}
          onChange={v => setTweak("density", v)} />
        <TweakToggle label="Designer notes" value={t.annotations}
          onChange={v => setTweak("annotations", v)} />

        <TweakSection label="Paper" />
        <TweakRadio label="Tone"
          value={t.paper}
          options={[
            { value: "warm", label: "Warm" },
            { value: "cream", label: "Cream" },
            { value: "cool", label: "Cool" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={v => setTweak("paper", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
