# Task Classification Guide

## Primary Types

| Type | Signals |
|---|---|
| `lookup` | "what is", "find", "search", "check", "get", "list" |
| `transform` | "summarise", "reformat", "translate", "extract", "convert" |
| `code` | "write", "fix", "implement", "refactor", "debug", any code block |
| `reasoning` | "figure out", "solve", "calculate", "plan", "compare", "analyse" |
| `creative` | "write a", "draft", "brainstorm", "compose", "come up with" |
| `agentic` | "do", "build", "automate", "monitor", "run", any tool/browser/file task |

## Secondary Tags

| Tag | When | Effect on selection |
|---|---|---|
| `long-doc` | Input > 50K tokens | Require contextWindow ≥ 100K |
| `multimodal` | Image or audio input | Require multimodal model |

## Decomposition Decision

**Decompose** when: multiple phases, multiple domains, intermediate outputs, > 5 min estimated.
**Keep atomic** when: one output, one domain, no intermediate steps.
