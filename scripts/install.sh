#!/usr/bin/env bash
# Baton install script
# Run from the skill directory: bash scripts/install.sh

set -e

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="${OPENCLAW_WORKSPACE:-$HOME/.openclaw/workspace}"
AGENTS_MD="$WORKSPACE/AGENTS.md"
BOOT_MD="$WORKSPACE/BOOT.md"

echo "🎼 Baton installer"
echo "   Skill dir : $SKILL_DIR"
echo "   Workspace : $WORKSPACE"
echo ""

# ── 1. BOOT.md ──────────────────────────────────────────────────────────────
BOOT_CONTENT="$(sed "s|<baton-skill-path>|$SKILL_DIR|g" "$SKILL_DIR/BOOT.md")"

if [ ! -f "$BOOT_MD" ]; then
  echo "$BOOT_CONTENT" > "$BOOT_MD"
  echo "✅ Created $BOOT_MD"
else
  if grep -q "Baton Startup" "$BOOT_MD" 2>/dev/null; then
    echo "⏭️  BOOT.md already contains Baton section — skipping"
  else
    echo "" >> "$BOOT_MD"
    echo "$BOOT_CONTENT" >> "$BOOT_MD"
    echo "✅ Appended Baton startup to existing $BOOT_MD"
  fi
fi

# ── 2. AGENTS.md hard rule block ────────────────────────────────────────────
AGENTS_BLOCK="## Baton Orchestrator — HARD RULE
You are a Baton orchestrator. This is a non-negotiable operating constraint:
- You NEVER execute tasks yourself. Every task goes to a subagent via sessions_spawn.
- This applies to ALL tasks including simple ones. There are no exceptions.
- If you find yourself about to do work directly, stop and spawn a subagent instead.
- Simple tasks: plan yourself, spawn one worker. Complex tasks: spawn a Planner first.
- Read $SKILL_DIR/SKILL.md before handling any request if not already loaded this session.
See Baton skill for full orchestration rules."

if [ ! -f "$AGENTS_MD" ]; then
  echo "$AGENTS_BLOCK" > "$AGENTS_MD"
  echo "✅ Created $AGENTS_MD with Baton hard rule"
else
  if grep -q "Baton Orchestrator" "$AGENTS_MD" 2>/dev/null; then
    echo "⏭️  AGENTS.md already contains Baton hard rule — skipping"
  else
    # Prepend — hard rules must be at the top
    TMPFILE="$(mktemp)"
    echo "$AGENTS_BLOCK" > "$TMPFILE"
    echo "" >> "$TMPFILE"
    cat "$AGENTS_MD" >> "$TMPFILE"
    mv "$TMPFILE" "$AGENTS_MD"
    echo "✅ Prepended Baton hard rule to existing $AGENTS_MD"
  fi
fi

# ── 3. Create baton dirs ─────────────────────────────────────────────────────
mkdir -p \
  "$HOME/.openclaw/baton/tasks" \
  "$HOME/.openclaw/baton/archive" \
  "$HOME/.openclaw/baton/templates" \
  "$HOME/.openclaw/baton/checkpoints" \
  "$WORKSPACE/baton-outputs"
echo "✅ Created Baton state directories"

# ── 4. Build model registry ──────────────────────────────────────────────────
echo ""
echo "Building model registry..."
node "$SKILL_DIR/scripts/probe-limits.js" --build-registry
echo "✅ Model registry built"

# ── 5. Schedule one-shot boot cron job ───────────────────────────────────────
# BOOT.md only fires on gateway restart. We register a one-shot cron job that
# runs the Baton startup routine once at next gateway start, then removes itself.
# The job payload mirrors exactly what BOOT.md instructs, so the agent runs it
# as part of its normal session context.
#
# We try openclaw gateway call (requires gateway to be running). If the gateway
# is not running yet, we skip silently — the restart step below handles it via
# BOOT.md on next session start.

BOOT_JOB_PAYLOAD="{
  \"name\": \"baton-install-boot\",
  \"schedule\": { \"kind\": \"once\", \"runAt\": \"$(date -u -d '+10 seconds' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+10S '+%Y-%m-%dT%H:%M:%SZ')\" },
  \"sessionTarget\": \"isolated\",
  \"deleteAfterRun\": true,
  \"payload\": {
    \"kind\": \"agentTurn\",
    \"message\": \"Run the Baton startup routine now. Read $SKILL_DIR/BOOT.md and follow it exactly. This is the post-install first-run boot.\"
  }
}"

echo ""
echo "Scheduling one-shot boot job..."
if openclaw gateway call cron.schedule --params "$BOOT_JOB_PAYLOAD" 2>/dev/null; then
  echo "✅ One-shot boot job scheduled — will run within 10 seconds of gateway start"
else
  echo "⚠️  Gateway not running yet — BOOT.md will run automatically on first session after restart"
fi

# ── 6. Restart gateway ───────────────────────────────────────────────────────
echo ""
echo "Restarting gateway to apply BOOT.md and AGENTS.md changes..."
if openclaw restart 2>/dev/null; then
  echo "✅ Gateway restarted"
  echo ""
  echo "🎼 Baton is installing. The startup routine will run in your next session."
  echo "   Watch for a consent prompt and onboarding questions."
else
  echo "⚠️  Could not restart gateway automatically."
  echo "   Please run: openclaw restart"
  echo ""
  echo "🎼 Baton files installed. Restart the gateway to activate."
fi

