---
name: starter-ui-sdk
description: Build or change frontend interactions and agent-operable UI in OptiMax Starter using UI SDK. Apply for UI SDK components, keyboard/focus behavior, custom primitives, natural-language actions, and related page/Tab routing. For pure styling or backend-only work, use the project design/backend guides.
license: Apache-2.0
metadata:
  upstream: "https://github.com/vercel-labs/ui"
  upstream-skill: "ui-sdk"
  adapted-on: "2026-11-16"
  upstream-skill-sha256: "bbcb19f944023dd8f36f895378852c325b811ced38fdd7dae234825c3d9c858a"
---

# UI SDK for OptiMax Starter

## Starter adaptation (2026-11-26)

This is the repo-scoped adaptation of Vercel's `ui-sdk` skill. The upstream references and Apache-2.0 license are retained. Use `$starter-ui-sdk` for this project; a global `ui-sdk` skill may also appear and is not merged with this one.

- First choose the matching task in [Starter integration](references/starter.md). It maps components, new routes, URL state, agent actions and verification to the actual project files.
- Prefer `@ui-sdk/react` and `@optimax-starter/ui` shared wrappers (`packages/ui/src/components/{tooltip,dropdown-menu,segmented-control,switch,slider,resizable,alert-dialog,page-tabs}.tsx`) rather than adding a third headless UI library (`@base-ui/react` has been removed).
- Installed React docs live under `apps/web/node_modules/@ui-sdk/react/docs/`. Read `llms.txt` and the relevant component page, not a newer website API. If dependencies are available only in Docker, use the existing web container as explained in the integration reference.
- Use browser E2E for project behavior. The upstream framework-unit-test examples are reference material; do not add Vitest/jsdom or write unit tests after implementation. Test necessary isolated behavior before implementation, per AGENTS.md.
- Keep the current runtime and design boundaries. Loading this skill grants no model, WebMCP, account, deployment or business-write authority.


ui-sdk is a library of UI behaviors: keyboard navigation, focus, selection, dismissal, popups, drag and drop and the ARIA they need. Its components are built from those behaviors and render no styles of their own, in React, Vue, Svelte, Solid and web components. `@ui-sdk/core/web.css` gives them an optional default look. When a component is missing, you build it from the same behaviors in `@ui-sdk/core`, and it gets the same keyboard, focus, server rendering and right to left support.

## Read first

The docs for the installed version ship in each package, as Markdown:

- `node_modules/@ui-sdk/<framework>/docs/llms.txt` is the index. Read it first. `<framework>` is `react`, `vue`, `svelte`, `solid` or `web`.
- Then read only the pages your task needs, like `docs/components/select.md`. Don't read the whole `docs/` folder; it's large.
- An interface built from our components doesn't need `docs/core.md`. Only path 2 below does, and even then you search it by heading: it's over 300 KB. `docs/rendering.md` sits next to it in the same `docs/` folder.
- Don't read compiled JavaScript in `dist/*.js`, even to debug. The docs and the `.d.ts` types are the API; when they don't answer, write a small test that tries it.

The same docs are online at https://ui-sdk.dev/docs. Prefer the installed copy: it matches the version in the project.

A page with no build step, like an Artifact, installs nothing: it loads `https://ui-sdk.dev/web.js` and `web.css` with two tags. Read https://ui-sdk.dev/web.md instead of `llms.txt`. It's the web components docs in one file, for that page, and [references/web-components.md](references/web-components.md#without-a-bundler) has the rest.

Otherwise, if no `@ui-sdk` package is installed yet, install `@ui-sdk/core` and the framework's package with the project's package manager.

## Pick your path

1. **Build an interface from our components**, like a settings page, a form or a command palette: read [references/build-interface.md](references/build-interface.md).
2. **Build a component or behavior ui-sdk doesn't ship**, or extend one of ours: read [references/create-component.md](references/create-component.md).

Most interfaces only need path 1. When one part of it needs a component we don't have, follow path 2 for that part.

Every path ends the same way:

3. **Make it agent-ready**: [references/agent-ready.md](references/agent-ready.md).
4. **Test it**: [references/testing.md](references/testing.md).

## Rules for every path

- **Import from entries.** Each component has its own entry, like `@ui-sdk/react/select`. There's no root import from a framework package. Never import `@ui-sdk/core/internal/*`.
- **One shape everywhere.** A root and its parts, nested as the component page's Composition shows. Change a part's element with `render`, never an `as` prop.
- **Default or controlled.** `defaultValue` to start, or `value` with `onValueChange(value, details)` to control it (each framework's idiom: `v-model` in Vue, `bind:value` in Svelte, properties and events in web components). `details` has `reason`, `source` and `cancel()`.
- **Name every control.** Use the component's label part (`FieldLabel`, `SelectLabel`, `DialogTitle`), or `aria-label` when there's no visible text. People using screen readers and agents both find controls by name.
- **Style from state.** Target `data-slot` and state attributes like `data-open` or `data-pressed`, and the CSS variables each component lists. Never inline styles for state, and never generated ids. When the app uses `web.css`, read [references/styles.md](references/styles.md) first: it draws icons and sets sizes you can't see in the markup.
- **Declare the ui-sdk layer.** Put `@layer ui-sdk;` at the top of the global stylesheet, above `@import "tailwindcss"` if there is one.
- **Check color.** Text needs 4.5:1 against what's behind it, and control edges, focus rings and state fills 3:1. jsdom can't see color, so check it in a real browser.
- **Key lists by value or id**, never by index.
- **Right to left needs no provider.** Components read the direction from the page.
- **Comments are rare.** Write one only when a reader would get the code wrong without it, like a browser quirk or a trade-off, in one or two lines. Never comment what the code does, what a value is, or which section starts here, and no JSDoc blocks on app code.
- **Don't hand-roll what we ship.** Before you write any `role=` attribute, look for the component in the table in [references/build-interface.md](references/build-interface.md). A `div` with `role="listbox"`, `"menu"`, `"dialog"`, `"tablist"`, `"separator"`, `"switch"`, `"slider"`, `"radiogroup"`, `"toolbar"` or `"tree"` next to an installed ui-sdk package is almost always a bug.

## When you're done

1. **Typecheck.** If the root `tsconfig.json` has `"files": []` and `references`, `npx tsc --noEmit` checks nothing: run `npx tsc -b` or `npx tsc --noEmit -p <app config>`. For Svelte, run `svelte-check`; for Vue, `vue-tsc`.
2. **Verify the changed behavior with browser E2E.** For an agent-ready interface, discover its controls and choices with the bridge, act on those choices, then verify the real URL/data/DOM. Save product screenshots with their URLs. Documentation-only changes need static checks; follow the project rules before adding any isolated test.
3. **Read every comment in your diff.** Delete it unless it names a browser quirk, an APG rule or a trade-off, and cut what's left to two lines. Turn JSDoc on app code into a plain comment or delete it. Never tell the reader to replace something.
4. **Report** each command you ran with its exit code, anything you couldn't check, and anything the docs or types got wrong or left out.
