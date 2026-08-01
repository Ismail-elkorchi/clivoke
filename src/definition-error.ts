import type { CliDefinitionIssue } from './public-types.ts';

/** Error thrown when any part of a Clivoke definition is invalid. */
export class CliDefinitionError extends TypeError {
  public readonly issues: readonly CliDefinitionIssue[];

  public constructor(issues: readonly CliDefinitionIssue[]) {
    super(`Invalid Clivoke definition (${String(issues.length)} ${issues.length === 1 ? 'issue' : 'issues'}).`);
    this.name = 'CliDefinitionError';
    this.issues = Object.freeze(issues.map((issue) => Object.freeze(issue)));
  }
}
