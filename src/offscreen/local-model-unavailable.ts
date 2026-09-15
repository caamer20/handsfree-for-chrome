import type { ChromeAction } from '../common/schema';

export class LocalIntentModel {
  async parse(): Promise<{ actions: ChromeAction[]; source: 'model' }> {
    throw new Error('Local AI is not included in the standard edition. Try a command example, configure cloud AI in Advanced settings, or install the optional local-AI edition.');
  }
  async dispose(): Promise<void> { /* No model is loaded in this edition. */ }
}
