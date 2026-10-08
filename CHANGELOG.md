# Changelog

## Unreleased

- Use cli-core 0.4 command callbacks and shared unknown-flag policy, with lexical and semantic diagnostics contributed exactly once
- Upgrade argv-flags to published 4.0.0 with cross-copy custom default snapshots

- Compile option declarations once and share one scope-aware classification across routing, controls, inspection, completion, and decoding
- Preserve selected-command diagnostics on malformed input and leave uncertain suffixes unclassified
- Keep help/version controls outside the domain command model and avoid decoding values for control actions
- Support widened and mixed static/dynamic TypeScript definitions without unbounded recursion
- Await complete Node/Bun and Deno output delivery; keep output failures separate from handler failures
- Add application-owned outcome rendering hooks to the existing runner, replacing the narrower diagnostic formatter hook
- Validate sensitivity and omit automatic sensitive defaults and choices from help/completion
- Normalize shell editing state and insert completion candidates as literal arguments

## 0.2.0 - 2026-08-23

- Added `help`, `help <command>`, and no-argument help for non-invokable roots.
- Added immutable, grammar-aware argv inspection without partial decoded
  values, and made completion consume the same inspection path.
- Added renderer-neutral examples and rendered examples, required options,
  defaults, and finite choices in terminal help.
- Upgraded to `@ismail-elkorchi/cli-core` 0.3.0.
- Added dependency, workflow, CodeQL, and dependency-review gates and moved npm
  and JSR publication to GitHub Releases with OIDC.

## 0.1.1 - 2026-08-09

- Added grammar-aware `-h`/`--help` and configured `--version` parse actions.
- Added a safe terminal help formatter and automatic help/version handling in
  `runCliMain()`.
- Included the built-in actions in help and completion while keeping them out
  of typed application option values.

## 0.1.0 - 2026-08-09

- Added one typed command definition for parsing, validation, help, completion,
  programmatic invocation, and explicit execution.
- Added command-discriminated option and positional values plus exact,
  command-specific handler maps.
- Unified definition errors and runtime diagnostics while retaining exact
  locations, suggestions, unknown flags, deprecations, and source ownership.
- Routed and bound arguments from the same token scan, inherited ancestor
  options, and rejected ambiguous command/positional trees.
- Added default, false-flag, finite-value, repetition, and multiplicity metadata
  to help and grammar-aware option and positional completion.
- Added explicit Node/Bun and Deno process hosts plus Bash, Zsh, Fish, and
  PowerShell completion scripts with a dedicated completion executable and
  explicit cursor coordinates.
- Added offline packed-package consumers for Node, Deno, and Bun.
- Added root positionals, root passthrough arguments, non-invokable grouping
  commands, and typed structured invocation.
- Added asynchronous contextual value completion, opt-in passthrough
  completion, and a JSON-lines completion output that preserves metadata.
- Prevented raw option values, terminal controls, and unexpected handler error
  details from reaching default terminal output; successful deprecation
  warnings are now rendered by the main adapter.
- Definition compilation now rejects definition accessors, sparse containers,
  and command cycles, validates declarations at their origin, and avoids
  repeating inherited option issues without constraining structural value
  parsers to one object prototype.
- Added explicit value, implicit-value, and non-primitive default presentation
  labels.
- Kept required multiple options distinct from implicitly defaulted multiple
  options in public types and help metadata.
- Closed and safely snapshotted parse, structured-invocation, and completion
  inputs, and exposed completion positionals without command tokens.
- Restricted sensitive metadata to value-taking options and prevented their
  suggestions or Unicode terminal controls from leaking through the default
  diagnostic formatter.
