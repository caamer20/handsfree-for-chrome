import { credentialId, type ProviderConfig } from '../common/providers';
const STORAGE_KEY = 'apiCredentials';
async function credentials(): Promise<Record<string, string>> {
  const data = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}
export async function getApiKey(config: ProviderConfig): Promise<string | undefined> {
  return config.aiProvider === 'local' ? undefined : (await credentials())[credentialId(config)];
}
export async function saveApiKey(config: ProviderConfig, key: string): Promise<void> {
  if (config.aiProvider === 'local') throw new Error('Choose an API provider before saving a key.');
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.set({ [STORAGE_KEY]: { ...await credentials(), [credentialId(config)]: key } });
}
export async function removeApiKey(config: ProviderConfig): Promise<void> {
  if (config.aiProvider === 'local') return;
  const keys = await credentials(); delete keys[credentialId(config)];
  await chrome.storage.local.set({ [STORAGE_KEY]: keys });
}
