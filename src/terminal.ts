const terminalControls = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** Whether text can be emitted as one literal terminal-safe protocol line. */
export function isTerminalSafe(value: string): boolean {
  return !terminalControls.test(value);
}

/** Escapes terminal control characters while preserving readable Unicode text. */
export function sanitizeTerminalText(value: string): string {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return !isTerminalSafe(character)
      ? `\\u{${codePoint.toString(16).padStart(4, '0')}}`
      : character;
  }).join('');
}
