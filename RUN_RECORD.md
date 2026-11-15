# SABLE LINE run record

Competition: `threejs-fps-02` — Make the best three.js tactical FPS

Build purpose: finish the existing SABLE LINE entry as a ready-to-submit local package. No submission, push, payment, wallet, or on-chain action was performed.

## Provenance limits

Harness: Hermes Agent; harness version not established in this directory. Runtime reports model gpt-6-astra and provider custom; the underlying provider identity and provider usage records have not been independently established. Effort setting is not exposed. No external MCP server was used; shell and file tools are harness tools. A browser helper was attempted but showed a different service, so it is not verification evidence. Native CDP tools supplied the successful game checks.

System prompt and instruction content are withheld; this record documents observable execution rather than supplying private agent instructions. Original earlier-session transcripts are not present in this directory. This document is not a transcript bundle, and provider/model eligibility remains unverified.

## Environment

- Runtime: Node.js 24.22.1, compatible with the Node 22 requirement
- Browser verification: Hatch Chromium with SwiftShader WebGL over CDP
- Runtime dependencies: vendored Three.js only; no npm install
- Entry command: `MAKEFUN_OUTPUT_DIR=out node main.ts`
- Local play command: `node serve.ts`
- Browser soak command: `node tools/soak.mjs`
- Evidence capture: `node tools/shoot.mjs <file-url> <output.jpg> 1280 800`

## Checks run

- `node --check game/src/*.js`, `node --check serve.ts`, and `node --check main.ts`: passed after removing non-Node TypeScript annotations from the standard-library server.
- `node tools/soak.mjs`: passed all assertions, including `no page exceptions`.
- Four deterministic browser captures at 1280×800: `start`, `play`, `plant`, and `end` completed successfully.
- `MAKEFUN_OUTPUT_DIR=out node main.ts`: completed and wrote `out/dossier.json`, `out/game/`, and `out/screenshots/`.
- Screenshot caps: 4 JPEGs, each under 256 KiB; each is 1280×800.
- Game size caps: 16 files and approximately 2.25 MiB, below the stated limits.

## Gameplay coverage exercised

The soak test starts the match, validates the buy phase and economy, purchases an AR-77 and frag grenade, advances into live play, moves the player, moves bots, lands a headshot kill and reward, resolves a frag, plants the spike, wins a round by elimination, advances to round two, ends a 5–4 match, tests smoke line-of-sight blocking, and reports zero browser exceptions.

## Package contents

- `main.ts`: make.fun Node entrypoint and dossier builder
- `game/`: static playable Three.js game
- `vendor/makefun-threejs.ts`: kit library retained unchanged
- `screenshots/`: four deterministic judge frames
- `README.md`: local play and build instructions
- `LICENSE`: MIT license
- `SESSION.md`: build session history
- `RUN_RECORD.md`: this verification record
- `STATUS.md`: readiness result
