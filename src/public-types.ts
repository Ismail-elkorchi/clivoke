import type {
  CliAliasInput,
  CliCommand,
  CliCompletion as CoreCompletion,
  CliCoreDiagnostic,
  CliDefinitionIssue as CoreDefinitionIssue,
  CliHandlers,
  CliInvocation,
  CliInvocationFailure as CoreInvocationFailure,
  CliProgram
} from '@ismail-elkorchi/cli-core';
import type {
  BooleanOptionDefinition,
  CountOptionDefinition,
  DefinitionIssue as ArgvDefinitionIssue,
  MultipleValueOptionDefinition,
  ParseIssue,
  ParsedValues,
  ScalarValueOptionDefinition,
  ScannedArgument,
  ScannedOption,
  UnknownFlag,
  ValueType
} from 'argv-flags';

interface OptionPresentation {
  readonly description?: string;
  readonly hidden?: boolean;
  /** Prevents value-bearing diagnostics from being rendered by the default formatter. */
  readonly sensitive?: boolean;
}

interface ValuePresentation {
  readonly valueLabel?: string;
  readonly valueDescription?: string;
}

type DefaultPresentation<Definition> = Definition extends { readonly multiple: true }
  ? { readonly defaultLabel?: string }
  : Definition extends { readonly default: unknown }
    ? { readonly defaultLabel?: string }
    : { readonly defaultLabel?: never };

type ImplicitValuePresentation<Definition> =
  Definition extends { readonly valueMode: 'optional-inline' }
    ? { readonly implicitValueLabel?: string }
    : { readonly implicitValueLabel?: never };

type PresentValueDefinition<Definition> = Definition extends object
  ? Definition & OptionPresentation & ValuePresentation &
      DefaultPresentation<Definition> & ImplicitValuePresentation<Definition>
  : never;

/** One scalar value-taking option. */
export type CliScalarOptionDefinition<Type extends ValueType> =
  ScalarValueOptionDefinition<Type> extends infer Definition
    ? PresentValueDefinition<Definition>
    : never;

/** One accumulating value-taking option. */
export type CliMultipleOptionDefinition<Type extends ValueType> =
  MultipleValueOptionDefinition<Type> extends infer Definition
    ? PresentValueDefinition<Definition>
    : never;

/** One boolean option with optional explicit false spellings. */
export type CliBooleanOptionDefinition = BooleanOptionDefinition extends infer Definition
  ? Definition extends object
    ? Definition & OptionPresentation & DefaultPresentation<Definition>
    : never
  : never;

/** One occurrence-counting option. */
export type CliCountOptionDefinition = CountOptionDefinition & OptionPresentation;

type CliValueOptionDefinition<Type extends ValueType> = Type extends ValueType
  ? CliScalarOptionDefinition<Type> | CliMultipleOptionDefinition<Type>
  : never;

/** Option definition accepted by Clivoke. */
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

/** One command in the Clivoke definition tree. */
export interface CliCommandDefinition {
  readonly name: string;
  readonly aliases?: readonly CliAliasInput[];
  readonly description?: string;
  readonly deprecated?: boolean | string;
  readonly options?: CliOptionDefinitions;
  readonly positionals?: readonly CliPositionalDefinition[];
  readonly commands?: readonly CliCommandDefinition[];
  /** Whether this command may be selected for invocation. Defaults to true. */
  readonly invokable?: boolean;
  readonly acceptsPassthroughArguments?: boolean;
}

/** A complete typed CLI definition. */
export interface CliDefinition {
  readonly name: string;
  readonly description?: string;
  readonly options?: CliOptionDefinitions;
  readonly positionals?: readonly CliPositionalDefinition[];
  readonly commands?: readonly CliCommandDefinition[];
  /** Whether the root may be selected for invocation. Defaults to true. */
  readonly invokable?: boolean;
  readonly acceptsPassthroughArguments?: boolean;
}

type GlobalOptions<Definition> = Definition extends { readonly options?: infer Options }
  ? Options extends CliOptionDefinitions
    ? Options
    : Readonly<Record<never, never>>
  : Readonly<Record<never, never>>;

type CommandOptions<Command> = Command extends { readonly options?: infer Options }
  ? Options extends CliOptionDefinitions
    ? Options
    : Readonly<Record<never, never>>
  : Readonly<Record<never, never>>;

type PositionalsOf<Command> = Command extends { readonly positionals?: infer Positionals }
  ? Positionals extends readonly CliPositionalDefinition[]
    ? Positionals
    : readonly []
  : readonly [];

type CommandsOf<Definition> = Definition extends { readonly commands?: infer Commands }
  ? Commands extends readonly CliCommandDefinition[]
    ? Commands
    : readonly []
  : readonly [];

type MergeOptions<Inherited, Local> = Inherited extends CliOptionDefinitions
  ? Local extends CliOptionDefinitions
    ? Readonly<Inherited & Local>
    : Inherited
  : Local;

interface CommandTypeNode<
  Key extends string,
  Path extends readonly string[],
  Options extends CliOptionDefinitions,
  Positionals extends readonly CliPositionalDefinition[],
  AcceptsPassthrough extends boolean
