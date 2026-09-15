import { expect, it } from 'vitest';
import { parseCommand } from '../src/common/command-parser';
import { speechChoices, spokenCorrection } from '../src/common/speech-intent';
import { migrateSettings } from '../src/common/settings';
import { isSetupCommand } from '../src/common/setup';
import { contextExamples } from '../src/common/suggestions';

const identify = (text: string): string | undefined => { const actions = parseCommand(text); return actions ? JSON.stringify(actions) : undefined; };
it.each(['mute this tab no actually pin this tab', 'mute this tab, actually pin this tab', 'mute this tab sorry I meant pin this tab'])('uses an explicit complete spoken replacement: %s', text => {
  expect(parseCommand(spokenCorrection(text))).toEqual(parseCommand('pin this tab'));
});
it.each([
  'Search Google for no actually pin this tab',
  'Search Google for cats no actually search YouTube for dogs',
  'Fill the search box with cats no actually pin this tab',
  'Bookmark this page as Research no actually pin this tab',
  'mute this tab no actually something unsupported',
  'something unsupported no actually pin this tab',
])('preserves literal data and incomplete corrections: %s', text => { expect(spokenCorrection(text)).toBe(text); });
it('asks about conflicting supported transcripts instead of guessing', () => {
  expect(speechChoices('mute this tab', ['pin this tab'], identify)).toEqual(['mute this tab', 'pin this tab']);
});
it('collapses paraphrases with the same meaning and ignores unsupported alternatives', () => {
  expect(speechChoices('mute this tab', ['silence this tab', 'an irrelevant phrase'], identify)).toEqual([]);
});
it('requires a choice even when only the alternate transcript is supported', () => {
  expect(speechChoices('pen this tab', ['pin this tab'], identify)).toEqual(['pin this tab']);
});
it('never upgrades a negated primary transcript into an action', () => {
  expect(speechChoices('do not close this tab', ['close this tab'], identify)).toEqual([]);
});
it.each(['open a new tab', 'Please open a new tab'])('accepts only the harmless setup action: %s', text => { expect(isSetupCommand(text)).toBe(true); });
it.each(['close this tab', 'do not open a new tab', 'open a new tab then close this tab', 'open Gmail'])('rejects other setup intents: %s', text => { expect(isSetupCommand(text)).toBe(false); });
it('migrates version 1.7 preferences without resetting valid selections', () => {
  const settings = migrateSettings({ language: 'en-GB', triggerPhrase: 'hey browser', aiProvider: 'openai', aiEnabled: true, aiModel: 'my-model', feedback: 'sound', setupCommandPassed: true, obsoleteField: 'ignored' });
  expect(settings).toMatchObject({ language: 'en-GB', triggerPhrase: 'hey browser', aiModel: 'my-model', aiEnabled: true, feedback: 'sound', setupCommandPassed: true, setupVoicePassed: false, voicePace: 'natural' });
  expect(settings).not.toHaveProperty('obsoleteField');
});
it('isolates a corrupt setting and disables an unknown AI provider', () => {
  expect(migrateSettings({ language: 'en-AU', mode: 'obsolete', aiProvider: 'unknown', aiEnabled: true, triggerPhrase: 'browser' })).toMatchObject({ language: 'en-AU', mode: 'power-saver', triggerPhrase: 'browser', aiEnabled: false });
});
it('offers only locally supported contextual examples', () => {
  for (const origin of [undefined, 'https://youtube.com/*', 'https://example.com/*']) for (const example of contextExamples(origin)) expect(parseCommand(example.text), example.text).not.toBeNull();
});
