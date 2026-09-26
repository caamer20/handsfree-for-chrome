type Join = 'closing' | 'opening' | 'hyphen' | 'dash';
const punctuation: Record<string, { mark: string; join: Join }> = {
  comma: { mark: ',', join: 'closing' },
  period: { mark: '.', join: 'closing' },
  'full stop': { mark: '.', join: 'closing' },
  'question mark': { mark: '?', join: 'closing' },
  'exclamation mark': { mark: '!', join: 'closing' },
  'exclamation point': { mark: '!', join: 'closing' },
  colon: { mark: ':', join: 'closing' },
  semicolon: { mark: ';', join: 'closing' },
  'open parenthesis': { mark: '(', join: 'opening' },
  'close parenthesis': { mark: ')', join: 'closing' },
  'open quote': { mark: '“', join: 'opening' },
  'close quote': { mark: '”', join: 'closing' },
  hyphen: { mark: '-', join: 'hyphen' },
  dash: { mark: '—', join: 'dash' },
};
const phrase = new RegExp(`\\b(?:${Object.keys(punctuation).map(key => key.replaceAll(' ', '[ \\t]+')).join('|')})\\b`, 'gi');

/** Format dictation data only. Keep literal's escape prefix for the page controller. */
export function formatDictation(text: string, enabled: boolean): string {
  if (!enabled || /^literal\s+[\s\S]+$/i.test(text)) return text;
  let result = ''; let offset = 0; let previous: Join | undefined;
  const appendText = (raw: string): void => {
    let value = raw;
    if (previous) {
      value = value.replace(/^[ \t]+/, '');
      if (value && !/^[\s.,!?;:)}\]”]/.test(value) && previous !== 'opening' && previous !== 'hyphen') value = ` ${value}`;
    }
    result += value;
  };
  for (const match of text.matchAll(phrase)) {
    appendText(text.slice(offset, match.index));
    const token = punctuation[match[0].toLowerCase().replace(/[ \t]+/g, ' ')]!;
    result = result.replace(/[ \t]+$/, '');
    if ((token.join === 'opening' || token.join === 'dash') && result && !/[\s([{“"/-]$/.test(result)) result += ' ';
    result += token.mark; previous = token.join; offset = match.index + match[0].length;
  }
  if (!previous) return text;
  appendText(text.slice(offset));
  return result;
}
