import { z } from 'zod';
import { stripRequestFraming } from './language';
import { isSafeUrl } from './urls';

export const MAX_MACROS = 50;
export const MAX_MACRO_SITES = 20;

/** Exact spoken-phrase matching, tolerant of punctuation, case and polite framing. */
export function normalizeMacroPhrase(value: string): string {
  return stripRequestFraming(value).normalize('NFKC').toLowerCase().replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    .replace(/^(?:(?:please|can you|could you|would you)\s+)+/, '')
    .replace(/\s+please$/, '').trim();
}
function normalizeSite(value: string): string {
  const raw = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  if (!isSafeUrl(candidate) || candidate.startsWith('chrome:')) throw new Error('Use an http:// or https:// website address.');
  return new URL(candidate).href;
}
const siteSchema = z.string().trim().min(1, 'Enter a website address.').max(2048, 'Website addresses must be under 2,048 characters.').transform((value, ctx) => {
  try { return normalizeSite(value); }
  catch { ctx.addIssue({ code: 'custom', message: `Invalid website: ${value.slice(0, 80)}. Use an http:// or https:// address.` }); return z.NEVER; }
});
export const macroSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, 'Give your macro a name.').max(60, 'Keep the macro name under 60 characters.'),
  phrase: z.string().trim().min(1, 'Set a command to say.').max(120, 'Keep the command under 120 characters.').refine(value => normalizeMacroPhrase(value).length > 0 && !['please', 'can you', 'could you', 'would you'].includes(normalizeMacroPhrase(value)), 'Include some command words.'),
  urls: z.array(siteSchema).min(1, 'Add at least one website.').max(MAX_MACRO_SITES, `Use at most ${MAX_MACRO_SITES} websites per macro.`)
    .refine(urls => new Set(urls).size === urls.length, 'A website is listed more than once.'),
}).strict();
export type Macro = z.infer<typeof macroSchema>;
export const macrosSchema = z.array(macroSchema).max(MAX_MACROS, `You can save up to ${MAX_MACROS} macros.`).superRefine((macros, ctx) => {
  const phrases = new Set<string>();
  const ids = new Set<string>();
  for (const macro of macros) {
    const phrase = normalizeMacroPhrase(macro.phrase);
    if (phrases.has(phrase)) ctx.addIssue({ code: 'custom', message: 'Another macro already uses that command. Choose a different phrase.' });
    if (ids.has(macro.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate macro ID.' });
    phrases.add(phrase); ids.add(macro.id);
  }
});
export function findMacro(macros: Macro[], transcript: string): Macro | undefined {
  const phrase = normalizeMacroPhrase(transcript);
  return phrase ? macros.find(macro => normalizeMacroPhrase(macro.phrase) === phrase) : undefined;
}
export function upsertMacro(macros: Macro[], input: unknown): Macro[] {
  const macro = macroSchema.parse(input);
  const next = macros.some(item => item.id === macro.id) ? macros.map(item => item.id === macro.id ? macro : item) : [...macros, macro];
  return macrosSchema.parse(next);
}
