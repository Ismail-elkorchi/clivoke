import { createCliHelp as createCoreCliHelp, type CliHelp } from '@ismail-elkorchi/cli-core';
import { runtimeFor } from './definition.ts';
import type { Cli, CliDefinition } from './public-types.ts';
import { sanitizeTerminalText } from './terminal.ts';

/** Creates renderer-neutral help from a compiled CLI. */
export function createCliHelp<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  commandPath: readonly string[] = []
): CliHelp | undefined {
  const runtime = runtimeFor(cli);
  const help = createCoreCliHelp(runtime.program, commandPath);
  if (help === undefined) return undefined;
  const prefix = [runtime.program.name, ...help.command.path].join(' ');
  const controls: CliHelp['options'] = Object.freeze(Object.entries(runtime.controls).map(([name, option]) =>
    Object.freeze({
      name, flags: option.flags, falseFlags: Object.freeze([]), valueMode: 'none' as const,
      required: false, multiple: false, repeat: 'error' as const, hasDefault: false,
      valueCandidates: Object.freeze([]), definedAt: Object.freeze([]),
      ...(option.description === undefined ? {} : { description: option.description })
    })));
  return Object.freeze({
    ...help,
    usage: help.options.length === 0 ? `${prefix} [options]${help.usage.slice(prefix.length)}` : help.usage,
    options: Object.freeze([
      ...help.options.filter((option) => option.definedAt.length === 0),
      ...controls,
      ...help.options.filter((option) => option.definedAt.length > 0)
    ])
  });
}

/** Formats renderer-neutral help as concise terminal text. */
export function formatCliHelp(help: CliHelp): string {
  const lines = [`Usage: ${sanitizeTerminalText(help.usage)}`];
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
        formatOptionDescription(option)
      ));
    }
  }
  if (help.examples.length > 0) {
    lines.push('', 'Examples:');
    for (const example of help.examples) {
      lines.push(formatEntry(example.usage, example.description));
    }
  }
  return lines.join('\n');
}

function formatOptionDescription(option: CliHelp['options'][number]): string | undefined {
  const facts = [
    option.required ? 'required' : undefined,
    option.defaultLabel === undefined ? undefined : `default: ${option.defaultLabel}`,
    option.valueCandidates.length === 0
      ? undefined
      : `choices: ${option.valueCandidates.join(', ')}`
  ].filter((fact): fact is string => fact !== undefined);
  const suffix = facts.length === 0 ? undefined : `[${facts.join('; ')}]`;
  return [option.description, suffix].filter((part): part is string => part !== undefined).join(' ') ||
    undefined;
}

function formatEntry(label: string, description: string | undefined): string {
  const safeLabel = sanitizeTerminalText(label);
  return description === undefined
    ? `  ${safeLabel}`
    : `  ${safeLabel}  ${sanitizeTerminalText(description)}`;
}