> {
  readonly key: Key;
  readonly path: Path;
  readonly options: Options;
  readonly positionals: Positionals;
  readonly acceptsPassthrough: AcceptsPassthrough;
}

type AcceptsPassthrough<Definition> =
  Definition extends { readonly acceptsPassthroughArguments: true } ? true : false;

type NodeIfInvokable<Definition, Node> =
  Definition extends { readonly invokable: false } ? never : Node;

type NestedCommandNodes<
  ProgramName extends string,
  Commands extends readonly CliCommandDefinition[],
  ParentPath extends readonly string[],
  InheritedOptions extends CliOptionDefinitions
> = Commands[number] extends infer Command
  ? Command extends CliCommandDefinition
    ? Command['name'] extends infer Name extends string
      ? MergeOptions<InheritedOptions, CommandOptions<Command>> extends infer Options extends CliOptionDefinitions
        ? NodeIfInvokable<Command, CommandTypeNode<
            `${ProgramName} ${JoinPath<readonly [...ParentPath, Name]>}`,
            readonly [...ParentPath, Name],
            Options,
            PositionalsOf<Command>,
            AcceptsPassthrough<Command>
          >> | NestedCommandNodes<
            ProgramName,
            CommandsOf<Command>,
            readonly [...ParentPath, Name],
            Options
          >
        : never
      : never
    : never
  : never;

type JoinPath<Path extends readonly string[]> = Path extends readonly [
  infer First extends string,
  ...infer Rest extends readonly string[]
]
  ? Rest extends readonly []
    ? First
    : `${First} ${JoinPath<Rest>}`
  : '';

type CommandNodes<Definition extends CliDefinition> =
  | NodeIfInvokable<Definition, CommandTypeNode<
      Definition['name'],
      readonly [],
      GlobalOptions<Definition>,
      PositionalsOf<Definition>,
      AcceptsPassthrough<Definition>
    >>
  | NestedCommandNodes<
      Definition['name'],
      CommandsOf<Definition>,
      readonly [],
      GlobalOptions<Definition>
    >;

type SpecifiedOptions<Options extends CliOptionDefinitions> = {
  readonly [Name in keyof Options]: Options[Name] extends { readonly required: true }
    ? true
    : boolean;
};

type PositionalValue<Definition extends CliPositionalDefinition> =
  Definition extends { readonly variadic: true }
    ? readonly string[]
    : Definition extends { readonly required: false }
      ? string | undefined
      : string;

type PositionalValues<Positionals extends readonly CliPositionalDefinition[]> = {
  readonly [Definition in Positionals[number] as Definition['name']]: PositionalValue<Definition>;
};

type InvocationForNode<Node> = Node extends CommandTypeNode<
  infer Key,
  infer Path,
  infer Options,
  infer Positionals,
  boolean
>
  ? Omit<
      CliInvocation,
      | 'commandKey'
      | 'command'
      | 'optionValues'
      | 'specifiedOptions'
      | 'positionalValues'
      | 'diagnostics'
    > & {
      readonly commandKey: Key;
      readonly command: Omit<CliCommand, 'key' | 'path'> & {
        readonly key: Key;
        readonly path: Path;
      };
      readonly optionValues: ParsedValues<Options>;
      readonly specifiedOptions: SpecifiedOptions<Options>;
      readonly positionalValues: PositionalValues<Positionals>;
      readonly diagnostics: readonly CliDiagnostic[];
    }
  : never;

/** Successful invocation discriminated by its literal canonical command key. */
export type CliInvocationSuccess<Definition extends CliDefinition> =
  InvocationForNode<CommandNodes<Definition>>;

/** Rejected Clivoke invocation with unified diagnostics. */
export type CliInvocationFailure = Omit<CoreInvocationFailure, 'diagnostics'> & {
  readonly diagnostics: readonly CliDiagnostic[];
};

/** Clivoke invocation result. */
export type CliInvocationResult<Definition extends CliDefinition> =
  | CliInvocationSuccess<Definition>
  | CliInvocationFailure;

/** One option diagnostic retaining argv-flags' discriminated fields. */
export type CliOptionDiagnostic = ParseIssue extends infer Issue
  ? Issue extends ParseIssue
    ? Issue & {
        readonly source: 'option';
        readonly severity: 'error';
        readonly sensitive?: true;
      }
    : never
  : never;

/** Runtime diagnostic with explicit source ownership. */
export type CliDiagnostic = CliCoreDiagnostic | CliOptionDiagnostic;

/** Definition issue owned by Clivoke's outer definition boundary. */
export type CliFacadeDefinitionIssue =
  | {
      readonly source: 'clivoke';
      readonly code: 'UNKNOWN_PROPERTY';
      readonly message: string;
      readonly definitionPath: readonly string[];
      readonly property: string | symbol;
    }
  | {
      readonly source: 'clivoke';
      readonly code: 'INVALID_DEFINITION';
      readonly message: string;
      readonly definitionPath: readonly string[];
    };

type SourcedCoreDefinitionIssue = CoreDefinitionIssue extends infer Issue
  ? Issue extends CoreDefinitionIssue
    ? Issue & { readonly source: 'command' }
    : never
  : never;

