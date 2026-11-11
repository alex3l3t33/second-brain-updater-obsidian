const MAX_CONTEXT_LINES = 80;

export function compactUnifiedDiff(path: string, before: string, after: string): string {
  if (before === after) return `--- a/${path}\n+++ b/${path}\n(no changes)`;

  const a = before.split("\n");
  const b = after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;

  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) suffix += 1;

  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  const trim = (lines: string[]) => {
    if (lines.length <= MAX_CONTEXT_LINES) return lines;
    const head = lines.slice(0, MAX_CONTEXT_LINES / 2);
    const tail = lines.slice(-MAX_CONTEXT_LINES / 2);
    return [...head, `… ${lines.length - MAX_CONTEXT_LINES} line(s) omitted …`, ...tail];
  };

  const out = [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${prefix + 1},${removed.length} +${prefix + 1},${added.length} @@`,
    ...trim(removed).map(line => `-${line}`),
    ...trim(added).map(line => `+${line}`),
  ];
  return out.join("\n");
}
