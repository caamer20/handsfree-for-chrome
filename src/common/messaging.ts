import type { Message } from './schema';
import type { Reply } from './types';
export async function send(message: Message): Promise<Reply> {
  return chrome.runtime.sendMessage(message) as Promise<Reply>;
}
export function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500) || 'Something went wrong';
}
export async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally { clearTimeout(timer); }
}
