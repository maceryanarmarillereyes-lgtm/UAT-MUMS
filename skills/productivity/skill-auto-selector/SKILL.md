---
name: skill-auto-selector
description: Enforces a deterministic workflow for discovering and applying the minimum required skills from the local skill folder before execution. Use when a task spans multiple domains and the agent must explicitly decide which skills to apply.
---

# Skill Auto Selector

## Purpose
Use this skill to make sure AI agents consistently select and apply the right skills from the local `skills/` directory based on task requirements.

## Activation Triggers
Activate when any of the following is true:
1. Task mentions "use skills", "skill folder", "all available skills", or similar wording.
2. Task contains multiple domain demands (e.g., architecture + debugging + deployment + documentation).
3. The agent is uncertain which skill should be applied first.

## Non-Negotiable Rules
1. **Do not load every skill blindly.** Enumerate all available skills, then pick only relevant ones.
2. **State selection rationale.** For each selected skill, explain one sentence why it applies.
3. **Sequence matters.** Order selected skills from discovery -> planning -> implementation -> validation.
4. **Fallback required.** If no exact match exists, choose the closest skill and declare the gap.

## Required Workflow

### Step 1 — Skill Discovery
- Scan `skills/` for available `SKILL.md` files.
- Build a concise inventory grouped by category path.

### Step 2 — Intent Mapping
- Break the user request into intents.
- Map each intent to candidate skills.
- Remove redundant skills that add no unique value.

### Step 3 — Selection Plan
Output this template before implementation:

```md
Skill Execution Plan
1. <skill-name> — <why selected>
2. <skill-name> — <why selected>
...
```

### Step 4 — Execution Contract
- Apply selected skills in order.
- Keep scope minimal; avoid unrelated skill instructions.
- Track which step each skill influenced.

### Step 5 — Verification
Before final output, confirm:
- [ ] Skills were discovered from local folder
- [ ] Selected skills are explicitly justified
- [ ] Only necessary skills were used
- [ ] Gaps and fallback decisions were documented

## Output Standard
When this skill is used, include a section titled **"Skill Coverage"** with:
- skills discovered count
- skills selected list
- rationale per selected skill
- omitted-skill policy (why others were skipped)

## Guardrail
If the user demands "use all skills", interpret as:
- discover all skills,
- evaluate all skills,
- apply only those relevant to the task,
- and explicitly report why others were not executed.

This prevents context overload and reduces regression risk.
