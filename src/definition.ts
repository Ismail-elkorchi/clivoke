import {
  CliDefinitionError,
  defineCli as defineCoreCli,
  findCliCommand,
  type CliCommandDefinition as CoreCommandDefinition,
  type CliDefinitionIssue,
  type CliDefinition as CoreDefinition,
  type CliOptionDefinition as CoreOptionDefinition,
  type CliProgram
} from '@ismail-elkorchi/cli-core';
import { createArgvBinder } from './option-binder.ts';
import type {
  Cli,
  CliBooleanOptionDefinition,
  CliCommandDefinition,
  CliCountOptionDefinition,
  CliDefinition,
  CliMultipleOptionDefinition,
  CliOptionDefinitions,
  CliParseInput,
  CliParsedInvocation,
  CliScalarOptionDefinition,
} from './public-types.ts';
import type { ValueType } from 'argv-flags';

type OptionShape<Definition> = Definition extends { readonly type: 'boolean' }
  ? CliBooleanOptionDefinition
  : Definition extends { readonly type: 'count' }
    ? CliCountOptionDefinition
    : Definition extends { readonly type: infer Type }
      ? Type extends ValueType
        ? Definition extends { readonly multiple: true }
          ? CliMultipleOptionDefinition<Type>
          : CliScalarOptionDefinition<Type>
        : never
      : never;

type ExactOption<Definition> = OptionShape<Definition> & Record<
  Exclude<keyof Definition, keyof OptionShape<Definition>>,
  never
>;

type ExactOptions<Definitions extends CliOptionDefinitions> = {
  readonly [Name in keyof Definitions]: ExactOption<Definitions[Name]>;
};

type ExactCommands<Commands extends readonly CliCommandDefinition[]> = {
  readonly [Index in keyof Commands]: Commands[Index] extends CliCommandDefinition
    ? ExactCommand<Commands[Index]>
    : never;
};

type ExactCommand<Command extends CliCommandDefinition> = Command & Record<
  Exclude<keyof Command, keyof CliCommandDefinition>,
  never
> & (Command extends { readonly options: infer Options }
  ? Options extends CliOptionDefinitions
    ? { readonly options: Options & ExactOptions<Options> }
    : never
  : object) & (Command extends { readonly commands: infer Commands }
  ? Commands extends readonly CliCommandDefinition[]
    ? { readonly commands: ExactCommands<Commands> }
    : never
  : object);

type ExactDefinition<Definition extends CliDefinition> = Definition & Record<
  Exclude<keyof Definition, keyof CliDefinition>,
  never
> & (Definition extends { readonly options: infer Options }
  ? Options extends CliOptionDefinitions
    ? { readonly options: Options & ExactOptions<Options> }
    : never
  : object) & (Definition extends { readonly commands: infer Commands }
  ? Commands extends readonly CliCommandDefinition[]
    ? { readonly commands: ExactCommands<Commands> }
    : never
  : object);

/** Compiles command semantics and argv parsers into one reusable facade. */
export function createCli<const Definition extends CliDefinition>(definition: ExactDefinition<Definition>): Cli<Definition> {
  validateFacadeShape(definition);
  const coreDefinition = toCoreDefinition(definition);
  const program = defineCoreCli(coreDefinition);
  const definitionsByCommand = optionDefinitionsByCommand(program, definition);
  const parser = createArgvBinder(definitionsByCommand);
  return Object.freeze({
    program,
    ...(definition.version === undefined ? {} : { version: definition.version }),
    parse(input: CliParseInput = {}): CliParsedInvocation<Definition> {
      const invocation = parser.parse(program, {
        ...(input.argv === undefined ? {} : { argv: input.argv }),
        unknownFlagPolicy: input.unknownFlagPolicy === 'collect' ? 'collect' : 'error'
      });
      return invocation as CliParsedInvocation<Definition>;
    }
  });
}

const facadeProperties = new Set(['name', 'version', 'description', 'options', 'commands']);
const commandProperties = new Set([
  'name',
  'aliases',
  'description',
  'deprecated',
  'options',
  'positionals',
  'commands',
  'acceptsAfterDoubleDash'
]);

function validateFacadeShape(definition: CliDefinition): void {
  const issues: CliDefinitionIssue[] = [];
  if (!isRecord(definition)) {
    throw new CliDefinitionError([{
      code: 'INVALID_PROGRAM_NAME',
      message: 'The CLI definition must be an object.',
      name: definition
    }]);
  }
  collectUnknownProperties(definition, facadeProperties, [], issues);
  if (definition.version !== undefined && typeof definition.version !== 'string') {
    issues.push({
      code: 'INVALID_PROPERTY',
      message: 'version must be a string.',
      definitionPath: Object.freeze([]),
      property: 'version',
      expected: 'string'
    });
  }
  collectOptionShapeIssues(definition.options, [], issues);
  collectCommandShapeIssues(definition.commands, [], issues);
  if (issues.length > 0) throw new CliDefinitionError(issues);
}

