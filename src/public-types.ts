import type {
  CliAliasInput,
  CliDiagnostic,
  CliHandler,
  CliHandlerContext,
  CliHandlers,
  CliProgram,
  ParsedInvocationFailure,
  ParsedInvocationSuccess
} from '@ismail-elkorchi/cli-core';
import type {
  BooleanOptionDefinition,
  CountOptionDefinition,
  MultipleValueOptionDefinition,
  ScalarValueOptionDefinition,
  ValueOf,
  ValueType
} from 'argv-flags';

interface OptionPresentation {
  readonly description?: string;
  readonly hidden?: boolean;
}

/** One scalar value-taking option. */
export type CliScalarOptionDefinition<Type extends ValueType> = ScalarValueOptionDefinition<Type> &
  OptionPresentation & {
    readonly valueLabel?: string;
  };

/** One accumulating value-taking option. */
export type CliMultipleOptionDefinition<Type extends ValueType> = MultipleValueOptionDefinition<Type> &
  OptionPresentation & {
    readonly valueLabel?: string;
  };

/** One boolean option with optional explicit false spellings. */
export type CliBooleanOptionDefinition = BooleanOptionDefinition & OptionPresentation;

/** One occurrence-counting option. */
export type CliCountOptionDefinition = CountOptionDefinition & OptionPresentation;

type CliValueOptionDefinition<Type extends ValueType> = Type extends ValueType
  ? CliScalarOptionDefinition<Type> | CliMultipleOptionDefinition<Type>
  : never;

/** Option definition accepted by the CLI. */
export type CliOptionDefinition =
  | CliValueOptionDefinition<ValueType>
  | CliBooleanOptionDefinition
  | CliCountOptionDefinition;

/** Logical option definitions keyed by their parsed value names. */
export type CliOptionDefinitions = Readonly<Record<string, CliOptionDefinition>>;

/** One positional argument. */
export interface CliPositionalDefinition {
  readonly name: string;
  readonly required?: boolean;
  readonly variadic?: boolean;
  readonly description?: string;
}

/** One command in the facade definition tree. */
export interface CliCommandDefinition {
  readonly name: string;
  readonly aliases?: readonly CliAliasInput[];
  readonly description?: string;
  readonly deprecated?: boolean | string;
  readonly options?: CliOptionDefinitions;
  readonly positionals?: readonly CliPositionalDefinition[];
  readonly commands?: readonly CliCommandDefinition[];
  readonly acceptsAfterDoubleDash?: boolean;
}

/** A complete typed CLI definition. */
export interface CliDefinition {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly options?: CliOptionDefinitions;
  readonly commands?: readonly CliCommandDefinition[];
}

type OptionValue<Definition> = Definition extends { readonly type: 'boolean' }
  ? boolean
  : Definition extends { readonly type: 'count' }
    ? number
    : Definition extends { readonly type: infer Type }
      ? Type extends ValueType
        ? Definition extends { readonly multiple: true }
          ? readonly ValueOf<Type>[]
          : ValueOf<Type>
        : never
      : never;

type GuaranteedName<Options extends CliOptionDefinitions> = {
  [Name in keyof Options]-?: Options[Name] extends { readonly type: 'count' }
    ? Name
    : Options[Name] extends { readonly multiple: true }
      ? Name
      : Options[Name] extends { readonly required: true }
        ? Name
        : Options[Name] extends { readonly default: unknown }
          ? Name
          : never;
}[keyof Options];

type ParsedGlobalValues<Options extends CliOptionDefinitions> = {
  readonly [Name in GuaranteedName<Options>]-?: OptionValue<Options[Name]>;
} & {
  readonly [Name in Exclude<keyof Options, GuaranteedName<Options>>]?: OptionValue<Options[Name]>;
};

type CommandsOf<Definition> = Definition extends { readonly commands?: infer Commands }
  ? NonNullable<Commands> extends readonly CliCommandDefinition[]
    ? NonNullable<Commands>[number]
    : never
  : never;

type NestedCommands<Command> = Command extends { readonly commands?: infer Commands }
  ? NonNullable<Commands> extends readonly CliCommandDefinition[]
    ? NonNullable<Commands>[number] | NestedCommands<NonNullable<Commands>[number]>
    : never
  : never;

type EveryCommand<Definition> = CommandsOf<Definition> | NestedCommands<CommandsOf<Definition>>;

type LocalOptions<Definition> = EveryCommand<Definition> extends infer Command
  ? Command extends { readonly options?: infer Options }
    ? NonNullable<Options> extends CliOptionDefinitions
      ? NonNullable<Options>
      : never
    : never
  : never;

