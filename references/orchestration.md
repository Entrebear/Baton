# Orchestration Guide

Detailed reference for the Planner, Validator, Synthesiser, and Corrector subagent roles, plus scheduling, history, and inter-task context. The primary agent executes mechanically — all reasoning is delegated to capable subagents.

---

## Subagent Roles

### Planner

Spawned by the primary agent when a request is not obviously a single atomic task. Receives the full user request and returns a complete task JSON ready to pass to `--create`. Must be spawned with a `reasoning`-capable model.

Spawn with `cleanup: "delete"` so the session is cleaned up immediately after the plan is returned.

**Planner prompt:**
```
## Your Task
You are a task planner. Analyse the user request below and produce a complete task decomposition
as a single JSON object. Do not execute anything. Output only the JSON, no prose.

## User Request
<verbatim user message>

## Available Models
<paste the model registry entries with their capable[] and contextWindow fields>

## Required Output Format
A JSON object matching this schema exactly:
{
  "goal": "<one sentence>",
  "priority": "urgent|normal|background",
  "subtasks": [
    {
      "id": "A",
      "description": "<what to do>",
      "dependsOn": [],
      "fanInPolicy": "all",
      "targetAgent": null,
      "definitionOfDone": "<concrete checkable criterion>",
      "estimatedInputTokens": <number>,
      "contextStrategy": "verbatim|summarise|compress",
      "model": "<provider/model-id from the available models above>"
    }
  ],
  "parallelGroups": [["A","C"],["B"]]
}

## Rules
- Each subtask must be atomic: one model, one output, completable in one subagent run.
- Assign the best model from available models for each subtask's type and token requirements.
- targetAgent: always null unless the user or system has explicitly nominated a specialist agent for this subtask. null means spawn under the calling agent.
- contextStrategy: verbatim if upstream output ≤20% of target model context, summarise if 21-60%, compress if >60%.
- parallelGroups: list subtask IDs that can run simultaneously in each round.
- definitionOfDone must be verifiable by reading the output — no subjective criteria.
```

After spawning: parse the returned JSON, validate it has required fields, write to disk with `--create`.

---

### Validator

Spawned only when complex validation is needed: code correctness, logic soundness, mathematical accuracy, security review, factual claims. Not needed for simple format/completeness checks — the primary agent handles those directly. Spawn with `cleanup: "delete"`.

**Validator prompt:**
```
## Your Task
Validate the output below against the subtask definition. Return a JSON verdict only.

## Subtask Definition
Description: <subtask.description>
Definition of Done: <subtask.definitionOfDone>
Required Output Format: <from the original worker prompt>

## Output to Validate
<subagent result text>

## Required Output Format
{
  "result": "pass|partial|fail",
  "issues": ["<specific issue 1>", "<specific issue 2>"],
  "completedPortion": "<what was done correctly, verbatim if short>",
  "missingPortion": "<what is still needed to satisfy the definition of done>"
}

## Validation Criteria
- pass: output fully satisfies the definition of done in the correct format
- partial: some meaningful work was done but definition of done is not fully met
- fail: output is empty, wrong format, off-topic, or clearly incorrect
```

The primary agent reads `result` and routes accordingly: pass→continue, partial/fail→Corrector.

---

### Corrector

Spawned when a Validator returns `partial` or `fail`, or when the primary agent determines a failure is too complex to correct itself (bad logic, incorrect code, failed reasoning). For simple failures (wrong format, missing section), the primary agent builds the correction prompt directly. Spawn with `cleanup: "delete"`.

**Corrector prompt:**
```
## Your Task
A worker subagent failed or only partially completed a task. Build a self-contained retry prompt
for the next worker. Return only the retry prompt text, no prose around it.

## Original Task
Description: <subtask.description>
Definition of Done: <subtask.definitionOfDone>

## Validation Verdict
Result: <pass|partial|fail>
Issues: <validator issues[]>
Completed portion: <validator completedPortion>
Missing portion: <validator missingPortion>

## Prior Attempt Output
<subagent result or transcript partial recovery>

## Known Side Effects from Prior Attempt
<subtask.sideEffects[] or "none">

## Attempt Number
<subtask.attempts>

## Instructions
Build a retry prompt using this structure:
- Your Task: instruct the worker to complete or correct the missing portion only
- Context: include the completed portion verbatim as prior work
- Required Output Format: same as original task
- Constraints: same as original, but simplified if this is attempt 3+
- Definition of Done: same as original
- Side-Effect Awareness (if attempt > 1): list what the prior attempt already did
```

