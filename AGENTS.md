# AGENTS

- Keep this package focused on composing `cli-core` with `argv-flags` and on
  explicit process and shell adapters.
- Keep option grammar in `argv-flags` and command semantics in `cli-core`.
- Do not add configuration, plugins, effects, prompts, or terminal UI here.
- Keep default entrypoints free of module-evaluation `node:*` imports.
- Keep TypeScript strict and tests deterministic and offline across Node, Deno,
  and Bun.
- Run `npm run check` before declaring work complete.
