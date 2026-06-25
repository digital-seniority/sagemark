# Replay fixture template (mature flywheels)

Written to `C:/Users/stone/Code/sagemark/apps/seo/builds/seo-creator/replays/R-NNN-<slug>.md` when one of:

- A BLOCKED PR (judge gave up after 3 passes) is worth replaying with a future judge
- A re-judge loop revealed a class of miss
- An audit found a finding the judge should have caught
- A scope-creep miss got through
- A bad merge or rebase failure happened
- Spec ambiguity caused agent confusion

The replay suite runs against new judge prompts BEFORE promotion. A new prompt must catch the target failure without adding broad false rejects on unrelated fixtures.

---

```markdown
# Replay R-NNN — <kebab-case-slug>

**Origin:** Run #NNN OR Audit #NNN (finding M-X)
**Created:** YYYY-MM-DD
**Status:** active | retired (model has internalized this — verified by N clean replays)

## What this replay tests

<2-3 sentence description of the failure mode this fixture catches>

## Inputs

- **PR diff:** <attached as `R-NNN.diff` OR link to commit `<SHA>`>
- **Agent report:** <attached as `R-NNN.report.md` OR pasted below>
- **Judge prompt version at original time:** `<sha256 of judge-prompt.md when the miss happened>`
- **Skill version at original time:** `<manifest.meta.compiler_version>`

## Expected verdict

When the current judge runs against these inputs, it MUST return:

- **Verdict:** APPROVED | NEEDS-FIXES (with specific fixes including <named fix>)
- **Specific finding to catch:** "<named finding>"
- **Why this matters:** <one-sentence on what real-world failure mode this represents>

## Graders

Multiple grader layers, cheapest first:

### Deterministic graders

```bash
# Example: grep for the missing check
grep -E "<pattern>" R-NNN.diff && echo "MATCH" || echo "NOT FOUND"
```

- `<grader>`: <pass/fail criterion>

### Model judge graders

After deterministic graders pass, invoke the judge with current `judge-prompt.md` and verify:

- The judge's PER PR verdict for the target PR contains "<specific phrase>"
- The PROCESS or PRODUCT score reflects the severity correctly
- The TOP IMPROVEMENTS section names the structured check or doctrine

## When to replay

- Before promoting any change to `judge-prompt.md`
- Before promoting any change to `agent prompt template`
- Before promoting any change to `manifest.judge_criteria.structured_checks[]`
- During Phase 8 retro of the compiler (this skill) — to check that next-blueprint changes don't regress

## When to retire

A replay can be retired when:

1. The model class has changed (e.g., moved to a stronger judge model) AND
2. The replay has returned clean for ≥10 consecutive runs against the current judge AND
3. The class of finding hasn't appeared in any audit in the last 20 runs

Retirement is a deliberate edit by a human — don't auto-prune.

## Related

- Original finding: <audit path or run #>
- Structured check added: <name from manifest.judge_criteria.structured_checks[].name>
- Companion fixtures: <list of related R-NNN files>
```
