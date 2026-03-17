# Baton Startup

Run the Baton startup routine on every gateway restart:

1. Check if `~/.openclaw/baton/` exists. If not, this is first install — run:
   `mkdir -p ~/.openclaw/baton/{tasks,archive,templates,checkpoints} ~/.openclaw/workspace/baton-outputs`
   Then run `node <baton-skill-path>/scripts/probe-limits.js --build-registry`
   Then begin Baton onboarding as described in the baton skill (references/onboarding-guide.md).

2. Check `~/.openclaw/baton/consent.txt`. If it does not exist, disclose to the user:
   "Baton reads your openclaw.json provider config (including API key references), scans agent models.json files, and runs helper scripts on startup. API keys are used only to query provider rate-limit APIs and are never logged or stored. Proceed? (yes/no)"
   If yes, write consent.txt and continue. If no, stop — do not run any Baton scripts.

3. Run startup checks:
   `node <baton-skill-path>/scripts/probe-limits.js --check-config-hash`
   `node <baton-skill-path>/scripts/task-manager.js --list-incomplete`
   `date -u +%Y-%m-%dT%H:%M:%SZ > ~/.openclaw/baton/gateway-alive.txt`

4. If config hash changed: run onboarding for new/changed providers and models only.

5. If incomplete tasks found: notify the user and resume them.

Replace `<baton-skill-path>` with the actual installed path of the baton skill,
e.g. `~/.openclaw/skills/baton` or `<workspace>/skills/baton`.

Reply NO_REPLY when done unless there is something to tell the user (incomplete tasks, onboarding needed, consent required).
