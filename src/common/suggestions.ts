import { COMMAND_EXAMPLES, type CommandExample } from './constants';
export function contextExamples(origin?: string): CommandExample[] {
  let hostname = ''; try { hostname = new URL(origin ?? '').hostname; } catch { /* Browser-level examples when no website is active. */ }
  const youtube = hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
  const examples = !hostname ? ['Open a new tab', 'Zoom to 125 percent'] : youtube ? ['Pause this video', 'Search YouTube for quiet piano', 'Show links'] : ['Show links', 'Scroll down a little', 'Zoom to 125 percent'];
  return examples.flatMap(text => { const example = COMMAND_EXAMPLES.find(item => item.text === text); return example ? [example] : []; });
}
