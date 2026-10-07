import type { CliShell } from './public-types.ts';

/** Shell-specific quoting and cursor normalization stay outside the grammar. */
export function shellCompletionScript(
  name: string,
  shell: CliShell,
  completionExecutable: string
): string {
  const identifier = `clivoke_${[...name].map((character) =>
    (character.codePointAt(0) ?? 0).toString(16)).join('_')}`;
  switch (shell) {
    case 'bash': return bashScript(shellQuote(name), shellQuote(completionExecutable), identifier);
    case 'zsh': return zshScript(shellQuote(name), shellQuote(completionExecutable), identifier);
    case 'fish': return fishScript(fishQuote(name), fishQuote(completionExecutable), identifier);
    case 'pwsh': return pwshScript(powerShellQuote(name), powerShellQuote(completionExecutable));
  }
}

function bashScript(program: string, executable: string, identifier: string): string {
  return `_${identifier}() {
  # COMP_WORDS splits '=' and ':' and retains shell quotes. Read only the
  # literal command prefix, never evaluate expansions in the user's input.
  local line=\${COMP_LINE:0:COMP_POINT} word='' quote='' char next
  local started=0 retained='' quoted_prefix='' escaped candidate index
  local -a request_words=()
  COMPREPLY=()
  for ((index = 0; index < \${#line}; index++)); do
    char=\${line:index:1}
    if [[ $char != [' '$'\\t'$'\\n'] || -n $quote ]]; then started=1; fi
    if [[ $quote == "'" ]]; then
      if [[ $char == "'" ]]; then quote=''; else word+=$char; fi
    elif [[ $quote == '"' ]]; then
      case $char in
        '"') quote='' ;;
        '$'|'\`') return ;;
        '\\')
          next=\${line:index+1:1}
          case $next in
            '$'|'\`'|'"'|'\\') word+=$next; ((index++)) ;;
            $'\\n') ((index++)) ;;
            *) word+=$char ;;
          esac ;;
        *) word+=$char ;;
      esac
    else
      case $char in
        "'"|'"') quote=$char; quoted_prefix=$word ;;
        '$'|'\`'|'>'|'<'|'('|')'|'|'|'&'|';'|'*'|'?'|'['|'{'|'}'|'~'|'!') return ;;
        '\\')
          next=\${line:index+1:1}
          if [[ $next != $'\\n' ]]; then word+=$next; fi
          ((index++)) ;;
        ' '|$'\\t'|$'\\n')
          if ((started)); then request_words+=("$word"); fi
          started=0
          word=''; retained=''; quoted_prefix=''
          # Whitespace separates words, but repeated whitespace is not an
          # empty argument. An explicitly quoted empty argument is retained.
          while [[ \${line:index+1:1} == [' '$'\\t'$'\\n'] ]]; do ((index++)); done ;;
        *)
          word+=$char
          if [[ $COMP_WORDBREAKS == *"$char"* ]]; then retained=$word; fi ;;
      esac
    fi
  done
  request_words+=("$word")
  request_words[0]=${program}
  if [[ -n $quote ]]; then retained=$quoted_prefix; fi
  while IFS= read -r candidate || [[ -n $candidate ]]; do
    [[ $candidate == "$retained"* ]] || continue
    candidate=\${candidate:\${#retained}}
    escaped=$candidate
    if [[ -z $candidate || $candidate == *[!a-zA-Z0-9_./:=+-]* ]]; then
      escaped=\${candidate//\\'/\\'\\\\\\'\\'}
      escaped="'$escaped'"
    fi
    # Readline removes the outer matching quote pair from a candidate. The
    # second pair closes/reopens the active quote around the literal word.
    # Keeping metacharacters in single quotes also stops history expansion.
    if [[ -n $quote ]]; then escaped="$quote$quote$escaped$quote$quote"; fi
    COMPREPLY+=("$escaped")
  done < <(${executable} lines "$((\${#request_words[@]} - 1))" "\${request_words[@]}")
}
complete -o noquote -F _${identifier} -- ${program}
`;
}

