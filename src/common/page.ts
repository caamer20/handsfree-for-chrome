import { z } from 'zod';
export const pageResultSchema = z.object({ ok: z.boolean(), text: z.string().max(1000), token: z.string().optional(), focused: z.boolean().optional(), editable: z.boolean().optional(), choices: z.array(z.object({ id: z.number().int().min(1).max(200), label: z.string().max(150) })).max(200).optional(), url: z.string().max(4000).optional(), dictating: z.boolean().optional() }).strict();
export type PageResult = z.infer<typeof pageResultSchema>;