The primary agent takes the returned prompt text and spawns the next worker with it.

---

### Synthesiser

Always spawned when all subtasks are terminal — the primary agent never synthesises itself. Spawn with `cleanup: "delete"`.

**Synthesiser prompt:**
```
## Your Task
Synthesise the outputs from all completed subtasks into a single coherent final result.

## Original Goal
<task.goal>

## Completed Subtask Outputs
<for each done subtask: subtask.id + subtask.description + subtask.output>

## Failed/Skipped Subtasks (if any)
<list with reasons — note what is missing from the final output>

## Required Output Format
<describe the expected final format: report, code, document, etc.>

## Instructions
- Integrate all outputs into one cohesive result
- Do not repeat content unnecessarily
- If some subtasks failed, note the gaps clearly
- Output only the final result, no meta-commentary
```

After synthesis: the primary agent writes `finalSynthesis` to the task file, writes to `baton-outputs/`, reports to user, archives task.

---

## Simple vs Complex Planning

The primary agent handles planning directly when ALL are true:
- Single domain, linear steps, obvious order
- One clear output, no ambiguous dependencies
- Estimated under 5 minutes

Otherwise spawn a Planner. When in doubt, spawn a Planner — it costs one extra subagent turn but prevents wasted worker runs from a bad plan.

Simple validation (primary agent does directly): non-empty, correct format, obviously on-topic.
Complex validation (spawn Validator): code correctness, logic soundness, mathematical accuracy, security, factual claims requiring verification.

## Spawn Rules

**Default: always spawn under the calling agent.** Do not include `agentId` in `sessions_spawn` unless the subtask has `targetAgent` explicitly set. Omitting `agentId` is how OpenClaw spawns under the calling agent — it is not a gap to fill.

```
sessions_spawn(
  task: "...",
  model: "...",
  runTimeoutSeconds: N,
  cleanup: "delete"
  // agentId: only add this line when subtask.targetAgent is set
)
```

When `targetAgent` is set:
```
sessions_spawn(
  task: "...",
  model: "...",
  agentId: "<targetAgent>",
  runTimeoutSeconds: N,
  cleanup: "delete"
)
```

`cleanup: "delete"` must be included on every spawn — causes the session to be archived immediately after announcing rather than waiting for the default 60-minute auto-archive.

Apply to all subagent types: Planner, workers, Validator, Corrector, Synthesiser.

---

## Context Strategy

Set per subtask based on upstream output size vs. target model context window:

| Upstream output | Strategy | Action |
|---|---|---|
| ≤ 20% of context window | `verbatim` | Pass as-is |
| 21–60% | `summarise` | Planner or Corrector prepends a summary paragraph |
| > 60% | `compress` | Spawn a dedicated `transform` worker first, pass compressed version |

---

## Execution Plan

```
Round 1: subtasks with dependsOn = []       → spawn in parallel
Round N: subtasks whose deps are all done   → spawn in parallel
Continue until all subtasks terminal
```

Terminal: `done`, `failed`, `skipped_dependency`.

Priority queue: `urgent > normal > background`. Tasks waiting > 10 min auto-promoted one level.
Fan-in: `all` (default — all deps must be done) or `any` (run with whatever completed).

---

## Scheduled Tasks

1. Spawn a Planner to decompose the recurring task as normal
2. Save decomposition as template: `--save-template '<json>'`
3. Register cron job: `sessionTarget: "isolated"` for stateless; `sessionTarget: "session:baton-<slug>"` for continuity. Always set `delivery.announce`.
4. Store cron job ID in template `cronJobId` field.

On each trigger: load template, run full execute flow (Planner not needed — template is the plan).

---

## Task History

Search: `--search "<keywords>"` — goal text, subtask descriptions, final synthesis.
Re-run: `--rerun <taskId>` — resets all statuses, new task file, preserves `rerunOf` lineage.
Output folder: `~/.openclaw/workspace/baton-outputs/`

---

## Inter-Task Context

When task references past work:
1. Extract keywords from user request
2. `--search "<keywords>"` → find matching archived task
3. Load `finalSynthesis` or relevant subtask output
4. Pass to Planner as additional context in the planner prompt
