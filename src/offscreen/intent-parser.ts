import { parseCommand } from '../common/command-parser';
import type { ChromeAction } from '../common/schema';
import type { LocalIntentModel } from './local-model';

/** Standard builds resolve the lazy model module to a small explanatory stub. */
export class IntentParser {
  private model: LocalIntentModel | undefined;
  private loading: Promise<LocalIntentModel> | undefined;
  private disposed = false;

  async parse(transcript: string, aiEnabled: boolean, status: (message: string) => void): Promise<{ actions: ChromeAction[]; source: 'grammar' | 'model' }> {
    const known = parseCommand(transcript);
    if (known) return { actions: known, source: 'grammar' };
    if (!aiEnabled) throw new Error('Try a phrase from Commands, or enable AI in Advanced settings.');
    if (this.disposed) throw new Error('Command cancelled.');
    this.loading ??= import('./local-model').then(({ LocalIntentModel }) => this.model = new LocalIntentModel());
    const model = await this.loading;
    if (this.disposed) { await model.dispose(); throw new Error('Command cancelled.'); }
    return model.parse(transcript, status);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.model?.dispose();
  }
}
