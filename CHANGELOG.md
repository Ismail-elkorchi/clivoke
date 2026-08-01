# Changelog

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
