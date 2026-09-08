import { actionsSchema, type ChromeAction } from '../common/schema';
export function parseModelPlan(output: string): ChromeAction[] {
  if (output.length > 8000) throw new Error('The local model returned too much text. Try a shorter command.');
  let raw = output.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  // Permit an explanatory prefix, but never evaluate code or repair invalid JSON.
  const start = raw.indexOf('[');
  if (start < 0) throw new Error('I could not turn that into a browser command. Try an example.');
  raw = raw.slice(start);
  let quoted = false; let escaped = false; let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (escaped) { escaped = false; continue; }
    if (quoted && char === '\\') { escaped = true; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === '[') depth++;
    if (!quoted && char === ']' && --depth === 0) {
      if (raw.slice(i + 1).trim()) throw new Error('The model returned an ambiguous plan. Try a simpler command.');
      return actionsSchema.parse(JSON.parse(raw.slice(0, i + 1)) as unknown);
    }
  }
  throw new Error('The local model returned an incomplete command. Try a simpler phrase.');
}
