export function short(text: string, max = 110): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

export function asJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export function normalizeMarkdownMath(text: string): string {
  return (text || '')
    .replace(/\\\[((?:.|\n|\r)+?)\\\]/g, (_match, expr: string) => `\n\n$$\n${expr.trim()}\n$$\n\n`)
    .replace(/\\\((.+?)\\\)/g, (_match, expr: string) => `$${expr.trim()}$`);
}

export function pct(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export function budgetColor(used: number, max: number): string {
  const ratio = max <= 0 ? 0 : used / max;
  if (ratio >= 0.8) return 'var(--red)';
  if (ratio >= 0.5) return 'var(--clay)';
  return 'var(--sage)';
}

export const NODE_COLORS: Record<string, string> = {
  question: '#171717',
  evidence: '#2d6f82',
  plan_step: '#c46a3d',
  note: '#4f7661',
  conclusion: '#1f4f77',
  hypothesis: '#9a6a2f',
  procedure: '#6b3fa0',
  failure_pattern: '#ba4f45',
  session_object: '#3f8a7c',
  answer: '#1f4f77',
  signal: '#c46a3d',
  diagnostics: '#6d665d',
};

export const EDGE_COLORS: Record<string, string> = {
  support: '#2f8a61',
  supports: '#2f8a61',
  contradict: '#ba4f45',
  related: '#9b9286',
  part_of: '#7b7167',
  refine: '#2f7f7a',
  derived_from: '#4e7394',
  calls: '#6b3fa0',
  applied_in: '#3f8a7c',
  failure_of: '#ba4f45',
  replacement_for: '#2f8a61',
  depends_on: '#c46a3d',
};
