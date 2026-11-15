# SABLE LINE — build session log

Game: "SABLE LINE", an original round-based tactical FPS (Counter-Strike-style,
never a copy) built for make.fun bounty `threejs-fps-02` ("Make the best
three.js tactical FPS", $1,000, deadline Mon 16 Nov 2026 21:30 UTC).

## 2026-11-15 ~21:45 WIB — session start
- Parent agent handed the bounty task (build only, do NOT submit/push).
- Fetched bounty page: title verified "Make the best three.js tactical FPS",
  slug `threejs-fps-02`, $1,000 escrow, ends Mon 16 Nov 2026 21:30 UTC.
- Fetched requirements JSON: harness `program/v1`; deliverables repo + commit
  + transcript bundle; `main.ts` (Node 22) at repo root; `vendor/makefun-threejs.ts`
  unchanged; `game/` static ES modules; three.js 0.187.0 vendored files;
  3–4 screenshots ≤256 KiB, long side ≤1280, short side ≥480; dossier via
  `buildDossier`; payout top 10 ($400/$200/$120/$40×7).
- Read `skill.md` (v1.5.172) and the kit's `competition.yaml`: judge is an AI
  pairwise comparison, 5 criteria (1 complete game, 2 gunplay/movement,
  3 tactics, 4 map/look, 5 code). Final heat: 6 Swiss rounds + top-12 playoff.
- Environment: Node v24.22.1 (≥22.18 OK). No system Chrome; found
  `/opt/meta-chromium/chrome` (Chromium 157) — needs Hatch WebGL domain policy
  flags; `hatch-webgl-all-origins-v1` policy file + sha256 switches let it
  start; `--screenshot`/`--dump-dom` produce no output, but CDP on
  `--remote-debugging-port=9222` answers, so screenshots go through a small
  Node CDP script (built-in WebSocket) waiting for `window.__shotReady`.
- Downloaded kit `https://make.fun/c/threejs-fps-02/kit`, unpacked to
  `~/workspace/makefun/kit/threejs-fps-02-kit/`. Verified starter hashes:
  `vendor/makefun-threejs.ts` f9622210…, `three.core.min.js` 613e370f…,
  `three.module.min.js` ef510bae… (match `kit.json`).

## Design (decided before writing code)
- 5v5, player + 4 Vanguard bots (attackers) vs 5 Jackal bots (defenders).
- Map "Kestrel Yard": original 3-lane industrial yard, two spike sites
  (A "Crane", B "Silo"), mid, connectors, containers/crates/silo props.
- Rounds: buy phase 12 s → live 100 s → spike 35 s → banner. First to 5
  round wins, max 9 rounds. Win by elimination, spike detonation, defuse,
  or time (defenders win on timeout if spike not planted).
- Economy: start $800, kill +$300, round win +$3250, loss +$1900 (+$500 per
  consecutive loss, max +$1500), plant +$300. Buy menu (B): 4 guns, 2
  grenades, kevlar, defuse kit.
- Guns: P9 sidearm, VK-9 SMG, AR-77 rifle, Lancer-50 marksman (scope).
  Hitscan vs body/head hitboxes (head ×4), recoil + spread punish moving
  fire, tracers, muzzle flash, WebAudio synth sounds.
- Bots: waypoint-graph navigation (BFS), hold/rotate/rush roles, line of
  sight + reaction time, burst fire with distance/movement falloff, hearing
  (gunshots pull nearby bots), plant/defuse behaviour, retake on plant.
- HUD: health/armor, ammo, money, timer, score, killfeed, dynamic
  crosshair, hitmarker, damage vignette, spike status, buy menu, minimap.
- Screenshots: deterministic `?shot=start|play|plant|end&seed=N` staging,
  4 JPEGs 1280×800 via headless Chromium CDP.

## Build order
1. Skeleton: copy `main.ts`, `serve.ts`, `LICENSE` (MIT), `vendor/`,
   `game/vendor/three/` from kit starter (byte-for-byte where required).
2. `game/src/`: palette, input, audio, world, player, weapons, effects,
   bots, game (state machine / rounds / economy / spike), hud, shots, main.
3. `game/index.html`: import map + HUD DOM + buy menu + overlays.
4. Serve + CDP screenshots; iterate on visuals/gameplay until 4 shots look
   like a real tactical FPS.
5. `node main.ts` to produce `out/` dossier; run kit CLI `check` if possible
   (needs no credentials for offline checks); verify gate caps.
6. README.md, RUN_RECORD.md, SESSION.md (this file), LICENSE.

## Continuation: local verification and packaging

- Recovered public brief and requirements into evidence/; no brief file was present at takeover.
- Fixed weapon reset on match restart and sidearm replacement when buying a new primary, premature round timeout after planting, reversed mute toggle, stuck input on unlock, pause handling, and crosshair spread feedback.
- Moved screenshot/soak profiles into .cache/ and made the soak file URL relative to its module.
- Ran the real Chromium soak successfully; raw output is evidence/soak.txt. It drives simulation via the debug hook, so it does not certify human mouse feel or audio quality.
- Recaptured all four screenshots, checked their dimensions and sizes, parsed all source files, and rebuilt out/dossier.json.
- Created README.md, RUN_RECORD.md and STATUS.md. Authentic transcript archive and submission repository identity remain missing within this directory.
- No submission, push, payment, or transaction performed.
- Scope exception: the initial invocation of node main.ts used its grader default /output, outside the requested directory. All subsequent builds explicitly used MAKEFUN_OUTPUT_DIR=out. That initial write was an error, not an authorized deployment.

