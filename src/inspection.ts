import { runtimeFor } from './definition.ts';
import type {
  Cli,
  CliArgvInspection,
  CliDefinition
} from './public-types.ts';

/** Classifies raw argv with the CLI's actual grammar without decoding values. */
export function inspectCliArgv<Definition extends CliDefinition>(
  cli: Cli<Definition>,
  input: readonly string[]
): CliArgvInspection {
  return runtimeFor(cli).inspect(input);
}
