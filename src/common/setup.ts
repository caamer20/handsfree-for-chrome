import { parseCommand } from './command-parser';
import { isNegatedCommand } from './language';
export interface VoiceSetup {
  id: string;
  status: 'running' | 'passed' | 'failed' | 'cancelled';
  stage: 'microphone' | 'speech' | 'interpretation' | 'browser' | 'complete';
  detail: string;
  transcript?: string;
  tabId?: number;
}
export function isSetupCommand(text: string): boolean {
  if (isNegatedCommand(text)) return false;
  const actions = parseCommand(text);
  return actions?.length === 1 && actions[0]?.action === 'create_tab' && actions[0].params.url === 'chrome://newtab/';
}
