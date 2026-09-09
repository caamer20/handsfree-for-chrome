import { z } from 'zod';

export const providerSchema = z.enum(['local', 'openai', 'anthropic', 'gemini', 'compatible']);
export type Provider = z.infer<typeof providerSchema>;
export interface ProviderConfig { aiProvider: Provider; aiModel: string; aiBaseUrl: string; }
export const PROVIDER_LABELS: Record<Provider, string> = { local: 'On-device SmolLM2', openai: 'OpenAI', anthropic: 'Anthropic Claude', gemini: 'Google Gemini', compatible: 'OpenAI-compatible API' };
export function providerEndpoint(config: ProviderConfig): URL {
  switch (config.aiProvider) {
    case 'openai': return new URL('https://api.openai.com/v1/responses');
    case 'anthropic': return new URL('https://api.anthropic.com/v1/messages');
    case 'gemini': return new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.aiModel)}:generateContent`);
    case 'compatible': {
      let url: URL;
      try { url = new URL(config.aiBaseUrl); } catch { throw new Error('Enter a valid HTTPS API base URL.'); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTPS API base URL without credentials, query parameters, or a fragment.');
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
      return url;
    }
    case 'local': throw new Error('The on-device model has no API endpoint.');
  }
}
export function providerOrigin(config: ProviderConfig): string { return `${providerEndpoint(config).origin}/*`; }
export function credentialId(config: ProviderConfig): string { return `${config.aiProvider}:${providerEndpoint(config).origin}`; }
export function validateProvider(config: ProviderConfig): void {
  if (config.aiProvider === 'local') return;
  if (!config.aiModel.trim()) throw new Error('Enter the model ID from your API provider.');
  providerEndpoint(config);
}
