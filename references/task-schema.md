# Task File Schema

Full schema for `~/.openclaw/baton/tasks/<taskId>.json`.

## Top-level fields

| Field | Type | Description |
|---|---|---|
| `taskId` | string | UUID |
| `goal` | string | One-sentence description |
| `status` | enum | `running / partial / done / failed` |
| `priority` | enum | `urgent / normal / background` |
| `orchestratorAgent` | string? | Agent ID of the conductor |
| `userChannel` | string? | Channel/session key for reporting back |
| `budgetCap` | number? | Max spend USD |
| `actualCost` | number | Accumulated from announce token stats |
| `outputFile` | string? | Filename in `baton-outputs/` |
| `templateId` | string? | Template used |
| `rerunOf` | string? | Original taskId if this is a re-run |
| `parallelGroups` | array | e.g. `[["A","C"],["B"]]` |
| `finalSynthesis` | string? | Final output after all subtasks complete |
| `archivedAt` | ISO? | Set when moved to archive |

## Subtask fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Short label: A, B, or descriptive slug |
| `description` | string | What this subtask does |
| `dependsOn` | string[] | IDs of required predecessors |
| `fanInPolicy` | enum | `"all"` or `"any"` |
| `targetAgent` | string? | `null` = spawn under self; agentId = specialist agent |
| `status` | enum | `pending/running/done/failed/skipped_dependency` |
| `model` | string? | `provider/model-id` used |
| `sessionKey` | string? | OpenClaw session key |
| `sessionId` | string? | UUID |
| `transcriptPath` | string? | Absolute JSONL path — **store at spawn time** |
| `attempts` | number | How many times spawned |
| `output` | string? | Full output text |
| `outputSummary` | string? | One-paragraph summary for checkpoints |
| `estimatedInputTokens` | number? | Rough token count for prompt |
| `contextStrategy` | enum? | `verbatim / summarise / compress` |
| `definitionOfDone` | string? | Checkable completion criterion |
| `validationResult` | enum? | `pass / partial / fail` |
| `failureReason` | enum? | `rate_limit / timeout / model_not_applied / context_error / bad_output` |
| `sideEffects` | array | Recorded mutations for idempotency |

## Status transitions

```
pending → running              on spawn
running → done                 on validated completion
running → partial              on partial validation
running → failed               on exhausted retries
running → pending              on restart with empty transcript
failed  → running              on retry with next model
pending → skipped_dependency   fanInPolicy=all and a dep failed
```

## Fan-in policies

| Policy | Behaviour when a dep fails |
|---|---|
| `all` (default) | Subtask skipped (`skipped_dependency`) |
| `any` | Runs with available dep outputs; missing inputs noted in prompt |
