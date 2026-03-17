# Model Profiles — Fallback Reference

**Last-resort fallback only.** Priority: web search → user input → this file.
When used, set `capableSource: "inferred"`. No limit values here.

## Capability by Name Pattern

| Pattern in model ID | Capable | Speed |
|---|---|---|
| `embed` / `embedding` | (exclude) | — |
| `haiku`, `flash-lite`, `mini` (not `gemini`) | lookup, transform | very-fast |
| `flash` (not lite) | lookup, transform, code, agentic | very-fast |
| `sonnet`, `gpt-4o` (not mini) | all | fast |
| `opus`, `gemini-2.5-pro` | all | medium |
| `o3`/`o4` (not mini), `r1` (not mini) | reasoning, code | slow |
| `o3-mini`, `o4-mini`, `r1-mini` | reasoning, code, lookup | medium |
| `deepseek` | reasoning, code | medium |
| `sonar` / `perplexity` | lookup | fast |
| `llama`, `mistral`, `mixtral`, `qwen`, `gemma`, `phi` | all | fast |
| (no match) | all (general-purpose) | fast |

## Context Window Fallbacks

| Pattern | Tokens |
|---|---|
| `claude-*` | 200000 |
| `gpt-4o*` | 128000 |
| `o3*` / `o4*` | 200000 |
| `gemini-2*` | 1000000 |
| `llama-3*` | 128000 |
| `mistral*` / `mixtral*` | 32000 |
| `deepseek*` | 64000 |
| `qwen*` | 128000 |
| (no match) | 8192 |

## External Self-Hosted Defaults
Custom baseUrl → non-localhost, non-known-cloud: speed `medium`, unlimited `true`. Update after benchmark.
