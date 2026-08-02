# Changelog

## 0.1.0 - 2026-08-01

- Added one typed command definition for parsing, help, completion, and explicit
  execution using `cli-core` command semantics and `argv-flags` option grammar.
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
