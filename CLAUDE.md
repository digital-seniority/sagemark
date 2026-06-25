@AGENTS.md

<!-- flywheel-autoloop:compact-instructions -->
## Compact Instructions

If any autonomous build loop is active, ALWAYS preserve this across compaction: read `.claude/flywheel-autoloop-roots.json`; for each listed build state root whose `.auto-loop.json` has `"active": true`, an autonomous `/<slug>-build auto` run is in progress — on resume, re-read that root's `RESUME.md` then `STATE.md` and CONTINUE from the recorded cursor. Do NOT restart a run or re-merge MERGED PRs.
<!-- /flywheel-autoloop:compact-instructions -->
