const { createFingerprintMap, getFailingFingerprints } = require('./fingerprint.js');

/**
 * @typedef {Object} TransitionDetails
 * @property {string} fingerprint
 * @property {string|null} errorFingerprint
 * @property {string} transition
 * @property {string} previousStatus
 * @property {string} currentStatus
 * @property {string|null} storyId
 * @property {string|null} storyName
 * @property {string|null} componentPath
 */

/**
 * @typedef {Object} TransitionResult
 * @property {Object} transitions
 * @property {string[]} transitions.fixed
 * @property {string[]} transitions.broken
 * @property {string[]} transitions.stillFailing
 * @property {string[]} transitions.stillPassing
 * @property {string[]} transitions.newFailures
 * @property {string[]} transitions.newPassing
 * @property {string[]} transitions.removedWhileFailing
 * @property {string[]} transitions.removedWhilePassing
 * @property {Object} summary
 * @property {number} summary.totalFixed
 * @property {number} summary.totalBroken
 * @property {number} summary.totalStillFailing
 * @property {number} summary.totalStillPassing
 * @property {number} summary.totalNewFailures
 * @property {number} summary.totalNewPassing
 * @property {number} summary.totalRemovedWhileFailing
 * @property {number} summary.totalRemovedWhilePassing
 * @property {Object.<string, TransitionDetails>} details
 */

const TRANSITION_TYPES = {
  FIXED: 'FIXED',
  BROKEN: 'BROKEN',
  STILL_FAILING: 'STILL_FAILING',
  STILL_PASSING: 'STILL_PASSING',
  NEW_FAILURE: 'NEW_FAILURE',
  NEW_PASSING: 'NEW_PASSING',
  REMOVED_WHILE_FAILING: 'REMOVED_WHILE_FAILING',
  REMOVED_WHILE_PASSING: 'REMOVED_WHILE_PASSING',
};

/**
 * Compute story lifecycle transitions between two coverage reports.
 *
 * @param {any|null} previousReport - Previous coverage report
 * @param {any|null} currentReport - Current coverage report
 * @returns {TransitionResult}
 */
function computeTransitions(previousReport, currentReport) {
  const previousFailing = getFailingFingerprints(previousReport);
  const currentFailing = getFailingFingerprints(currentReport);

  const previousMap = createFingerprintMap(previousReport);
  const currentMap = createFingerprintMap(currentReport);

  const transitions = {
    fixed: [],
    broken: [],
    stillFailing: [],
    stillPassing: [],
    newFailures: [],
    newPassing: [],
    removedWhileFailing: [],
    removedWhilePassing: [],
  };

  const details = {};

  const allFingerprints = new Set([
    ...previousMap.keys(),
    ...currentMap.keys(),
  ]);

  for (const fingerprint of allFingerprints) {
    const wasFailing = previousFailing.has(fingerprint);
    const isFailing = currentFailing.has(fingerprint);
    const existedBefore = previousMap.has(fingerprint);
    const existsNow = currentMap.has(fingerprint);

    let transitionType = null;

    if (existedBefore) {
      if (existsNow) {
        if (wasFailing && !isFailing) {
          transitionType = TRANSITION_TYPES.FIXED;
          transitions.fixed.push(fingerprint);
        } else if (!wasFailing && isFailing) {
          transitionType = TRANSITION_TYPES.BROKEN;
          transitions.broken.push(fingerprint);
        } else if (wasFailing && isFailing) {
          transitionType = TRANSITION_TYPES.STILL_FAILING;
          transitions.stillFailing.push(fingerprint);
        } else {
          transitionType = TRANSITION_TYPES.STILL_PASSING;
          transitions.stillPassing.push(fingerprint);
        }
      } else {
        transitionType = wasFailing
          ? TRANSITION_TYPES.REMOVED_WHILE_FAILING
          : TRANSITION_TYPES.REMOVED_WHILE_PASSING;

        if (wasFailing) {
          transitions.removedWhileFailing.push(fingerprint);
        } else {
          transitions.removedWhilePassing.push(fingerprint);
        }
      }
    } else if (existsNow) {
      if (isFailing) {
        transitionType = TRANSITION_TYPES.NEW_FAILURE;
        transitions.newFailures.push(fingerprint);
      } else {
        transitionType = TRANSITION_TYPES.NEW_PASSING;
        transitions.newPassing.push(fingerprint);
      }
    }

    const story = currentMap.get(fingerprint) || previousMap.get(fingerprint);
    const storyId = story?.storyId || story?.id || null;
    const storyName = story?.storyName || story?.name || null;
    const componentPath = story?.componentPath || story?.filePath || null;
    const errorFingerprint = story?.errorFingerprint || null;

    details[fingerprint] = {
      fingerprint,
      errorFingerprint,
      transition: transitionType,
      previousStatus: wasFailing ? 'failing' : 'passing',
      currentStatus: isFailing ? 'failing' : 'passing',
      storyId,
      storyName,
      componentPath,
      isOrphan: !existedBefore || !existsNow,
    };
  }

  const summary = {
    totalFixed: transitions.fixed.length,
    totalBroken: transitions.broken.length,
    totalStillFailing: transitions.stillFailing.length,
    totalStillPassing: transitions.stillPassing.length,
    totalNewFailures: transitions.newFailures.length,
    totalNewPassing: transitions.newPassing.length,
    totalRemovedWhileFailing: transitions.removedWhileFailing.length,
    totalRemovedWhilePassing: transitions.removedWhilePassing.length,
  };

  return {
    transitions,
    summary,
    details,
  };
}

module.exports = {
  TRANSITION_TYPES,
  computeTransitions,
};
