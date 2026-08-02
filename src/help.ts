import { createCliHelp as createCoreCliHelp, type CliHelp } from '@ismail-elkorchi/cli-core';
import { runtimeFor } from './definition.ts';
import type { Cli, CliDefinition } from './public-types.ts';

/** Creates renderer-neutral help from a compiled CLI. */
export function createCliHelp<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  commandPath: readonly string[] = []
): CliHelp | undefined {
  return createCoreCliHelp(runtimeFor(cli).program, commandPath);
}