type SourcedArgvDefinitionIssue = ArgvDefinitionIssue extends infer Issue
  ? Issue extends ArgvDefinitionIssue
    ? Issue & {
        readonly source: 'option';
        readonly commandPath: readonly string[];
      }
    : never
  : never;

/** Every definition issue reported by the single Clivoke compiler. */
export type CliDefinitionIssue =
  | CliFacadeDefinitionIssue
  | SourcedCoreDefinitionIssue
  | SourcedArgvDefinitionIssue;

type StructuredInputForNode<Node> = Node extends CommandTypeNode<
  string,
  infer Path,
  infer Options,
  infer Positionals,
  infer AcceptsPassthrough
>
  ? {
      readonly sourceId?: string;
      readonly commandPath: Path;
      readonly optionValues: ParsedValues<Options>;
      readonly specifiedOptions: SpecifiedOptions<Options>;
      readonly positionalValues: PositionalValues<Positionals>;
    } & (AcceptsPassthrough extends true
      ? { readonly passthroughArguments?: readonly string[] }
      : { readonly passthroughArguments?: never })
  : never;

/** Command-specific already-decoded input for programmatic invocation. */
export type CliStructuredInvocationInput<Definition extends CliDefinition> =
  StructuredInputForNode<CommandNodes<Definition>>;

/** A compiled CLI. */
export interface Cli<Definition extends CliDefinition = CliDefinition> {
  readonly program: CliProgram;
  readonly parse: (input?: CliParseInput) => CliInvocationResult<Definition>;
  readonly invoke: (
    input: CliStructuredInvocationInput<Definition>
  ) => CliInvocationResult<Definition>;
}

/** Settings for one CLI parse. */
export interface CliParseInput {
  readonly argv?: readonly string[];
  readonly unknownFlagPolicy?: 'error' | 'collect';
}

/** A shell supported by completion script generation. */
export type CliShell = 'bash' | 'zsh' | 'fish' | 'pwsh';

/** Immutable command and token state supplied to application completion providers. */
export interface CliCompletionPartialInvocation {
  readonly commandPath: readonly string[];
  readonly words: readonly string[];
  readonly cursor: number;
  readonly argv: readonly string[];
  readonly options: readonly ScannedOption[];
  readonly arguments: readonly ScannedArgument[];
  readonly passthroughArguments: readonly ScannedArgument[];
  readonly unknownFlags: readonly UnknownFlag[];
}

interface CompletionContextBase {
  readonly commandPath: readonly string[];
  readonly prefix: string;
  readonly partialInvocation: CliCompletionPartialInvocation;
}

/** Context supplied when completion needs application-owned values. */
export type CliCompletionContext =
  | CompletionContextBase & {
      readonly kind: 'option-value';
      readonly option: string;
    }
  | CompletionContextBase & {
      readonly kind: 'positional';
      readonly positional: string;
    }
  | CompletionContextBase & {
      readonly kind: 'passthrough';
    };

/** Completion values may be computed asynchronously. */
export type CliCompletionProvider = (
  context: CliCompletionContext
) => readonly string[] | Promise<readonly string[]>;

/** Completion request using one explicit cursor coordinate system. */
export interface CliCompletionRequest {
  readonly words: readonly string[];
  /** Index in `words` of the word being completed; `words.length` means an empty trailing word. */
  readonly cursor?: number;
  readonly includeHidden?: boolean;
  readonly provideValues?: CliCompletionProvider;
}

/** Completion candidate, including application-owned values. */
export type CliCompletion = CoreCompletion
  | {
      readonly kind: 'positional-value';
      readonly value: string;
      readonly positional: string;
    }
  | {
      readonly kind: 'passthrough-value';
      readonly value: string;
    };

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

/** Main-command handlers restricted to literal canonical command keys. */
export type CliMainHandlers<Definition extends CliDefinition, Context> = CliHandlers<
  CliInvocationSuccess<Definition>,
  Context,
  CliMainOutput | void
>;

/** An execution failure deliberately exposed to an observer, not to terminal output. */
export type CliMainFailure =
  | {
      readonly kind: 'missing-handler';
      readonly commandKey: string;
      readonly error: Error;
    }
  | {
      readonly kind: 'unexpected';
      readonly error: unknown;
    };

/** Input for the explicit process adapter. */
export interface CliMainInput<Definition extends CliDefinition, Context> {
  readonly cli: Cli<Definition>;
  readonly host: CliMainHost;
  readonly handlers: CliMainHandlers<Definition, Context>;
  readonly context: Context;
  readonly argv?: readonly string[];
  readonly formatDiagnostics?: (diagnostics: readonly CliDiagnostic[]) => string;
  readonly observeFailure?: (failure: CliMainFailure) => void | Promise<void>;
}

/** Input for a dedicated completion executable. */
export interface CliCompletionMainInput<Definition extends CliDefinition> {
  readonly cli: Cli<Definition>;
  readonly host: CliMainHost;
  /** Protocol argv: output representation, cursor word index, then complete shell words. */
  readonly argv?: readonly string[];
  readonly provideValues?: CliCompletionProvider;
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
