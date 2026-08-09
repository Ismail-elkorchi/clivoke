import { createCliHelp as createCoreCliHelp, type CliHelp } from '@ismail-elkorchi/cli-core';
import { runtimeFor } from './definition.ts';
import type { Cli, CliDefinition } from './public-types.ts';
import { sanitizeTerminalText } from './terminal.ts';

/** Creates renderer-neutral help from a compiled CLI. */
export function createCliHelp<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  commandPath: readonly string[] = []
): CliHelp | undefined {
  return createCoreCliHelp(runtimeFor(cli).program, commandPath);
}

/** Formats renderer-neutral help as concise terminal text. */
export function formatCliHelp(help: CliHelp): string {
  const lines = [`Usage: ${help.usage}`];
  if (help.command.description !== undefined) {
    lines.push('', sanitizeTerminalText(help.command.description));
  }
  if (help.commands.length > 0) {
    lines.push('', 'Commands:');
    for (const command of help.commands) {
      const aliases = command.aliases.length === 0
        ? ''
        : ` (${command.aliases.map((alias) => alias.name).join(', ')})`;
      lines.push(formatEntry(`${command.name}${aliases}`, command.description));
    }
  }
  if (help.positionals.length > 0) {
    lines.push('', 'Arguments:');
    for (const positional of help.positionals) {
      lines.push(formatEntry(positional.label, positional.description));
    }
  }
  if (help.options.length > 0) {
    lines.push('', 'Options:');
    for (const option of help.options) {
      const valueLabel = option.valueLabel ?? 'value';
      const value = option.valueMode === 'required'
        ? ` <${valueLabel}>`
        : option.valueMode === 'optional-inline'
          ? `[=${valueLabel}]`
          : '';
      lines.push(formatEntry(
        `${[...option.flags, ...option.falseFlags].join(', ')}${value}`,
        option.description
      ));
    }
  }
  return lines.join('\n');
}

function formatEntry(label: string, description: string | undefined): string {
  const safeLabel = sanitizeTerminalText(label);
  return description === undefined
    ? `  ${safeLabel}`
    : `  ${safeLabel}  ${sanitizeTerminalText(description)}`;
}
