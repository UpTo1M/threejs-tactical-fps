# SABLE LINE — Kestrel Yard

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/UpTo1M/threejs-tactical-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/UpTo1M/threejs-tactical-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

SABLE LINE is an original round-based tactical first-person shooter built with Three.js. Fight as Vanguard against five Jackal defenders across Kestrel Yard, buy equipment between rounds, use cover and smoke, and plant the spike at Crane or Silo. First team to five rounds wins.

## Play locally

Requires Node.js 22.18 or newer and a desktop browser with WebGL 2. No npm install and no network access are needed at runtime.

```sh
node serve.ts
```

Open http://localhost:8080 in a desktop browser and click “Click to play”.

Controls: WASD move, mouse look, click fire, R reload, Q swap weapon, Shift walk quietly, Space jump, Ctrl crouch, B buy, E plant, G frag, T smoke, RMB scope with the Lancer-50, and M mute audio.

## Build dossier

The make.fun entrypoint copies the static game and screenshots into the grader output and writes `dossier.json`:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

The dossier includes the game source, the vendored Three.js runtime, the four deterministic JPEG screenshots, and the visual/gameplay summary consumed by the competition grader.

## Design

Kestrel Yard is a three-lane industrial site at dusk: a gradient sky dome with a low sun and stars, two objectives, corrugated containers, a crane, banded twin silos, painted site letters, site cover, connectors, and a minimap. The planted spike is a visible charge with a blinking red beacon and a pulsing ground ring. The simulation uses fixed steps, hitscan weapons with recoil/spread and head hitboxes, team bots navigating a waypoint graph, hearing and line of sight, smoke occlusion, frag grenades, buy economy, round loss bonuses, spike plant/defuse, and match progression.

## Verification

The repository includes a browser soak test that drives the real game state through its debug hook:

```sh
node tools/soak.mjs
```

It verifies the menu, buy phase, weapon purchase, movement, bot navigation, headshot kill, grenade resolution, spike plant, round win, match win, smoke occlusion, and page exceptions. `tools/shoot.mjs` captures the deterministic `?shot=start|play|plant|end&seed=N` evidence frames.

## License

MIT. Three.js is distributed under its own license in `game/vendor/three/LICENSE`.

---

Entered on [make.fun](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards.
