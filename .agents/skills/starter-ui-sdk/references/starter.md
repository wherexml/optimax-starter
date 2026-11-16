# Starter integration

Resolve project paths below from the repository root; Markdown links are relative to this reference. Read only the row and sections needed for the task. The skill is development guidance; installed `@ui-sdk/*` packages provide runtime behavior.

## Choose the task

| Task | Start here | Decision |
| --- | --- | --- |
| Ordinary form/table/dialog | [FRONTEND](../../../../FRONTEND.md), `apps/web/src/components/{ui,table,filters,crud}/` | Reuse the existing component and business validation. Do not migrate a working shared component solely because UI SDK is installed. |
| UI SDK control or missing behavior | Installed `docs/llms.txt` → matching `docs/components/*.md`; then [build-interface](build-interface.md) or [create-component](create-component.md) | Compose shipped parts first; create a primitive only for behavior the SDK does not provide. |
| New page or Tab view | [DESIGN navigation](../../../../DESIGN.md#页内导航与标签), [FRONTEND routing](../../../../FRONTEND.md#6-路由规范), [navigation demo](../../../../apps/web/src/features/navigation-demo/README.md) | Implement the page, route, URL validation and navigation together. UI SDK supplies behavior, not visual design. |
| Agent controls an existing form/filter | [asset module](../../../../apps/web/src/features/assets/README.md), [agent-ready](agent-ready.md) | Adapt existing state/actions with a validated primitive and scoped bridge; preserve manual controls and draft guards. |
| Visual or copy-only change | [DESIGN](../../../../DESIGN.md), [FRONTEND](../../../../FRONTEND.md) | Preserve the existing behavior. Sidebar styling and page-level Tab styling are separate scopes. |
| Runtime/backend/API work | [BACKEND](../../../../BACKEND.md), [API conventions](../../../../API_CONVENTIONS.md), [AUTH](../../../../AUTH.md) | SDK actions never replace server authorization, data contracts or audit. |

## Read the installed API

1. Inspect `apps/web/package.json` and the installed packages. At integration time (2026-11-16), React and Core both use `0.1.0-beta.3`; verify the current version before changing code. Do not upgrade dependencies as a side effect of reading this skill.
2. Read `apps/web/node_modules/@ui-sdk/react/docs/llms.txt`, then only the required component guide. For custom primitives, search `docs/core.md` by heading and read `docs/rendering.md`. Do not inspect or modify compiled `dist/*.js`.
3. If host dependencies are absent but the existing local web container is running, read the same installed documentation there:

```sh
docker compose exec -T web cat /app/apps/web/node_modules/@ui-sdk/react/docs/llms.txt
```

Use [PROJECT](../../../../PROJECT.md) / [README](../../../../README.md) for dependency and service setup when neither copy exists. Do not silently substitute the latest online API for a different installed version.

## Connect the page and navigation

- Keep route files thin under `apps/web/src/routes/`; implement the page under `features/`. Register URL state through `validateSearch` with stable, allowlisted values. Never edit the generated `routeTree.gen.ts`.
- Add a new navigation destination to `NavTarget` and `NAV_REGISTRY` in [app-config.ts](../../../../apps/web/src/config/app-config.ts). The sidebar, mobile drawer and QuickNav consume this registry; use its role/demo flags instead of maintaining separate lists.
- The sidebar has at most two levels. Third-level views belong in the content area's top Tabs. Preserve the Starter sidebar; apply the World Model underline style only to the page Tabs, as specified in DESIGN.
- Persist meaningful selection/filter state in the existing URL/store contract. A controlled SDK component updates its local value synchronously, then navigates; synchronize back on URL changes. Preserve existing pending edits, refresh behavior and back/forward navigation.
- New administrative views retain the app shell's access behavior and server checks. Hiding a menu or Tab is presentation, not authorization.

## Connect an agent only when needed

- Give controls and choices meaningful names. Use UI SDK parts for the new agent-operated interface; for existing Radix controls, adapt the business state via a custom primitive instead of presenting a snapshot the agent cannot actually change.
- `features/assets/filter-primitive.ts` and `AssetFilterScope.tsx` demonstrate strict `setValue` validation and controlled state. `features/assets/agent-bridge.ts` demonstrates an action allowlist. `features/navigation-demo/agent-bridge.ts` demonstrates a Tabs-only bridge.
- Check business conditions in SDK change callbacks or validated actions, including agent-originated changes. Manual draft, stale page, cancellation and unmount guards must still apply. Do not rely only on DOM click/keyboard listeners.
- After `agent.act`, verify the actual applied state and data; `ok: true` alone is insufficient. Agent calls must reach the same query/mutation boundary and validation as manual operations.
- Keep passwords/tokens out of snapshots and logs. Mark sensitive regions appropriately; preserve password-manager behavior on login/password fields. Search-field ignore markers remain local to those fields.
- Keep the existing model pilot optional and project-configured. This skill does not enable Magpie, register WebMCP, add credentials, authorize a write or change an upstream gateway. Read the asset module only when the task actually needs its pilot.

## Verify and disclose

- Use the project checks in [TESTING](../../../../TESTING.md). For code changes, run `bun run --filter web check-types` (Vite build + actual web TypeScript check), then browser E2E for the changed behavior.
- For a new SDK interface, discover named controls/items with `snapshot` or `query`, execute relevant actions from those discovered choices, and verify the resulting URL/DOM/data. Also exercise the human keyboard/focus path and affected desktop/mobile states.
- Reusable examples: [navigation-demo.mjs](../../../../scripts/e2e/navigation-demo.mjs), [asset-agent.mjs](../../../../scripts/e2e/asset-agent.mjs), [filter-state.mjs](../../../../scripts/e2e/filter-state.mjs). Choose relevant scenarios; do not call a real model unless the task requires and authorizes that path.
- Save fresh screenshots and the corresponding URLs for product E2E. Report commands and exit codes, observed results and material limits. Pure skill/document changes need format/link checks and must not be called product E2E.
- Project rules prefer E2E and prohibit writing unit tests after implementation. The upstream `testing.md` and `agent-ready.md` unit-test examples explain SDK behavior; adapt the proof to the real browser rather than installing another test stack by default.

## Portability and sources

This folder contains the adapted upstream skill, its focused references and [Apache-2.0 license](../LICENSE). The adaptation changes the skill name, adds Starter routing and follows the project's testing policy. It does not vendor the SDK's full API documentation, which ships with the pinned dependency.

Copy `.agents/skills/starter-ui-sdk/` with the repository/template; there is no dependency on a personal global skill path. Codex repository discovery and implicit invocation follow [OpenAI's skill documentation](https://learn.chatgpt.com/docs/build-skills). `CLAUDE.md` points to AGENTS for shared instructions; native discovery in another client is that client's configuration, not changed here.
