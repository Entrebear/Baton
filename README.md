<div align="center">

# 🎼 Baton

**AI Agent Orchestrator & Model Router for [OpenClaw](https://openclaw.ai)**

[![OpenClaw](https://img.shields.io/badge/OpenClaw-compatible-brightgreen?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEycy40OCA5LjUyIDEwIDEwIDEwLTQuNDggMTAtMTBTMTcuNTIgMiAxMiAyem0wIDE4Yy00LjQxIDAtOC0zLjU5LTgtOHMzLjU5LTggOC04IDggMy41OSA4IDgtMy41OSA4LTggOHoiLz48L3N2Zz4=)](https://openclaw.ai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.3-blue.svg)](CHANGELOG.md)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org)

</div>

---

Baton turns any OpenClaw agent into a conductor. It decomposes tasks into subtasks, routes each to the best available model from your configured providers, spawns subagents in parallel, monitors and validates their results, and automatically resumes work after gateway restarts — all without you thinking about which model to use or what to do when something fails.

## How it works

```
User request
     │
     ▼
┌─────────────────────────────────┐
│  Baton Conductor                │
│  (never does work itself)       │
├─────────────────────────────────┤
│  1. Decompose into subtask graph│
│  2. Select model per subtask    │
│  3. Spawn subagents in parallel │
│  4. Monitor & validate results  │
│  5. Escalate on failure         │
│  6. Synthesise & report         │
└─────────────────────────────────┘
     │                    │
     ▼                    ▼
Subagent A           Subagent B
(fast model)         (specialist)
```

The conductor never executes work. Subagents do — each spawned with the model best matched to its specific task, routing around rate limits and spreading load across providers automatically.

## Features

### Orchestration
- **Planner subagent** — complex tasks are planned by a capable `reasoning` model; simple linear tasks are planned directly by the primary agent
- **Four specialised subagent roles** — Planner (complex decomposition), Validator (complex correctness checking), Corrector (retry prompt building for hard failures), Synthesiser (final output assembly)
- **Automatic session cleanup** — all subagent sessions are cleaned up immediately after announcing via `cleanup: "delete"`, keeping the session list lean
- **Parallel execution** — independent subtasks run simultaneously up to your configured slot limit
- **Sequential chains** — dependent subtasks wait for their dependencies; outputs are passed forward automatically
- **Fan-in policies** — `all` (wait for every dep) or `any` (run with whatever completed)
- **Output compression** — large upstream outputs are summarised or compressed before being passed downstream, preserving model context headroom
- **Priority queue** — `urgent` / `normal` / `background`; tasks waiting > 10 min are auto-promoted
- **Result validation** — every subagent result checked for completeness, format, coherence, and scope before being accepted

### Resilience
- **Automatic resumption** — task state written to disk before any spawn; incomplete tasks resume automatically after gateway restarts
- **Transcript recovery** — when a subagent dies mid-run, Baton reads its JSONL transcript from disk to recover partial work
- **Three-attempt escalation** — same model → stronger (reasoning-capable) model → strongest available → user escalation; never silently gives up
- **Idempotent retries** — retry prompts include awareness of prior side effects to prevent duplicate writes and API calls

### Model routing
- **Context-aware** — models excluded or penalised when task token requirements exceed their context window
- **Rate-limit-aware** — sliding window tracking across all window types: per-second, per-minute, per-hour, per-day, per-week, rolling N-hour
- **Load-spreading** — work distributed across providers to avoid rate-limit hot spots
- **Multi-agent coordination** — multiple Baton instances share rate-limit state so they route around each other's usage
- **Agent-scoped models** — models in an agent's `models.json` are exclusive to that agent; `openclaw.json` models are instance-wide
- **Specialist routing** — subtasks can be routed to other named agents in your OpenClaw setup

### Visibility
- **Agent status** — active tasks for the calling agent only
- **Instance status** — all tasks across the instance, grouped by agent (elevated privilege required)
- **Task history** — search archived tasks by keyword; re-run any past task
- **Templates** — save decomposition patterns as reusable templates

### Quality of life
- **Dry-run mode** — show the full plan and model selections before spawning anything (when explicitly requested)
- **Scheduled tasks** — register recurring tasks via OpenClaw's cron system
- **Budget caps** — set a maximum spend per task; pauses and asks before exceeding it
- **Output persistence** — final outputs automatically written to `~/.openclaw/workspace/baton-outputs/`
- **Inter-task context** — reference outputs from past tasks by description; Baton finds and injects them

## Installation

**1. Install the skill**
```bash
# Instance-wide
unzip baton.skill -d ~/.openclaw/skills/

# Or workspace-specific
unzip baton.skill -d <workspace>/skills/
```

**2. Configure openclaw.json**
```json
{
  "agents": {
    "defaults": {
      "subagents": {
        "maxSpawnDepth": 2,
        "maxChildrenPerAgent": 5
      }
    }
  }
}
```

**3. For specialist agents** (optional)
```json
{
  "agents": {
    "list": {
      "my-specialist-agent": {
        "subagents": { "allowAgents": ["my-orchestrator-agent"] }
      }
    }
  }
}
```

**4. Add BOOT.md to your workspace**

Copy `BOOT.md` from the skill into your OpenClaw workspace so the startup routine runs automatically on every gateway restart:
```bash
cp path/to/baton-github/BOOT.md ~/.openclaw/workspace/BOOT.md
```
Edit the `<baton-skill-path>` placeholder in the file to match where you installed the skill, e.g. `~/.openclaw/skills/baton`.

If you already have a `BOOT.md`, append the Baton section to it rather than replacing it.

**5. Start a conversation.** On first run, Baton discloses what it accesses and asks for your confirmation before running any scripts. After confirming, it walks you through onboarding for each configured provider and model.

## Onboarding

Baton guides you through a short conversation the first time it encounters each provider or model:

**For providers:** asks whether it has a shared limit, per-model limits, is unlimited, or has a mixed topology, then asks for the specific limit value and window (e.g. "40 per minute", "1000 per day"). Auto-detects limits for providers that expose them via API.

**For models:** searches the web for capability information; asks you if nothing is found. Optionally collects cost data for budget tracking.

Answers are stored in `~/.openclaw/baton/limit-config.json` and `agent-policies.json`.

## Model Registry

| Source | Scope |
|--------|-------|
| `~/.openclaw/openclaw.json` → `models.providers` | Instance-wide — available to all agents |
| `~/.openclaw/agents/<id>/agent/models.json` | Agent-scoped — exclusive to that agent only |

When routing subtasks to a specialist agent, Baton only selects from models that agent has access to.

## Usage

Just talk to your agent normally.

```
"Write a Python script that reads a CSV and plots the results"
→ Baton decomposes, selects models, spawns in parallel, synthesises

"Show me the plan for: research top 5 AI papers this month and summarise"
→ Dry run: shows subtasks, models, estimated cost, asks to proceed

"Every morning at 8am, summarise my overnight emails"
→ Registers a cron job

"Redo that sales analysis from last week"
→ Searches archives, re-runs the task

"What are you working on?"
→ Shows this agent's active tasks

"Show me instance status"  (elevated agents only)
→ All agents' tasks grouped by agent
```

## State Files

```
~/.openclaw/baton/
├── tasks/                    Active task files
├── archive/                  Completed tasks
├── templates/                Reusable task templates
├── checkpoints/              Per-task checkpoint notes
├── model-registry-cache.json
├── limit-config.json
├── agent-policies.json
├── instance-state.json
├── config-hash.txt
└── gateway-alive.txt

~/.openclaw/workspace/
├── baton-outputs/            All persisted task outputs
└── baton-checkpoint.md       Latest checkpoint (survives context compaction)
```

## Scripts

### probe-limits.js
```bash
node scripts/probe-limits.js --build-registry
node scripts/probe-limits.js --check-config-hash
node scripts/probe-limits.js --diff-config
node scripts/probe-limits.js --probe-all-providers
node scripts/probe-limits.js --probe-provider <id> [--live]
node scripts/probe-limits.js --compute-headroom <provider/model-id>
node scripts/probe-limits.js --update-state <json>
node scripts/probe-limits.js --prune-windows
node scripts/probe-limits.js --model-info <provider/model-id>
```

### task-manager.js
```bash
node scripts/task-manager.js --list-incomplete
node scripts/task-manager.js --status --agent <agentId>
node scripts/task-manager.js --all-status              # elevated only
node scripts/task-manager.js --create '<json>'
node scripts/task-manager.js --update-task <id> '<patch>'
node scripts/task-manager.js --update-subtask <id> <subId> '<patch>'
node scripts/task-manager.js --get <id>
node scripts/task-manager.js --archive <id>
node scripts/task-manager.js --extract-partial --transcript-path <path>
node scripts/task-manager.js --find-transcript <sessionId> [agentId]
node scripts/task-manager.js --write-checkpoint <id>
node scripts/task-manager.js --search <keywords>
node scripts/task-manager.js --rerun <id>
node scripts/task-manager.js --save-template '<json>'
node scripts/task-manager.js --list-templates
node scripts/task-manager.js --get-template <name|id>
node scripts/task-manager.js --estimate-tokens <text>
```

## Adding a New Provider

Add an entry to `scripts/provider-probes.json` for providers that expose a rate-limit API:

```json
{
  "providers": {
    "my-provider": {
      "displayName": "My Provider",
      "limitQueryMethod": "http_get",
      "url": "https://api.myprovider.com/usage",
      "authHeader": "Bearer",
      "apiKeyEnvHints": ["MY_PROVIDER_API_KEY"],
      "responsePaths": {
        "used": "data.requests_used",
        "limit": "data.requests_limit",
        "resetAt": "data.reset_at"
      },
      "knownTopology": "providerBucket"
    }
  }
}
```

For providers without a limits API, just skip the entry — Baton asks the user during onboarding.

## Security & Permissions

Baton requires elevated access to function. Before installing, understand what it does:

| What | Why | Safeguard |
|---|---|---|
| Reads `~/.openclaw/openclaw.json` | Discovers configured providers and models | Read-only; file is not modified |
| Reads `~/.openclaw/agents/*/agent/models.json` | Discovers per-agent model scopes | Read-only; file is not modified |
| Resolves API keys from env vars and config | Queries provider rate-limit APIs to check headroom | Keys used only for outbound HTTP; never written to stdout, logs, or state files |
| Runs Node.js scripts on startup | `probe-limits.js` and `task-manager.js` handle state management | Scripts are open source; review before installing |
| Spawns subagents | Core orchestration function | Uses OpenClaw's native `sessions_spawn`; respects `maxChildrenPerAgent` |

**On first run, Baton discloses these access requirements and asks for your confirmation before executing any scripts.** Consent is saved to `~/.openclaw/baton/consent.txt` so you are only asked once.

**API key handling:** API keys are resolved in-memory solely to make outbound HTTP requests to provider rate-limit APIs (e.g. checking remaining quota). The `sanitiseOutput()` function in `probe-limits.js` strips any key-like fields before writing to stdout. Keys are never stored in Baton's state files.

The `metadata.openclaw.requires.config` field declares `agents.defaults.subagents.maxSpawnDepth` as a required config entry, so OpenClaw can surface a clear error if Baton is loaded without the necessary orchestrator configuration rather than failing silently.



## Known Caveats

| Issue | Baton's workaround |
|-------|-------------------|
| `sessions_spawn` model override silently falls back for custom providers ([#7330](https://github.com/openclaw/openclaw/issues/7330), [#9771](https://github.com/openclaw/openclaw/issues/9771)) | Verifies actual model via `sessions_list` after every spawn; re-spawns with next candidate if wrong |
| No native session resume after restart ([#19780](https://github.com/openclaw/openclaw/issues/19780)) | All state in task files on disk; JSONL transcript read directly for partial work recovery |
| `mode: "session"` requires Discord ([#23414](https://github.com/openclaw/openclaw/issues/23414)) | Uses one-shot `mode: "run"` for compatibility with all channels |

### Baton-specific caveats

**`sessions_spawn` model override (custom providers)** — The open bugs above mean users may see unexpected model fallbacks and automatic re-spawns on first runs with custom providers. This resolves once model names are correctly configured in the allowlist. Monitor your agent's announce payloads if subagents seem to be running on the wrong model.

**Elevated privilege check for `--all-status`** — The check `openclaw agent status --json | grep '"elevated":true'` is a shell heuristic against the current OpenClaw status output format. If OpenClaw changes how elevated status is reported in a future release this check will need updating. If `--all-status` starts refusing incorrectly, verify the output of `openclaw agent status --json` and update the grep pattern in SKILL.md accordingly.

**Agent-scoped model discovery** — `buildRegistry()` scans `~/.openclaw/agents/*/agent/models.json` directly to find per-agent models. This relies on OpenClaw's agent directory layout remaining consistent across versions. If an upgrade changes where agent models are stored, re-run `--build-registry` and check the output for missing agent-scoped models.

**Session cleanup via `cleanup: "delete"`** — Baton sets `cleanup: "delete"` on every `sessions_spawn` call so subagent sessions are archived immediately after announcing. This relies on that parameter being honoured by your OpenClaw version. If sessions are not being cleaned up as expected, check that your OpenClaw version supports `cleanup: "delete"` in `sessions_spawn` (introduced in recent builds). As a fallback, OpenClaw's `archiveAfterMinutes` (default 60) will still clean up eventually.

**No guaranteed token count accuracy** — Token estimation uses a ~4 chars/token heuristic. Real tokenisation varies by model and content type. For tasks near a model's context window limit, the soft penalty thresholds (50% and 80%) may occasionally pass tasks that exceed the model's actual limit. If a subagent fails with a context length error, reduce `estimatedInputTokens` or choose a model with a larger context window.

## Requirements

- OpenClaw (any recent version)
- Node.js 18+
- `maxSpawnDepth: 2` in `openclaw.json`

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

*🎼 Baton is proudly provided to the OpenClaw community by [Entrebear](https://entrebear.com)*

</div>
