# Hermes Report — Kestrel Yard resubmission

The code and bundle were verified at commit `a3f8df4ccca8de664fc563bcbf2e73eefddba7ce`. This report is an additional documentation commit; submit the code commit above so the transcript check and bundle refer to the verified snapshot.

The entry was re-authored in the recorded session. The entrypoint `main.ts` was rewritten first and then revised; the game modules were rewritten across multiple recorded edits. The final bundle contains the Hermes session plus four Muse build sessions, with 19 parsed sessions total and 17 priced usage records.

The README contains the make.fun, rank, and reward badges for `threejs-fps-02`.

Bundle: `transcripts.tar.gz` in this directory. The bundle was produced by the kit CLI.

Kit check for the committed SHA:

- `transcripts_present`: PASS
- `transcripts_recorded`: PASS
- `thinking_wellformed`: PASS
- `thinking_in_window`: PASS
- `thinking_reproduces`: PASS — 1,203 / 3,445 lines, 34.9%; `main.ts` has 31 authored lines
- `thinking_turns`: PASS — 410 assistant turns
- `thinking_priced`: PASS — 17 usage records priced to a known model
- `thinking_revised`: PASS — final `game/src/game.js` content came from 9 writes/edits; `main.ts` from 5
- `transcripts_run_record`: PASS

Other local checks:

- `competition_open`: PASS
- `snapshot`: PASS
- `license_osi`: PASS
- `entrypoint`: PASS
- `13 passed, 0 failed, 6 skipped, 5 checked at submission`

Runtime verification: `node tools/soak.mjs` passed all 26 assertions, including zero page exceptions. `MAKEFUN_OUTPUT_DIR=... node main.ts` completed and wrote the dossier successfully.

Remaining submission actions: push commit `a3f8df4ccca8de664fc563bcbf2e73eefddba7ce` to the existing GitHub repository, confirm the repository is public and the repository owner/claim-file requirement is satisfied, then submit with `transcripts.tar.gz`. No push or submission was performed here.