function zshScript(program: string, executable: string, identifier: string): string {
  return `_${identifier}() {
  emulate -L zsh
  local output
  local -a request_words candidates
  request_words=("\${(@Q)words}")
  request_words[1]=${program}
  request_words[$CURRENT]="\${(Q)PREFIX}"
  output="$(${executable} lines "$((CURRENT - 1))" "\${request_words[@]}")"
  [[ -n $output ]] || return
  candidates=("\${(@f)output}")
  # compadd quotes each literal candidate in the active quoting context.
  compadd -- "\${candidates[@]}"
}
compdef _${identifier} ${program}
`;
}

function fishScript(program: string, executable: string, identifier: string): string {
  return `function __${identifier}_complete
  set -l words (commandline -opc)
  set -l current (commandline -ct)
  set -l literal (string unescape -- "$current")
  if test $status -ne 0
    set literal (string unescape -- "$current'")
    if test $status -ne 0
      set literal (string unescape -- "$current\\"")
    end
  end
  if not set -q literal[1]
    set literal ''
  end
  set words[1] ${program}
  # Fish inserts command-substitution output as literal completion values.
  ${executable} lines (count $words) $words "$literal"
end
complete -c ${program} -f -a '(__${identifier}_complete)'
`;
}

function pwshScript(program: string, executable: string): string {
  return `Register-ArgumentCompleter -Native -CommandName ${program} -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  function ConvertFrom-ClivokeWord([string]$text) {
    $result = [System.Text.StringBuilder]::new()
    $quote = [char]0
    for ($i = 0; $i -lt $text.Length; $i++) {
      $char = $text[$i]
      if ($quote -eq "'") {
        if ($char -eq "'") {
          if ($i + 1 -lt $text.Length -and $text[$i + 1] -eq "'") {
            [void]$result.Append("'"); $i++
          } else { $quote = [char]0 }
        } else { [void]$result.Append($char) }
      } elseif ($char -eq [char]96 -and $i + 1 -lt $text.Length) {
        $i++
        if ($text[$i] -eq [char]10) { continue }
        $escaped = switch -CaseSensitive ($text[$i]) {
          '0' { [char]0 }
          'a' { [char]7 }
          'b' { [char]8 }
          'e' { [char]27 }
          'f' { [char]12 }
          'n' { [char]10 }
          'r' { [char]13 }
          't' { [char]9 }
          'v' { [char]11 }
          default { $text[$i] }
        }
        [void]$result.Append($escaped)
      } elseif ($quote -eq '"') {
        if ($char -eq '"') {
          if ($i + 1 -lt $text.Length -and $text[$i + 1] -eq '"') {
            [void]$result.Append('"'); $i++
          } else { $quote = [char]0 }
        } else { [void]$result.Append($char) }
      } elseif ($char -eq "'" -or $char -eq '"') {
        $quote = $char
      } else { [void]$result.Append($char) }
    }
    $result.ToString()
  }
  $words = [System.Collections.Generic.List[string]]::new()
  foreach ($element in $commandAst.CommandElements) {
    if ($element.Extent.StartOffset -gt $cursorPosition) { break }
    $length = [Math]::Min($element.Extent.Text.Length, $cursorPosition - $element.Extent.StartOffset)
    $words.Add((ConvertFrom-ClivokeWord $element.Extent.Text.Substring(0, $length)))
    if ($element.Extent.EndOffset -ge $cursorPosition) { break }
  }
  if ($words.Count -eq 0) { $words.Add(${program}) }
  $words[0] = ${program}
  $last = $commandAst.CommandElements | Where-Object { $_.Extent.StartOffset -le $cursorPosition } | Select-Object -Last 1
  if ($null -eq $last -or $last.Extent.EndOffset -lt $cursorPosition) { $words.Add('') }
  $current = $words.Count - 1
  & ${executable} lines $current @words | ForEach-Object {
    $value = [string]$_
    if ($value.Length -gt 0) {
      $quoted = "'" + $value.Replace("'", "''") + "'"
      [System.Management.Automation.CompletionResult]::new($quoted, $value, 'ParameterValue', $value)
    }
  }
}
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fishQuote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
