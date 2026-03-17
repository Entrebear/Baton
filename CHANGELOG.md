# Changelog

All notable changes to Baton will be documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-03-17

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
