# Agent runtime

Generic server-side AI gateway. Application code imports this package, including `tool`, `z`, schema helpers and chat types; React consumers use `@optimax-starter/agent/react`. Only this package imports `ai`.

`createAgent({ env, config, isCircuitOpen, audit })` owns one bounded FIFO queue and one provider connection pool. Reuse it for the process (or per saved configuration revision), then `close()` on shutdown. The actor limit includes active and queued requests. Circuit state is checked before admission and again after queueing. One deadline covers queueing and every retry/chat step. Audit callbacks receive actor, model, elapsed time and stable error codes only, never prompts, messages, tool inputs or credentials. Applications own the callback's persistence and transport health.

`generateStructured({ gateway, schema, system, prompt, actor, signal })` accepts one result schema per invocation. Channels are JSON schema, JSON object, or a forced `submit` call. Generation is deterministic, SDK retries are disabled, fences/syntax are repaired locally, and validation gets at most one feedback retry. Empty and length-truncated output fail immediately. Results are `{ ok: true, data, usage, attempts, model }` or `{ ok: false, code, reason, attempts }`. Verify citations against source excerpts before trusting scores; `verifyCitations` clears the score when no quote survives.

`createChatHandler({ gateway, tools, system, maxSteps: 10 })` returns a handler for authenticated `{ actor, messages, signal }` and produces a UI message SSE `Response`. `tool({ needsApproval: true, ... })` pauses for SDK approval messages. Authentication, authorization and approval ownership belong to the calling application. Chat bodies are not stored here. `stopWhen: stepCountIs(maxSteps)` bounds execution; all steps share one deadline. The last allowed step disables tools and requests a conclusion. The handler can do this earlier after two consecutive rounds without new tool results or when the remaining time cannot cover another lookup at the slowest observed round duration plus one third of the original time budget for the conclusion. Audit and stream metadata include the configured round limit and the trigger for a forced conclusion. The stream suppresses DSML tool markup in assistant output. When the terminal response contains it, one extra generation can summarize the evidence already collected within the same deadline. That generation has no tools or SDK retries. An unusable summary yields an explicit no-conclusion message.

Callers can supply `conclusionInstructions` and `retryInstructions` to tailor the two conclusion prompts. The Starter server loads them from its [assistant Skill](../../apps/server/src/agent/skills/assistant/SKILL.md).

## Configuration

See [.env.example](./.env.example). Missing/invalid configuration never aborts boot; `getAiConfigStatus()` exposes only `disabled`, `invalid` or `enabled`. Files must be regular, nonempty, at most 4096 bytes and not world-writable; symlinks are rejected. CA files must contain valid X.509 PEM. Redirects are rejected.

Both Starter names and the original aliases are accepted (Starter name wins):

| Starter                       | Alias                              |
| ----------------------------- | ---------------------------------- |
| `STARTER_AI_ALLOW_HTTP_HOSTS` | `STARTER_AI_HTTP_HOSTS`            |
| `STARTER_AI_CONCURRENCY`      | `STARTER_AI_MAX_CONCURRENCY`       |
| `STARTER_AI_ACTOR_LIMIT`      | `STARTER_AI_PER_ACTOR_CONCURRENCY` |
| `STARTER_AI_QUEUE_WAIT_MS`    | `STARTER_AI_QUEUE_TIMEOUT_MS`      |

Plain HTTP is accepted for loopback and for hosts in the allowlist. When `NODE_ENV=production`, plain HTTP requires an explicit allowlist entry, loopback included.

## Provenance

The installed SDK contract is AI `7.0.173` / compatible provider `3.0.92` / Anthropic provider `4.0.105` / React `4.0.177`. Middleware uses the v4 model protocol. `generateObject` is supported but deprecated in this version. The queue's attribution is recorded in [magpie-sources.json](../../third_party/magpie-sources.json) and the [MIT license](../../third_party/licenses/magpie-MIT.txt).
