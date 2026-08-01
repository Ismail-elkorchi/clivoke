# Changelog

## 0.2.0 - 2026-08-01

- Unified command routing and final option parsing on `argv-flags` token scans,
  eliminating the second partial option grammar.
- Added command-discriminated option and positional values plus exact,
  command-specific handler maps.
- Unified definition errors and runtime diagnostics while retaining exact
  locations, suggestions, unknown flags, deprecations, and source ownership.
- Inherited ancestor options, rejected ambiguous command/positional trees, and
  made pre-command local options fail consistently.
- Added default, false-flag, finite-value, repetition, and multiplicity metadata
  to help and grammar-aware option and positional value completion.
- Replaced the reserved `__complete` command protocol with a dedicated
  completion executable and explicit cursor coordinates.
- Removed the inert `version` definition field.

## 0.1.0 - 2026-08-01

- Added one typed command definition for parsing, help, completion, and explicit
  execution, backed by focused command and argv components.
- Added inferred option values, closed definitions, structured failures without
  partial values, and exact unknown-flag locations.
- Supported global flags before command tokens without losing original argv
  indexes.
- Reused command routing for incomplete completion input and core dispatch for
  process handlers instead of maintaining integration-specific copies.
- Added explicit Node/Bun and Deno process hosts plus Bash, Zsh, Fish, and
  PowerShell completion scripts without filesystem or profile mutation.
- Added offline packed-package consumers for Node, Deno, and Bun.
