import { z } from 'zod';
import { normalizeMacroPhrase } from './macros';

export const routineSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  phrase: z.string().trim().min(1).max(120).refine(value => normalizeMacroPhrase(value).length > 0, 'Include some command words.'),
  steps: z.array(z.string().trim().min(1).max(500)).min(1).max(8),
}).strict();
export type Routine = z.infer<typeof routineSchema>;
export const routinesSchema = z.array(routineSchema).max(50).superRefine((items, ctx) => {
  for (const field of ['id', 'phrase'] as const) {
    const values = items.map(item => field === 'phrase' ? normalizeMacroPhrase(item[field]) : item[field]);
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: `Another routine uses this ${field}.` });
  }
});
