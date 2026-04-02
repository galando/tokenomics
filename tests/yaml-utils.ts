/**
 * Minimal YAML parser for CI/CD workflow files.
 * Handles the subset of YAML used by GitHub Actions workflows.
 * Uses js-yaml if available, falls back to a simple parser.
 */

// Simple recursive-descent YAML parser sufficient for GitHub Actions workflows.
// Does NOT handle anchors, complex types, or multi-doc streams.

type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

export function parse(input: string): any {
  const lines = input.split('\n');
  return parseBlock(lines, 0, 0).value;
}

function getIndent(line: string): number {
  const match = line.match(/^( *)/);
  return match ? match[1].length : 0;
}

function parseBlock(lines: string[], startIdx: number, baseIndent: number): { value: YamlValue; endIdx: number } {
  if (startIdx >= lines.length) return { value: null, endIdx: startIdx };

  // Skip blank/comment lines at start
  let idx = startIdx;
  while (idx < lines.length && (lines[idx].trim() === '' || lines[idx].trimStart().startsWith('#'))) {
    idx++;
  }
  if (idx >= lines.length) return { value: null, endIdx: idx };

  const firstLine = lines[idx];
  const firstIndent = getIndent(firstLine);

  // Determine if this is a map or sequence
  const trimmed = firstLine.trimStart();
  if (trimmed.startsWith('- ')) {
    return parseSequence(lines, idx, firstIndent);
  } else {
    return parseMap(lines, idx, baseIndent);
  }
}

function parseMap(lines: string[], startIdx: number, baseIndent: number): { value: Record<string, YamlValue>; endIdx: number } {
  const result: Record<string, YamlValue> = {};
  let idx = startIdx;

  while (idx < lines.length) {
    const line = lines[idx];

    // Skip blank/comment lines
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      idx++;
      continue;
    }

    const indent = getIndent(line);
    if (indent < baseIndent) break;

    const trimmed = line.trimStart();
    if (trimmed.startsWith('- ')) break;

    // Parse key: value
    const colonMatch = trimmed.match(/^([^:]+):\s*(.*)/);
    if (!colonMatch) {
      idx++;
      continue;
    }

    const key = colonMatch[1].trim();
    const rest = colonMatch[2].trim();

    if (rest === '' || rest.startsWith('#')) {
      // Value is on next indented lines
      const sub = parseBlock(lines, idx + 1, indent + 2);
      result[key] = sub.value;
      idx = sub.endIdx;
    } else {
      // Inline value
      result[key] = parseScalar(rest);
      idx++;
    }
  }

  return { value: result, endIdx: idx };
}

function parseSequence(lines: string[], startIdx: number, baseIndent: number): { value: YamlValue[]; endIdx: number } {
  const result: YamlValue[] = [];
  let idx = startIdx;

  while (idx < lines.length) {
    const line = lines[idx];

    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      idx++;
      continue;
    }

    const indent = getIndent(line);
    if (indent < baseIndent) break;

    const trimmed = line.trimStart();
    if (!trimmed.startsWith('- ')) break;

    const itemContent = trimmed.slice(2).trim();

    if (itemContent.includes(': ') && !itemContent.startsWith('"') && !itemContent.startsWith("'")) {
      // Inline map item like "- name: Checkout"
      // Collect all lines belonging to this sequence item
      const itemLines: string[] = [];
      const itemIndent = indent + 2;
      itemLines.push(' '.repeat(itemIndent) + itemContent);

      idx++;
      while (idx < lines.length) {
        const nextLine = lines[idx];
        if (nextLine.trim() === '' || nextLine.trimStart().startsWith('#')) {
          idx++;
          continue;
        }
        const nextIndent = getIndent(nextLine);
        if (nextIndent < itemIndent) break;
        itemLines.push(nextLine);
        idx++;
      }

      const sub = parseMap(itemLines, 0, itemIndent);
      result.push(sub.value);
    } else {
      result.push(parseScalar(itemContent));
      idx++;
    }
  }

  return { value: result, endIdx: idx };
}

function parseScalar(value: string): YamlValue {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null' || value === '~') return null;
  if (/^-?\d+$/.test(value)) return parseInt(value, 10);
  if (/^-?\d+\.\d+$/.test(value)) return parseFloat(value);
  return value;
}
