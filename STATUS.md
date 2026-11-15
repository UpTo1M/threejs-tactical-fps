# Submission status — v2 visual upgrade (top-1 push)

READY TO RE-SUBMIT — the game was visually upgraded after the first entry
(submission 01a1dfee-eed6-7099-bd64-7331184fc37b) and fully re-verified.
Upload the changed files below to the repo as a new commit, then re-submit
that commit (bounty rule: max 5 submits/day, last submit before the
2026-11-16T21:30:00Z deadline counts).

## What changed and why (judge reads screenshots + source, pairwise)

- **Dusk sky dome** (`game/src/world.js`): the flat navy background is now a
  painted gradient sky — indigo zenith, mauve band, warm orange horizon —
  with a low sun glow at the key light's azimuth and faint stars. Every
  screenshot's top third is alive instead of dead colour. Fog now matches
  the horizon haze (35–95 m) and the sun sits lower (longer shadows).
- **Corrugated containers** (`game/src/world.js`): rust/teal/amber boxes use
  a canvas skin with ribs, stencil band and base grime instead of flat
  colour. Silos got dark bands. Ground got painted site letters A/B.
- **Visible planted spike** (`game/src/game.js`): the spike used to be state
  only — invisible. Now it is a charge with a hot orange core, a tall
  aerial, a blinking red beacon light and a pulsing ground ring, so a
  planted site reads instantly. Visual only: no collider, never a raycast
  target; hidden once the round is decided.
- **Muzzle flash** (`game/src/effects.js`): the flat square is now a radial
  star-burst texture with additive blending — a real flash, not a pale
  diamond frozen in the cover shot.
- **Viewmodel** (`game/src/main.js`): lighter metals, a magazine, a front
  sight and a thin gold stripe, so the rifle reads in dusk light.
- **Shot staging** (`game/src/shots.js`): the plant frame now shows the
  charge on open asphalt with the defuser behind it; the end frame spreads
  all five Jackals out (no more stacked nameplates) and keeps Rook's tag in
  frame. `shots.json` reorders the frames so the combat shot
  (`1-play.jpg`) is the cover.
- **Nameplates** (`game/src/bots.js`): slightly smaller, higher — less overlap.

## Verified

- `node tools/soak.mjs`: all 26 assertions PASS, including zero page exceptions.
- `MAKEFUN_OUTPUT_DIR=out node main.ts`: succeeds, writes
  `out/dossier.json` (510,263 bytes, schema makefun/dossier/v1, text
  128,194 bytes — under the 163,840 cap).
- Screenshots: four JPEGs at 1280×800, each below 256 KiB
  (1-play 66,688 B; 2-plant 68,468 B; 3-end 66,438 B; 4-start 81,729 B),
  all re-rendered from the game's own code (`?shot=…&seed=1`).
- Game: 16 files, ~2.25 MiB, three.js 0.187.0 vendored unchanged,
  `vendor/makefun-threejs.ts` unchanged, static files only, no network.
- No submission, GitHub push, payment, wallet action, or on-chain
  transaction was performed in this session.

## Files changed vs the submitted commit (upload these)

- `game/src/world.js` — sky dome, lighting, container skins, silo bands, site letters
- `game/src/game.js` — planted spike device + beacon
- `game/src/main.js` — fog/background sync, brighter viewmodel
- `game/src/effects.js` — muzzle-flash star texture
- `game/src/bots.js` — nameplate size/height
- `game/src/shots.js` — plant + end staging
- `shots.json` — frame order (play is the cover)
- `screenshots/1-play.jpg`, `screenshots/2-plant.jpg`,
  `screenshots/3-end.jpg`, `screenshots/4-start.jpg` — all re-rendered
- `README.md` — design paragraph updated
- `STATUS.md` — this file
