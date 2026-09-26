import { z } from 'zod';
import { hudSchema, settingsSchema } from './schema';
import { recoveryAdvice } from './diagnostics';
import type { AppState } from './types';

const permission = z.enum(['granted', 'denied', 'prompt', 'unavailable']);
const access = z.enum(['allowed', 'not-granted', 'not-applicable', 'unavailable']);
const nonnegative = z.number().int().nonnegative();
export const diagnosticReportSchema = z.object({
  format: z.literal('handsfree-diagnostics'),
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  extension: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+(?:\.\d+)?$/), edition: z.enum(['standard', 'local-ai', 'unknown']) }).strict(),
  environment: z.object({
    os: z.enum(['mac', 'win', 'android', 'cros', 'linux', 'openbsd', 'fuchsia', 'unknown']),
    arch: z.enum(['arm', 'arm64', 'x86-32', 'x86-64', 'mips', 'mips64', 'riscv64', 'unknown']),
    chromiumVersion: z.string().regex(/^\d{1,4}(?:\.\d{1,5}){1,3}$/).nullable(),
  }).strict(),
  preferences: settingsSchema.pick({ mode: true, language: true, listeningMode: true, voicePace: true, feedback: true, dictationPunctuation: true, aiEnabled: true, aiProvider: true, reviewAiActions: true, saveTranscripts: true }).strict(),
  setup: z.object({ shortcutAssigned: z.boolean(), microphonePreviouslyGranted: z.boolean(), typedPracticePassed: z.boolean(), spokenPracticePassed: z.boolean(), microphonePermission: permission }).strict(),
  access: z.object({ currentWebsiteSavedGrant: access, aiProviderSavedGrant: access }).strict(),
  runtime: z.object({
    engineOpen: z.boolean(), listening: z.boolean(), phase: hudSchema.shape.phase,
    awaitingAnswer: z.boolean(), awaitingReview: z.boolean(), dictating: z.boolean(),
    recoveryAvailable: z.boolean(), savedKeyPresent: z.boolean(),
    issueCategory: z.enum(['ai-configuration', 'microphone-permission', 'microphone-device', 'website-access', 'speech-network', 'engine', 'command']).nullable(),
  }).strict(),
  savedItemCounts: z.object({ siteNicknames: nonnegative, websiteRoutines: nonnegative, commandRoutines: nonnegative, workspaces: nonnegative }).strict(),
}).strict();
export type DiagnosticReport = z.infer<typeof diagnosticReportSchema>;
export interface DiagnosticEnvironment {
  extensionVersion: string;
  platform?: Pick<chrome.runtime.PlatformInfo, 'os' | 'arch'>;
  userAgent?: string;
  microphonePermission: DiagnosticReport['setup']['microphonePermission'];
  siteAccess: DiagnosticReport['access']['currentWebsiteSavedGrant'];
  providerAccess: DiagnosticReport['access']['aiProviderSavedGrant'];
}

/** Deliberate allowlist: never serialize AppState, diagnostic details, or error text. */
export function buildDiagnosticReport(state: AppState, environment: DiagnosticEnvironment, now = new Date()): DiagnosticReport {
  const categories: Record<string, DiagnosticReport['runtime']['issueCategory']> = {
    'AI connection': 'ai-configuration', 'Microphone access': 'microphone-permission',
    'Microphone device': 'microphone-device', 'Website access': 'website-access',
    'Speech or network connection': 'speech-network', 'Restart the voice engine': 'engine',
  };
  const preferences = settingsSchema.pick({ mode: true, language: true, listeningMode: true, voicePace: true, feedback: true, dictationPunctuation: true, aiEnabled: true, aiProvider: true, reviewAiActions: true, saveTranscripts: true });
  // pick().strip() copies only the named values, including when future settings grow.
  const selected = preferences.strip().parse(state.settings);
  const os = diagnosticReportSchema.shape.environment.shape.os.safeParse(environment.platform?.os);
  const arch = diagnosticReportSchema.shape.environment.shape.arch.safeParse(environment.platform?.arch);
  return diagnosticReportSchema.parse({
    format: 'handsfree-diagnostics', version: 1, generatedAt: now.toISOString(),
    extension: { version: environment.extensionVersion, edition: state.localAiAvailable === true ? 'local-ai' : state.localAiAvailable === false ? 'standard' : 'unknown' },
    environment: { os: os.success ? os.data : 'unknown', arch: arch.success ? arch.data : 'unknown', chromiumVersion: /(?:Chrome|Chromium)\/(\d{1,4}(?:\.\d{1,5}){1,3})(?:\s|$)/.exec(environment.userAgent ?? '')?.[1] ?? null },
    preferences: selected,
    setup: { shortcutAssigned: !!state.shortcut, microphonePreviouslyGranted: state.settings.micGranted, typedPracticePassed: state.settings.setupCommandPassed, spokenPracticePassed: state.settings.setupVoicePassed, microphonePermission: environment.microphonePermission },
    access: { currentWebsiteSavedGrant: environment.siteAccess, aiProviderSavedGrant: environment.providerAccess },
    runtime: {
      engineOpen: state.engineOpen, listening: state.listening, phase: state.hud.phase,
      awaitingAnswer: !!state.question, awaitingReview: !!state.pending, dictating: !!state.dictation,
      recoveryAvailable: !!state.recovery, savedKeyPresent: state.hasApiKey,
      issueCategory: state.hud.phase === 'error' ? categories[recoveryAdvice(state.hud.text).title] ?? 'command' : null,
    },
    savedItemCounts: { siteNicknames: state.library?.aliases.length ?? 0, websiteRoutines: state.macros.length, commandRoutines: state.routines?.length ?? 0, workspaces: state.library?.workspaces.length ?? 0 },
  });
}
