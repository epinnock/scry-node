const {
  generateStoryFingerprint,
  addFingerprintsToReport,
  extractFingerprints,
  createFingerprintMap,
  isStoryFailing,
  getFailingFingerprints,
} = require('../lib/fingerprint.js');

describe('lib/fingerprint', () => {
  describe('generateStoryFingerprint()', () => {
    test('returns empty string for null/undefined', () => {
      expect(generateStoryFingerprint(null)).toBe('');
      expect(generateStoryFingerprint(undefined)).toBe('');
    });

    test('returns empty string for non-object input', () => {
      expect(generateStoryFingerprint('string')).toBe('');
      expect(generateStoryFingerprint(123)).toBe('');
    });

    test('returns stable fingerprint for same story input', () => {
      const story = {
        componentPath: 'src/Button.tsx',
        storyId: 'button--primary',
        storyName: 'Primary',
      };

      const fingerprint1 = generateStoryFingerprint(story);
      const fingerprint2 = generateStoryFingerprint(story);

      expect(fingerprint1).toBe(fingerprint2);
      expect(fingerprint1).toHaveLength(16);
    });

    test('returns different fingerprints for different story ids', () => {
      const story1 = {
        componentPath: 'src/Button.tsx',
        storyId: 'button--primary',
        storyName: 'Primary',
      };

      const story2 = {
        componentPath: 'src/Button.tsx',
        storyId: 'button--secondary',
        storyName: 'Secondary',
      };

      expect(generateStoryFingerprint(story1)).not.toBe(generateStoryFingerprint(story2));
    });

    test('uses fallback fields for storyId and storyName', () => {
      const story = {
        componentPath: 'src/Button.tsx',
        id: 'button--primary',
        name: 'Primary',
      };

      const fingerprint = generateStoryFingerprint(story);
      expect(fingerprint).toHaveLength(16);
    });

    test('returns empty string when storyId is missing', () => {
      const story = {
        componentPath: 'src/Button.tsx',
        storyName: 'Primary',
      };

      expect(generateStoryFingerprint(story)).toBe('');
    });

    test('returns empty string when all identifying fields are missing', () => {
      const story = {};
      expect(generateStoryFingerprint(story)).toBe('');
    });

    test('is stable even if other fields change', () => {
      const baseStory = {
        componentPath: 'src/Button.tsx',
        storyId: 'button--primary',
        storyName: 'Primary',
      };

      const storyWithExtra = {
        ...baseStory,
        someOtherField: 'changed',
      };

      expect(generateStoryFingerprint(baseStory)).toBe(generateStoryFingerprint(storyWithExtra));
    });
  });

  describe('addFingerprintsToReport()', () => {
    test('returns input unchanged for null/undefined', () => {
      expect(addFingerprintsToReport(null)).toBeNull();
      expect(addFingerprintsToReport(undefined)).toBeUndefined();
    });

    test('returns input unchanged for non-object', () => {
      expect(addFingerprintsToReport('string')).toBe('string');
      expect(addFingerprintsToReport(123)).toBe(123);
    });

    test('returns input unchanged when stories is not an array', () => {
      const report = { stories: 'not-array' };
      const result = addFingerprintsToReport(report);
      expect(result).toEqual(report);
    });

    test('does not add execution field when execution.stories missing', () => {
      const report = { summary: { metrics: {} } };
      const result = addFingerprintsToReport(report);

      expect(result).toEqual(report);
      expect(Object.prototype.hasOwnProperty.call(result, 'execution')).toBe(false);
    });

    test('adds fingerprints to stories', () => {
      const report = {
        stories: [
          {
            componentPath: 'src/Button.tsx',
            storyId: 'button--primary',
            storyName: 'Primary',
          },
        ],
      };

      const result = addFingerprintsToReport(report);

      expect(result).not.toBe(report);
      expect(result.stories[0].fingerprint).toHaveLength(16);
    });

    test('preserves existing story fingerprints', () => {
      const report = {
        stories: [
          {
            componentPath: 'src/Button.tsx',
            storyId: 'button--primary',
            storyName: 'Primary',
            fingerprint: 'abcdef1234567890',
          },
        ],
      };

      const result = addFingerprintsToReport(report);

      expect(result.stories[0].fingerprint).toBe('abcdef1234567890');
    });

    test('adds fingerprints to execution.stories when present', () => {
      const report = {
        execution: {
          stories: [
            {
              componentPath: 'src/Card.tsx',
              storyId: 'card--default',
              storyName: 'Default',
            },
          ],
        },
      };

      const result = addFingerprintsToReport(report);

      expect(result.execution.stories[0].fingerprint).toHaveLength(16);
    });

    test('preserves stories without fingerprint when storyId missing', () => {
      const story = { componentPath: 'src/Button.tsx' };
      const report = { stories: [story] };

      const result = addFingerprintsToReport(report);
      expect(result.stories[0]).toBe(story);
      expect(result.stories[0].fingerprint).toBeUndefined();
    });

    test('preserves non-object story entries', () => {
      const report = { stories: ['not-an-object'] };
      const result = addFingerprintsToReport(report);

      expect(result.stories[0]).toBe('not-an-object');
    });
  });

  describe('extractFingerprints()', () => {
    test('returns empty set for invalid report', () => {
      expect(extractFingerprints(null).size).toBe(0);
      expect(extractFingerprints({}).size).toBe(0);
    });

    test('extracts fingerprints from report stories', () => {
      const report = {
        stories: [
          { fingerprint: 'abc123' },
          { fingerprint: 'def456' },
          { noFingerprint: true },
        ],
      };

      const fingerprints = extractFingerprints(report);
      expect(fingerprints.size).toBe(2);
      expect(fingerprints.has('abc123')).toBe(true);
      expect(fingerprints.has('def456')).toBe(true);
    });
  });

  describe('createFingerprintMap()', () => {
    test('returns empty map for invalid report', () => {
      expect(createFingerprintMap(null).size).toBe(0);
      expect(createFingerprintMap({}).size).toBe(0);
    });

    test('creates map from fingerprints to stories', () => {
      const story1 = { fingerprint: 'abc123', name: 'Story 1' };
      const story2 = { fingerprint: 'def456', name: 'Story 2' };
      const storyWithoutFingerprint = { name: 'No fingerprint' };
      const report = { stories: [story1, storyWithoutFingerprint, story2] };

      const map = createFingerprintMap(report);
      expect(map.size).toBe(2);
      expect(map.get('abc123')).toBe(story1);
      expect(map.get('def456')).toBe(story2);
      expect(map.has(undefined)).toBe(false);
    });
  });

  describe('isStoryFailing()', () => {
    test('returns false for null/undefined', () => {
      expect(isStoryFailing(null)).toBe(false);
      expect(isStoryFailing(undefined)).toBe(false);
    });

    test('returns false for non-object input', () => {
      expect(isStoryFailing('string')).toBe(false);
      expect(isStoryFailing(123)).toBe(false);
    });

    test('detects failing status strings', () => {
      expect(isStoryFailing({ status: 'failing' })).toBe(true);
      expect(isStoryFailing({ status: 'FAILED' })).toBe(true);
      expect(isStoryFailing({ status: 'error' })).toBe(true);
      expect(isStoryFailing({ status: 'broken' })).toBe(true);
    });

    test('returns false for passing status strings', () => {
      expect(isStoryFailing({ status: 'passing' })).toBe(false);
      expect(isStoryFailing({ status: 'passed' })).toBe(false);
      expect(isStoryFailing({ status: 'success' })).toBe(false);
    });

    test('detects failing via boolean fields', () => {
      expect(isStoryFailing({ passing: false })).toBe(true);
      expect(isStoryFailing({ passing: true })).toBe(false);
      expect(isStoryFailing({ failed: true })).toBe(true);
      expect(isStoryFailing({ failed: false })).toBe(false);
      expect(isStoryFailing({ error: true })).toBe(true);
      expect(isStoryFailing({ error: false })).toBe(false);
    });

    test('returns false when no status fields', () => {
      expect(isStoryFailing({ name: 'Story' })).toBe(false);
    });
  });

  describe('getFailingFingerprints()', () => {
    test('returns empty set for invalid report', () => {
      expect(getFailingFingerprints(null).size).toBe(0);
      expect(getFailingFingerprints({}).size).toBe(0);
    });

    test('returns fingerprints for failing stories only', () => {
      const report = {
        stories: [
          { fingerprint: 'fail1', status: 'failing' },
          { fingerprint: 'pass1', status: 'passing' },
          { fingerprint: 'fail2', failed: true },
          { fingerprint: 'pass2', passing: true },
          { name: 'no fingerprint', status: 'failing' },
        ],
      };

      const failing = getFailingFingerprints(report);
      expect(failing.size).toBe(2);
      expect(failing.has('fail1')).toBe(true);
      expect(failing.has('fail2')).toBe(true);
    });
  });
});
