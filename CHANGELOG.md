# Changelog

All notable changes to Baton will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.6] — 2026-03-18

### Added
- `install.sh` now schedules a one-shot cron job (`cron.schedule` with `deleteAfterRun: true`) immediately after install, so the BOOT.md startup routine fires as soon as the gateway restarts — no manual first message needed
- `install.sh` now calls `openclaw restart` automatically at the end of install, so BOOT.md and AGENTS.md changes take effect immediately
- Both steps fail gracefully if the gateway is not running (BOOT.md handles first run on next manual restart)

## [1.0.5] — 2026-03-18

### Added
- `scripts/install.sh` — automated install script that handles all post-install steps in one command:
  - Prepends a hard "Baton Orchestrator" rule to `AGENTS.md` (injected by OpenClaw into every turn, preventing the agent from doing work itself)
  - Installs `BOOT.md` into the workspace with the correct skill path substituted, or appends to an existing BOOT.md
  - Creates Baton state directories
  - Builds the initial model registry
- AGENTS.md hard rule enforcement documented: OpenClaw injects AGENTS.md into context on every turn, making it the correct mechanism for hard behavioral constraints (not openclaw.json, which has no user-facing systemPrompt field)
- README installation section rewritten to lead with `install.sh` as the primary method

### Fixed
- Manual BOOT.md step replaced — install script handles path substitution automatically

## [1.0.4] — 2026-03-17

### Fixed
- Spawn instructions now explicitly state: omit agentId to spawn under the calling agent (OpenClaw default); only add agentId when subtask.targetAgent is explicitly set
- Planner rules in orchestration.md updated: targetAgent defaults to null (calling agent) and must never be set unless a specialist agent was explicitly nominated
- Spawn Rules section in orchestration.md replaces Session Cleanup section with clear two-case examples (default spawn vs targetAgent spawn)

## [1.0.3] — 2026-03-17

### Fixed
- Registry builder now correctly reads both model sources from openclaw.json:
  - `models.providers` — custom providers with full model metadata (baseUrl, contextWindow, cost)
  - `agents.defaults.models` and `agents.list[].models` — models using OpenClaw's auth system (OAuth profiles, API key rotation)
- `openclaw models list --json` is now non-fatal and used only to fill gaps; registry builds from config directly first
- Added `source` field to each registry entry tracking which config section it came from
- Fixed model ID construction for custom providers whose model IDs already contain a provider prefix



### Added
- BOOT.md workspace file: Baton startup routine now runs automatically on gateway restart via OpenClaw's BOOT.md hook, rather than relying on the first user message to trigger it
- SKILL.md startup section simplified — BOOT.md is now the canonical startup mechanism
- README installation step added for copying BOOT.md to the workspace



### Security
- Added first-run consent gate: Baton discloses config/env access and asks for user confirmation before running any startup scripts; consent saved to consent.txt
- Added `metadata.openclaw.requires.config` declaration so OpenClaw surfaces a clear error if required orchestrator config is missing rather than failing silently
- Added `metadata.openclaw.permissions` field documenting read:config, read:agents, exec:scripts, read:env access
- Added `sanitiseOutput()` to probe-limits.js: all stdout JSON is sanitised to redact any API key or secret fields before output
- API keys are now never written to stdout, stderr logs, or any Baton state file; they are resolved in-memory only for outbound HTTP requests to provider rate-limit APIs
- Added security disclosure header to probe-limits.js documenting data access behaviour
- Added Security & Permissions section to README with per-permission disclosure table



### Added
- Planner-first architecture: complex tasks decomposed by a reasoning-capable Planner subagent; primary agent executes mechanically from the returned plan
- Four specialised subagent roles: Planner, Validator, Corrector, Synthesiser — primary agent never does reasoning, validation, or synthesis itself
- Agent orchestrator: task decomposition with dependency graphs, parallel execution rounds, fan-in policies (all/any), priority queue with auto-boost
- Model router: 7-tier scoring with capability, speed, rate-limit headroom, context window, load, latency, and cost factors
- Agent-scoped model support: per-agent models.json respected alongside instance-wide openclaw.json models
- Rate-limit tracking: sliding window across all window types (rps/rpm/rph/rpd/rpw/rp_window)
- Multi-agent coordination: shared instance-state.json for cross-agent load visibility
- Resilience: task files survive gateway restarts; JSONL transcript recovery for dead sessions
- Three-attempt escalation: same model → stronger reasoning model → strongest available → user
- Idempotent retries with side-effect awareness
- Result validation: completeness, format, coherence, scope
- Output compression: verbatim/summarise/compress strategies based on context pressure
- Status command (agent-scoped) and all-status command (elevated privilege only)
- Dry-run mode (explicit user request only)
- Scheduled/recurring tasks via OpenClaw cron integration
- Budget caps with decomposition-time estimation and runtime enforcement
- Output persistence to ~/.openclaw/workspace/baton-outputs/
- Task history search and rerun
- Reusable task templates
- Inter-task context injection from past task outputs
- Onboarding flow: provider topology discovery, model capability/limit collection, agent policies
- Generic provider probe system (provider-probes.json, no hardcoded limits anywhere)
- All OpenClaw known bugs (#7330, #9771, #19780, #23414) detected and worked around