type LocalOptionNames<Definition> = LocalOptions<Definition> extends infer Options
  ? Options extends CliOptionDefinitions
    ? keyof Options
    : never
  : never;

type LocalOptionForName<Definition, Name extends PropertyKey> = LocalOptions<Definition> extends infer Options
  ? Options extends CliOptionDefinitions
    ? Name extends keyof Options
      ? Options[Name]
      : never
    : never
  : never;

type GlobalOptions<Definition> = Definition extends { readonly options?: infer Options }
  ? NonNullable<Options> extends CliOptionDefinitions
    ? NonNullable<Options>
    : Readonly<Record<never, never>>
  : Readonly<Record<never, never>>;

/** Typed values returned after successful parsing. Command-local values are optional until the command is narrowed. */
export type CliParsedValues<Definition> = ParsedGlobalValues<GlobalOptions<Definition>> & {
  readonly [Name in LocalOptionNames<Definition>]?: OptionValue<LocalOptionForName<Definition, Name>>;
};

/** Presence map for every logical option in a definition tree. */
export type CliSpecifiedOptions<Definition> = {
  readonly [Name in keyof GlobalOptions<Definition>]: boolean;
} & {
  readonly [Name in Exclude<LocalOptionNames<Definition>, keyof GlobalOptions<Definition>>]?: boolean;
};

/** Successful CLI parse with typed option values. */
export type CliParsedInvocationSuccess<Definition> = Omit<
  ParsedInvocationSuccess,
  'optionValues' | 'specifiedOptions'
> & {
  readonly optionValues: CliParsedValues<Definition>;
  readonly specifiedOptions: CliSpecifiedOptions<Definition>;
};

/** CLI parse result. */
export type CliParsedInvocation<Definition> = CliParsedInvocationSuccess<Definition> | ParsedInvocationFailure;

/** A compiled CLI. */
export interface Cli<Definition extends CliDefinition = CliDefinition> {
  readonly program: CliProgram;
  readonly version?: string;
  readonly parse: (input?: CliParseInput) => CliParsedInvocation<Definition>;
}

/** Settings for one CLI parse. */
export interface CliParseInput {
  readonly argv?: readonly string[];
  readonly unknownFlagPolicy?: 'error' | 'collect';
}

/** A shell supported by completion script generation. */
export type CliShell = 'bash' | 'zsh' | 'fish' | 'pwsh';

/** Completion request using shell words and a cursor index. */
export interface CliCompletionRequest {
  readonly words: readonly string[];
  readonly cursor?: number;
  readonly currentWord?: string;
  readonly includeHidden?: boolean;
  readonly completionCommand?: string;
}

/** Minimal process boundary used by runCliMain. */
export interface CliMainHost {
  readonly argv: readonly string[];
  readonly writeStdout: (text: string) => void | Promise<void>;
  readonly writeStderr: (text: string) => void | Promise<void>;
  readonly setExitCode: (exitCode: number) => void;
}

/** Output a main-command handler asks the process adapter to apply. */
export interface CliMainOutput {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
}

/** Context passed to a main-command handler. */
export type CliMainHandlerContext<Definition, Context> = CliHandlerContext<
  CliParsedInvocationSuccess<Definition>,
  Context
>;

/** One main-command handler. */
export type CliMainHandler<Definition, Context> = CliHandler<
  CliParsedInvocationSuccess<Definition>,
  Context,
  CliMainOutput | void
>;

/** Main-command handlers keyed by canonical command key. */
export type CliMainHandlers<Definition, Context> = CliHandlers<
  CliParsedInvocationSuccess<Definition>,
  Context,
  CliMainOutput | void
>;

/** Input for the explicit process adapter. */
export interface CliMainInput<Definition extends CliDefinition, Context> {
  readonly cli: Cli<Definition>;
  readonly host: CliMainHost;
  readonly handlers: CliMainHandlers<Definition, Context>;
  readonly context: Context;
  readonly argv?: readonly string[];
  readonly completionCommand?: string;
  readonly formatDiagnostics?: (diagnostics: readonly CliDiagnostic[]) => string;
}

/** Node/Bun-like process object accepted without importing `node:process`. */
export interface ProcessLike {
  readonly argv: readonly string[];
  readonly stdout: { readonly write: (text: string) => unknown };
  readonly stderr: { readonly write: (text: string) => unknown };
  exitCode?: number;
}

/** Deno-like global accepted without importing runtime modules. */
export interface DenoLike {
  readonly args: readonly string[];
  readonly stdout: { readonly write: (data: Uint8Array) => Promise<number> };
  readonly stderr: { readonly write: (data: Uint8Array) => Promise<number> };
  exitCode: number;
}
