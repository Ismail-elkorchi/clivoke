/**
 * Typed command definitions, argv parsing, help, completion, and explicit execution.
 *
 * @example
 * ```ts
 * import { createCli } from "clivoke";
 *
 * const cli = createCli({
 *   name: "ship",
 *   commands: [{
 *     name: "deploy",
 *     options: {
 *       region: { type: "string", flags: ["--region"], required: true }
 *     }
 *   }]
 * });
 *
 * const result = cli.parse({ argv: ["deploy", "--region", "eu"] });
 * if (result.status === "parsed") console.log(result.optionValues.region);
 * ```
 */
export { completeCliWords, createCompletionScript } from './completion.ts';
export { createCli } from './definition.ts';
export { createCliHelp } from './help.ts';
export {
  createDenoCliHost,
  createProcessCliHost,
  formatCliDiagnostics,
  runCliMain
} from './main.ts';
export { value } from 'argv-flags';
export { CliDefinitionError } from '@ismail-elkorchi/cli-core';

export type {
  Cli,
  CliCommandDefinition,
  CliCompletionRequest,
  CliDefinition,
  CliMainHandler,
  CliMainHandlerContext,
  CliMainHandlers,
  CliMainHost,
  CliMainInput,
  CliMainOutput,
  CliOptionDefinition,
  CliOptionDefinitions,
  CliParsedInvocation,
  CliParsedInvocationSuccess,
  CliParsedValues,
  CliParseInput,
  CliPositionalDefinition,
  CliShell,
  CliSpecifiedOptions,
  DenoLike,
  ProcessLike
} from './public-types.ts';
export type {
  CliCompletion,
  CliDiagnostic,
  CliHelp
} from '@ismail-elkorchi/cli-core';
