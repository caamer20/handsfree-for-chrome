import type { PageParams } from './expanded-schema';
import { spokenQuantity } from './language';

/** Reserve explicit page-structure syntax even when its destination is incomplete. */
export function isNavigationCommand(raw: string): boolean {
  return /^(?:show|list|number)(?: me)?(?: the| all)? (?:headings|landmarks|page regions)\b/i.test(raw)
    || /^(?:(?:go|move|jump)(?: to)? )?(?:the )?(?:next|previous) (?:heading|landmark|page region)\b/i.test(raw)
    || /^(?:go|move|jump) to (?:the )?(?:heading|landmark|page region)\b/i.test(raw)
    || /^(?:go|move|jump) to (?:the )?.+ (?:heading|landmark|page region)$/i.test(raw)
    || /^(?:go|jump|skip) to (?:the )?main (?:content|region)\b/i.test(raw);
}

/** Page structure commands are explicit so tab names remain tab names. */
export function navigationCommand(raw: string): PageParams | null {
  let match = raw.match(/^(?:show|list|number)(?: me)?(?: the| all)? (headings|landmarks|page regions)$/i);
  if (match) return { operation: match[1]!.toLowerCase() === 'headings' ? 'show_headings' : 'show_landmarks' };
  match = raw.match(/^(?:(?:go|move|jump)(?: to)? )?(?:the )?(next|previous) (heading|landmark|page region)$/i);
  if (match) return { operation: `${match[1]!.toLowerCase()}_${match[2]!.toLowerCase() === 'heading' ? 'heading' : 'landmark'}` as PageParams['operation'] };
  match = raw.match(/^(?:go|move|jump) to (?:the )?(heading|landmark|page region) (.+)$/i);
  const reversed = match ? null : raw.match(/^(?:go|move|jump) to (?:the )?(.+?) (heading|landmark|page region)$/i);
  const kind = match?.[1] ?? reversed?.[2]; const value = match?.[2] ?? reversed?.[1];
  if (kind && value) {
    const operation = kind.toLowerCase() === 'heading' ? 'go_heading' : 'go_landmark';
    const quoted = value.match(/^["“]([\s\S]+)["”]$/);
    if (quoted) return { operation, query: quoted[1] };
    if (/^["“]/.test(value)) return null;
    const numberText = value.replace(/^number\s+/i, '');
    const number = /^[+-]?\d+(?:\.\d+)?(?:st|nd|rd|th)?$/i.test(numberText) ? Number.parseFloat(numberText) : spokenQuantity(numberText);
    if (number !== undefined) return Number.isInteger(number) && number >= 1 && number <= 200 ? { operation, index: number } : null;
    if (/^number(?:\s|$)/i.test(value)) return null;
    return { operation, query: value };
  }
  if (/^(?:go|jump|skip) to (?:the )?main (?:content|region)$/i.test(raw)) return { operation: 'go_landmark', query: 'main' };
  return null;
}
