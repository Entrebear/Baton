# Resilience Guide

Transcript recovery, interrupted task resumption, and budget caps. Load when handling gateway restarts or failed subagents.

---

## Transcript Recovery

When a subagent session dies without announcing (gateway crash, timeout without cleanup):

### Step 1 — Get the transcript path
Use `subtask.transcriptPath` stored at spawn time. This is the canonical source.

If `transcriptPath` is null (old task file from before this feature):
```bash
node {baseDir}/scripts/task-manager.js --find-transcript <sessionId> [agentId]
```
Searches `~/.openclaw/agents/<agentId>/sessions/` for the JSONL file.

### Step 2 — Read the transcript
Try the native tool first (more reliable when session is still indexed):
```
sessions_history(sessionKey: <subtask.sessionKey>)
```

If the session is no longer indexed, read directly from disk:
```bash
node {baseDir}/scripts/task-manager.js --extract-partial --transcript-path <path>
```

Returns:
- `lastAssistantMessage` — what the subagent last said (up to 2000 chars)
- `recentToolResults` — last 3 tool call outputs (up to 500 chars each)
- `lineCount` — lines written (proxy for how much work was done)
- `hasContent` — whether anything useful was recovered
- `potentialSideEffects` — tool calls that may have mutated state (file writes, API calls, bash/exec)

### Step 3 — Classify and act

| Condition | Action |
|---|---|
| `hasContent: true` and `lineCount > 5` | Treat as `partial` → retry with correction (SKILL.md Attempt 1) |
| `hasContent: true` and `lineCount ≤ 5` | Too little to use; reset to `pending`, respawn clean |
| `hasContent: false` | Reset to `pending`, respawn clean |

### Step 4 — Side-effect check
If `potentialSideEffects` is non-empty, include the Side-Effect Awareness section in the correction prompt to avoid duplicate writes/calls.

---

## Resuming Interrupted Tasks

For each incomplete task found at session startup:

1. Read the task file
2. For each `running` subtask: attempt transcript recovery (above)
3. For each `pending` subtask: spawn as normal
4. For each `failed` subtask: spawn a Corrector (see references/orchestration.md) to build the retry prompt, then spawn the next worker
5. Continue the execution plan from current state

---

## Budget Caps

### At decomposition time
If `task.budgetCap` is set, estimate total task cost before spawning anything:
```
estimatedCost = Σ (subtask.estimatedInputTokens × model.costPerMTokenInput / 1e6)
              + Σ (2000 × model.costPerMTokenOutput / 1e6)
```

If `estimatedCost > task.budgetCap × 0.8` → warn the user before proceeding. Let them decide.

### During execution
Accumulate actual cost from the token stats in each subagent's announce payload:
```bash
node {baseDir}/scripts/task-manager.js --update-subtask <taskId> <subtaskId> '{"addCost": <amount>}'
```

If `task.actualCost > task.budgetCap` → pause the task, notify the user, ask how to proceed.
