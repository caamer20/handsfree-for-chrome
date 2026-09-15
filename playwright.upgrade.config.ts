import config from './playwright.config';
export default { ...config, testMatch: '**/*.upgrade.ts', timeout: 90_000, outputDir: 'test-results-upgrade', reporter: [['list'], ['json', { outputFile: 'test-results-upgrade/browser-results.json' }]] };
