export function isSafeUrl(value: string): boolean {
  if (value === 'chrome://newtab/') return true;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
