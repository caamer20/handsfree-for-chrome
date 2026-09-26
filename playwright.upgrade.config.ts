import config from './playwright.config';
const outputDir = `test-results-upgrade/${process.env.HANDSFREE_UPGRADE_VERSION ?? '1.8.0'}`;
export default { ...config, testMatch: '**/*.upgrade.ts', timeout: 90_000, outputDir, reporter: [['list'], ['json', { outputFile: `${outputDir}/browser-results.json` }]] };
