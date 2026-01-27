const { computeTransitions, TRANSITION_TYPES } = require('../lib/transitions.js');

describe('lib/transitions', () => {
  describe('computeTransitions()', () => {
    test('returns empty transitions for null reports', () => {
      const result = computeTransitions(null, null);

      expect(result.transitions.fixed).toEqual([]);
      expect(result.transitions.broken).toEqual([]);
      expect(result.transitions.stillFailing).toEqual([]);
      expect(result.transitions.stillPassing).toEqual([]);
      expect(result.transitions.newFailures).toEqual([]);
      expect(result.transitions.newPassing).toEqual([]);
      expect(result.transitions.removedWhileFailing).toEqual([]);
      expect(result.transitions.removedWhilePassing).toEqual([]);
      expect(result.summary.totalFixed).toBe(0);
      expect(Object.keys(result.details)).toHaveLength(0);
    });

    test('detects fixed transitions (failing -> passing)', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-1', status: 'failing', storyId: 's1' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-1', status: 'passing', storyId: 's1' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.fixed).toEqual(['story-1']);
      expect(result.details['story-1'].transition).toBe(TRANSITION_TYPES.FIXED);
      expect(result.details['story-1'].previousStatus).toBe('failing');
      expect(result.details['story-1'].currentStatus).toBe('passing');
    });

    test('detects broken transitions (passing -> failing)', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-2', status: 'passing', storyId: 's2' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-2', status: 'failing', storyId: 's2' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.broken).toEqual(['story-2']);
      expect(result.details['story-2'].transition).toBe(TRANSITION_TYPES.BROKEN);
    });

    test('detects still failing transitions', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-3', status: 'failing', storyId: 's3' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-3', status: 'failed', storyId: 's3' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.stillFailing).toEqual(['story-3']);
      expect(result.details['story-3'].transition).toBe(TRANSITION_TYPES.STILL_FAILING);
    });

    test('detects still passing transitions', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-4', status: 'passing', storyId: 's4' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-4', status: 'passed', storyId: 's4' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.stillPassing).toEqual(['story-4']);
      expect(result.details['story-4'].transition).toBe(TRANSITION_TYPES.STILL_PASSING);
    });

    test('detects new failures', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-5', status: 'passing', storyId: 's5' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-5', status: 'passing', storyId: 's5' },
          { fingerprint: 'story-6', status: 'failing', storyId: 's6' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.newFailures).toEqual(['story-6']);
      expect(result.details['story-6'].transition).toBe(TRANSITION_TYPES.NEW_FAILURE);
    });

    test('detects new passing stories (non-failing path)', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-5b', status: 'passing', storyId: 's5b' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-5b', status: 'passing', storyId: 's5b' },
          { fingerprint: 'story-6b', status: 'passing', storyId: 's6b' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.newPassing).toEqual(['story-6b']);
      expect(result.details['story-6b'].transition).toBe(TRANSITION_TYPES.NEW_PASSING);
    });

    test('covers removed while passing with non-failing previous status', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-removed-pass-2', status: 'passing', storyId: 'sremovedpass2' },
        ],
      };

      const current = {
        stories: [],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.removedWhilePassing).toContain('story-removed-pass-2');
      expect(result.details['story-removed-pass-2'].transition).toBe(TRANSITION_TYPES.REMOVED_WHILE_PASSING);
    });

    test('covers new passing branch with explicit passing status', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-base-2', status: 'passing', storyId: 'sbase2' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-base-2', status: 'passing', storyId: 'sbase2' },
          { fingerprint: 'story-new-pass-2', status: 'passing', storyId: 'snewpass2' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.newPassing).toContain('story-new-pass-2');
      expect(result.details['story-new-pass-2'].transition).toBe(TRANSITION_TYPES.NEW_PASSING);
    });

    test('covers new failure branch with no previous stories', () => {
      const previous = {
        stories: [],
      };

      const current = {
        stories: [
          { fingerprint: 'story-new-fail-only', status: 'failing', storyId: 'snewfailonly' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.newFailures).toContain('story-new-fail-only');
      expect(result.details['story-new-fail-only'].transition).toBe(TRANSITION_TYPES.NEW_FAILURE);
    });

    test('covers new failure and new passing branching', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-base', status: 'passing', storyId: 'sbase' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-base', status: 'passing', storyId: 'sbase' },
          { fingerprint: 'story-new-fail', status: 'failing', storyId: 'snewfail' },
          { fingerprint: 'story-new-pass', status: 'passing', storyId: 'snewpass' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.newFailures).toContain('story-new-fail');
      expect(result.transitions.newPassing).toContain('story-new-pass');
      expect(result.details['story-new-fail'].transition).toBe(TRANSITION_TYPES.NEW_FAILURE);
      expect(result.details['story-new-pass'].transition).toBe(TRANSITION_TYPES.NEW_PASSING);
    });

    test('detects new passing stories', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-7', status: 'failing', storyId: 's7' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-7', status: 'failing', storyId: 's7' },
          { fingerprint: 'story-8', status: 'passing', storyId: 's8' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.newPassing).toEqual(['story-8']);
      expect(result.details['story-8'].transition).toBe(TRANSITION_TYPES.NEW_PASSING);
    });

    test('detects removed stories when missing from current report', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-9', status: 'failing', storyId: 's9' },
          { fingerprint: 'story-10', status: 'passing', storyId: 's10' },
        ],
      };

      const current = {
        stories: [],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.removedWhileFailing).toEqual(['story-9']);
      expect(result.transitions.removedWhilePassing).toEqual(['story-10']);
      expect(result.details['story-9'].transition).toBe(TRANSITION_TYPES.REMOVED_WHILE_FAILING);
      expect(result.details['story-10'].transition).toBe(TRANSITION_TYPES.REMOVED_WHILE_PASSING);
    });

    test('covers removed while passing branch with empty previous status', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-9b', status: 'passing', storyId: 's9b' },
          { fingerprint: 'story-10b', status: 'passing', storyId: 's10b' },
        ],
      };

      const current = {
        stories: [],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.removedWhilePassing).toContain('story-9b');
      expect(result.transitions.removedWhilePassing).toContain('story-10b');
    });

    test('detects removed while failing path', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-removed-failing', status: 'failing', storyId: 'sremovedfail' },
        ],
      };

      const current = {
        stories: [],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.removedWhileFailing).toEqual(['story-removed-failing']);
      expect(result.details['story-removed-failing'].transition).toBe(TRANSITION_TYPES.REMOVED_WHILE_FAILING);
    });

    test('covers removed while passing via still passing transition', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-removed-pass', status: 'passing', storyId: 'sremovedpass' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-removed-pass', status: 'passing', storyId: 'sremovedpass' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.stillPassing).toEqual(['story-removed-pass']);
      expect(result.details['story-removed-pass'].transition).toBe(TRANSITION_TYPES.STILL_PASSING);
    });

    test('detects removed stories (failing and passing)', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-9', status: 'failing', storyId: 's9' },
          { fingerprint: 'story-10', status: 'passing', storyId: 's10' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-9', status: 'passing' },
          { fingerprint: 'story-10', status: 'passing' },
          { fingerprint: 'story-11', status: 'failing' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.fixed).toEqual(['story-9']);
      expect(result.transitions.stillPassing).toEqual(['story-10']);
      expect(result.details['story-9'].transition).toBe(TRANSITION_TYPES.FIXED);
      expect(result.details['story-9'].isOrphan).toBe(false);
      expect(result.details['story-10'].transition).toBe(TRANSITION_TYPES.STILL_PASSING);
      expect(result.transitions.newFailures).toEqual(['story-11']);
      expect(result.details['story-11'].transition).toBe(TRANSITION_TYPES.NEW_FAILURE);
    });

    test('uses empty story details when fingerprint not present in maps', () => {
      const previous = {
        stories: [
          { fingerprint: 'ghost', failed: true },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'ghost', status: 'passing' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.details['ghost']).toBeDefined();
      expect(result.details['ghost'].storyId).toBeNull();
      expect(result.details['ghost'].storyName).toBeNull();
      expect(result.details['ghost'].componentPath).toBeNull();
      expect(result.details['ghost'].errorFingerprint).toBeNull();
    });

    test('detects removed while passing path', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-removed', status: 'passing', storyId: 'sremoved' },
        ],
      };

      const current = {
        stories: [],
      };

      const result = computeTransitions(previous, current);

      expect(result.transitions.removedWhilePassing).toEqual(['story-removed']);
      expect(result.details['story-removed'].transition).toBe(TRANSITION_TYPES.REMOVED_WHILE_PASSING);
      expect(result.details['story-removed'].isOrphan).toBe(true);
    });

    test('uses previous story details when current story missing', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-prev', status: 'passing', storyId: 'prev-id', storyName: 'Prev', componentPath: 'prev/path' },
        ],
      };

      const current = {
        stories: [],
      };

      const result = computeTransitions(previous, current);

      expect(result.details['story-prev'].storyId).toBe('prev-id');
      expect(result.details['story-prev'].storyName).toBe('Prev');
      expect(result.details['story-prev'].componentPath).toBe('prev/path');
    });

    test('populates details with story info from current report if available', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-11', status: 'failing', storyId: 'old', storyName: 'Old', componentPath: 'old' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-11', status: 'passing', storyId: 'new', storyName: 'New', componentPath: 'new' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.details['story-11'].storyId).toBe('new');
      expect(result.details['story-11'].storyName).toBe('New');
      expect(result.details['story-11'].componentPath).toBe('new');
    });

    test('includes errorFingerprint when present', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-error', status: 'failing', storyId: 'old', errorFingerprint: 'err-old' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-error', status: 'passing', storyId: 'new', errorFingerprint: 'err-new' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.details['story-error'].errorFingerprint).toBe('err-new');
    });

    test('summary counts match transitions', () => {
      const previous = {
        stories: [
          { fingerprint: 'story-12', status: 'failing' },
          { fingerprint: 'story-13', status: 'passing' },
        ],
      };

      const current = {
        stories: [
          { fingerprint: 'story-12', status: 'passing' },
          { fingerprint: 'story-13', status: 'failing' },
          { fingerprint: 'story-14', status: 'passing' },
        ],
      };

      const result = computeTransitions(previous, current);

      expect(result.summary.totalFixed).toBe(1);
      expect(result.summary.totalBroken).toBe(1);
      expect(result.summary.totalNewPassing).toBe(1);
    });

    test('handles transitions based on map presence only', () => {
      // Previous report with failing fingerprint, current report null (no map)
      const previous = {
        stories: [{ fingerprint: 'story-15', failed: true }],
      };

      const current = null;

      const result = computeTransitions(previous, current);

      // Removed while failing because it existed before and now missing
      expect(result.transitions.removedWhileFailing).toContain('story-15');
    });
  });

  describe('TRANSITION_TYPES', () => {
    test('exposes expected transition type constants', () => {
      expect(TRANSITION_TYPES.FIXED).toBe('FIXED');
      expect(TRANSITION_TYPES.BROKEN).toBe('BROKEN');
      expect(TRANSITION_TYPES.STILL_FAILING).toBe('STILL_FAILING');
      expect(TRANSITION_TYPES.NEW_FAILURE).toBe('NEW_FAILURE');
      expect(TRANSITION_TYPES.REMOVED_WHILE_FAILING).toBe('REMOVED_WHILE_FAILING');
    });
  });
});
