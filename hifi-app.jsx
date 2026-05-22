// hifi-app.jsx — Design canvas wiring for hi-fi screens.

function App() {
  return (
    <DesignCanvas>
      <DCSection id="desktop" title="Desktop · 1440×900" subtitle="Lobby · Wager scout · In-game · Win settlement">
        <DCArtboard id="d-lobby" label="① Lobby" width={1440} height={900}>
          <LobbyDesktop />
        </DCArtboard>
        <DCArtboard id="d-wager" label="② Wager · scouting" width={1440} height={900}>
          <WagerDesktop />
        </DCArtboard>
        <DCArtboard id="d-ingame" label="③ In-game · 0:14 left" width={1440} height={900}>
          <IngameDesktop />
        </DCArtboard>
        <DCArtboard id="d-postgame" label="④ Settlement · WIN" width={1440} height={900}>
          <PostgameDesktop />
        </DCArtboard>
      </DCSection>

      <DCSection id="mobile" title="Mobile · 390×844" subtitle="iPhone-class viewport — thumb-first">
        <DCArtboard id="m-lobby" label="① Lobby" width={390} height={844}>
          <LobbyMobile />
        </DCArtboard>
        <DCArtboard id="m-wager" label="② Wager · scouting" width={390} height={844}>
          <WagerMobile />
        </DCArtboard>
        <DCArtboard id="m-ingame" label="③ In-game" width={390} height={844}>
          <IngameMobile />
        </DCArtboard>
        <DCArtboard id="m-postgame" label="④ Settlement" width={390} height={844}>
          <PostgameMobile />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
