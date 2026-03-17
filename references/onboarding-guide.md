# Onboarding Guide

Full conversation script for provider and model limit/capability onboarding.
Run when: first install, new provider detected, new model detected, model missing capability data.
Work through all new providers first (one at a time), then their models.

---

## Provider Onboarding

### Step 1 — Auto-probe
```bash
node {baseDir}/scripts/probe-limits.js --probe-provider <id>
```
- `autoDetected: true, topology: "unlimited"` → save, skip to next provider
- `autoDetected: true, dynamicQuery: true` → save, move to model questions
- `autoDetected: false` → Step 2

### Step 2 — Topology question
> "New provider **[id]** detected. Which describes its rate limiting?
> 1. Unlimited (local or self-hosted — no limits)
> 2. Shared limit — one bucket all models share (e.g. '40 requests/minute total')
> 3. Per-model — each model has its own independent limit
> 4. Mixed — a default limit for most models, but some are exempt or have their own"

### Step 3 — If shared or mixed
> "What is the limit and time window? e.g. '40 per minute', '1000 per day', '200 per 5 hours', '10 per second'"

Parse into: `{ "limit": N, "window": { "kind": "rps|rpm|rph|rpd|rpw|rp_window", "value": 1, "hours": null } }`

### Step 4 — Save to limit-config.json

```json
{
  "version": 2,
  "updatedAt": "ISO",
  "providers": {
    "<provider-id>": {
      "topology": "unlimited|providerBucket|perModel|mixed",
      "autoDetected": false,
      "bucket": {
        "limit": "<user-supplied>",
        "window": { "kind": "rpm", "value": 1 },
        "unlimited": false,
        "dynamicQuery": false
      },
      "models": {
        "<model-id>": {
          "override": "inherit|own|unlimited",
          "bucket": { "limit": "<user-supplied>", "window": { "kind": "rpd", "value": 1 } }
        }
      }
    }
  }
}
```

---

## Model Onboarding

### Step 1 — Limits (if provider is perModel or mixed)
> "Does **[model-id]** use the provider's shared limit, have its own limit, or is it unlimited?"
If own: ask for limit and window.

### Step 2 — Capability discovery
```bash
node {baseDir}/scripts/probe-limits.js --model-info <provider/model-id>
```
Run web search with returned `searchQuery`. Extract: best use cases, poor use cases, speed, context window, reasoning model?, multimodal?, tool use support?
Map to tags: `lookup | transform | code | reasoning | creative | agentic`. Set `capableSource: "web"`.

If web search fails:
> "What is **[model-id]** best used for? What's it bad at? Would you call it fast, medium, or slow?"
Set `capableSource: "user"`.

### Step 3 — Context window (if missing from registry)
> "Do you know the context window for **[model-id]**? e.g. '128K', '200K', '1M tokens'"

### Step 4 — Cost (optional)
> "Do you know the cost? e.g. '$0.25 per million input tokens, $1.25 per million output'. Type 'skip' if not relevant."

---

## Agent Policy Collection (end of onboarding)

> "Any models to disable, restrict to certain task types, or keep for specific agents only?"

```json
{
  "version": 1,
  "updatedAt": "ISO",
  "models": {
    "<provider/model-id>": {
      "policy": "enabled|disabled|task-restricted|agent-restricted",
      "allowedTasks": ["code","reasoning"],
      "excludedAgents": [],
      "allowedAgents": [],
      "notes": ""
    }
  },
  "agents": {
    "<agentId>": {
      "excludeModels": [],
      "preferModels": [],
      "costAware": true,
      "notes": ""
    }
  }
}
```