function collectCommandShapeIssues(
  commands: unknown,
  parentPath: readonly string[],
  issues: CliDefinitionIssue[]
): void {
  if (commands === undefined) return;
  if (!Array.isArray(commands)) {
    issues.push({
      code: 'INVALID_COMMAND_NAME',
      message: 'Commands must be an array.',
      commandPath: Object.freeze([...parentPath]),
      name: commands
    });
    return;
  }
  for (const command of commands) {
    if (!isRecord(command)) {
      issues.push({
        code: 'INVALID_COMMAND_NAME',
        message: 'Each command must be an object.',
        commandPath: Object.freeze([...parentPath]),
        name: command
      });
      continue;
    }
    const name = command['name'];
    const path = [...parentPath, typeof name === 'string' ? name : ''];
    collectUnknownProperties(command, commandProperties, path, issues);
    collectOptionShapeIssues(command['options'], path, issues);
    collectCommandShapeIssues(command['commands'], path, issues);
  }
}

function collectOptionShapeIssues(
  options: unknown,
  commandPath: readonly string[],
  issues: CliDefinitionIssue[]
): void {
  if (options === undefined) return;
  if (!isRecord(options)) {
    issues.push({
      code: 'INVALID_OPTION',
      message: 'Options must be an object keyed by logical option name.',
      commandPath: Object.freeze([...commandPath]),
      index: 0,
      reason: 'definition'
    });
    return;
  }
  let index = 0;
  for (const property of Reflect.ownKeys(options)) {
    if (typeof property !== 'string' || !isRecord(options[property])) {
      issues.push({
        code: 'INVALID_OPTION',
        message: 'Each option must have a string name and an object definition.',
        commandPath: Object.freeze([...commandPath]),
        index,
        reason: 'definition'
      });
    }
    index += 1;
  }
}

function collectUnknownProperties(
  value: object,
  allowed: ReadonlySet<string>,
  path: readonly string[],
  issues: CliDefinitionIssue[]
): void {
  for (const property of Reflect.ownKeys(value)) {
    if (typeof property === 'string' && allowed.has(property)) continue;
    issues.push({
      code: 'UNKNOWN_PROPERTY',
      message: 'Definition object contains an unsupported property.',
      definitionPath: Object.freeze([...path]),
      property
    });
  }
}

function isRecord(value: unknown): value is Readonly<Record<PropertyKey, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toCoreDefinition(definition: CliDefinition): CoreDefinition {
  return {
    name: definition.name,
    ...(definition.description === undefined ? {} : { description: definition.description }),
    options: optionPresentations(definition.options ?? {}),
    commands: (definition.commands ?? []).map(toCoreCommand)
  };
}

function toCoreCommand(definition: CliCommandDefinition): CoreCommandDefinition {
  return {
    name: definition.name,
    ...(definition.aliases === undefined ? {} : { aliases: definition.aliases }),
    ...(definition.description === undefined ? {} : { description: definition.description }),
    ...(definition.deprecated === undefined ? {} : { deprecated: definition.deprecated }),
    options: optionPresentations(definition.options ?? {}),
    ...(definition.positionals === undefined ? {} : { positionals: definition.positionals }),
    commands: (definition.commands ?? []).map(toCoreCommand),
    ...(definition.acceptsAfterDoubleDash === undefined
      ? {}
      : { acceptsAfterDoubleDash: definition.acceptsAfterDoubleDash })
  };
}

function optionPresentations(definitions: CliOptionDefinitions): readonly CoreOptionDefinition[] {
  return Object.freeze(Object.entries(definitions).map(([name, definition]) => {
    const flags = definition.type === 'boolean' && definition.falseFlags !== undefined
      ? [...definition.flags, ...definition.falseFlags]
      : [...definition.flags];
    const valueMode = definition.type === 'boolean' || definition.type === 'count'
      ? 'none' as const
      : definition.valueMode ?? 'required';
    const common = {
      name,
      flags: nonEmptyFlags(flags),
      ...('required' in definition && definition.required !== undefined ? { required: definition.required } : {}),
      ...(definition.description === undefined ? {} : { description: definition.description }),
      ...(definition.hidden === undefined ? {} : { hidden: definition.hidden })
    };
    if (valueMode === 'none') return { ...common, valueMode };
    return {
      ...common,
      valueMode,
      ...('valueLabel' in definition && definition.valueLabel !== undefined
        ? { valueLabel: definition.valueLabel }
        : {})
    };
  }));
}

function optionDefinitionsByCommand(
  program: CliProgram,
  definition: CliDefinition
): ReadonlyMap<string, CliOptionDefinitions> {
  const result = new Map<string, CliOptionDefinitions>();
  const globalOptions = definition.options ?? {};
  result.set(program.root.key, globalOptions);
  collectCommandOptions(program, definition.commands ?? [], [], globalOptions, result);
  return result;
}

function collectCommandOptions(
  program: CliProgram,
  definitions: readonly CliCommandDefinition[],
  parentPath: readonly string[],
  globalOptions: CliOptionDefinitions,
  result: Map<string, CliOptionDefinitions>
): void {
  for (const definition of definitions) {
    const path = [...parentPath, definition.name];
    const command = findCliCommand(program, path);
    if (command !== undefined) {
      result.set(command.key, Object.freeze({ ...globalOptions, ...(definition.options ?? {}) }));
    }
    collectCommandOptions(program, definition.commands ?? [], path, globalOptions, result);
  }
}

function nonEmptyFlags(flags: readonly string[]): readonly [string, ...string[]] {
  const [first, ...rest] = flags;
  if (first === undefined) throw new TypeError('An option must declare at least one flag.');
  return Object.freeze([first, ...rest]);
}
