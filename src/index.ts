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
 * if (result.status === "ready") console.log(result.optionValues.region);
 * ```
 */
export { completeCliWords, createCompletionScript } from './completion.ts';
export { createCli } from './definition.ts';
export { CliDefinitionError } from './definition-error.ts';
export { createCliHelp } from './help.ts';
export {
  createDenoCliHost,
  createProcessCliHost,
  formatCliDiagnostics,
  runCliCompletion,
  runCliMain
} from './main.ts';
export { value } from 'argv-flags';

export type {
  Cli,
  CliCommandDefinition,
  CliCompletion,
  CliCompletionContext,
  CliCompletionMainInput,
  CliCompletionPartialInvocation,
  CliCompletionProvider,
  CliCompletionRequest,
  CliDefinitionIssue,
  CliDiagnostic,
  CliDefinition,
  CliMainHandlers,
  CliMainHost,
  CliMainFailure,
  CliMainInput,
  CliMainOutput,
  CliOptionDefinition,
  CliOptionDefinitions,
  CliInvocationFailure,
  CliInvocationResult,
  CliInvocationSuccess,
  CliParseInput,
  CliPositionalDefinition,
  CliShell,
  CliStructuredInvocationInput,
  DenoLike,
  ProcessLike
} from './public-types.ts';
export type {
  CliHelp
} from '@ismail-elkorchi/cli-core';
