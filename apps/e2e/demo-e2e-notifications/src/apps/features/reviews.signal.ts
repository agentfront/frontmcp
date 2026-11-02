import { fileSignal } from '@frontmcp/sdk';

/** The JSON file the settings tool writes and the reviews feature follows. */
export const featuresFile = process.env['FEATURES_FILE'] ?? 'features.json';

export const reviewsEnabled = fileSignal(featuresFile, 'reviews', {
  pollIntervalMs: 250,
  remedy: { say: 'Turn on Reviews in Settings', tool: 'settings_set', args: { feature: 'reviews', on: true } },
});
