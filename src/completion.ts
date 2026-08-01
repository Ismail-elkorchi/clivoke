import { completeCli, findCliCommandForArgv, type CliCompletion } from '@ismail-elkorchi/cli-core';
import type { Cli, CliCompletionRequest, CliDefinition, CliShell } from './public-types.ts';

/** Returns completion candidates for shell words without invoking a shell. */
export function completeCliWords<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  request: CliCompletionRequest
): readonly CliCompletion[] {
  const completionCommand = request.completionCommand ?? '__complete';
  const words = dropProtocolPrefix(cli, request.words, completionCommand);
  const cursor = clampCursor(request.cursor ?? words.length, words.length);
  const currentWord = request.currentWord ?? (cursor > 0 ? words[cursor - 1] : undefined) ?? '';
  const committedEnd = words[cursor - 1] === currentWord ? cursor - 1 : cursor;
  const committed = words.slice(0, committedEnd);
  if (committed.includes('--')) return Object.freeze([]);
  const command = findCliCommandForArgv(cli.program, committed);
  return completeCli(cli.program, {
    commandPath: command.path,
    prefix: currentWord,
    includeHidden: request.includeHidden ?? false
  });
}

/** Generates a small script that delegates candidates to a hidden completion command. */
export function createCompletionScript<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  shell: CliShell,
  completionCommand = '__complete'
): string {
  const program = shellQuote(cli.program.name);
  const command = shellQuote(completionCommand);
  const identifier = shellIdentifier(cli.program.name);
  if (shell === 'fish') return `complete -c ${program} -f -a "(${program} ${command} (commandline -opc))"\n`;
  if (shell === 'pwsh') {
    return `Register-ArgumentCompleter -Native -CommandName ${powerShellQuote(cli.program.name)} -ScriptBlock {\n  param($wordToComplete, $commandAst, $cursorPosition)\n  & ${powerShellQuote(cli.program.name)} ${powerShellQuote(completionCommand)} @($commandAst.CommandElements | ForEach-Object { $_.Extent.Text })\n}\n`;
  }
  if (shell === 'zsh') {
    return `#compdef ${cli.program.name}\n_${identifier}() {\n  local output\n  output="$(${program} ${command} "$words[@]")"\n  local -a candidates\n  candidates=("\${(@f)output}")\n  compadd -- "\${candidates[@]}"\n}\ncompdef _${identifier} ${program}\n`;
  }
  return `_${identifier}() { COMPREPLY=( $(${program} ${command} "\${COMP_WORDS[@]}") ); }\ncomplete -F _${identifier} ${program}\n`;
}

function dropProtocolPrefix<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  input: readonly string[],
  completionCommand: string
): readonly string[] {
  let start = 0;
  if (input[start] === cli.program.name) start += 1;
  if (input[start] === completionCommand) start += 1;
  return input.slice(start);
}

function clampCursor(cursor: number, length: number): number {
  if (!Number.isFinite(cursor)) return length;
  return Math.max(0, Math.min(length, Math.trunc(cursor)));
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function shellIdentifier(value: string): string {
  const identifier = value.replaceAll(/[^A-Za-z0-9_]/gu, '_');
  return identifier.length === 0 ? 'cli' : identifier;
}
