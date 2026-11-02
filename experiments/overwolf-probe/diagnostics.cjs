const { LOL_GAME_ID, GepMayhemTracker } = require('../../src/core/gep-mayhem.cjs');

// Count a notification separately from usable content. GEP may send null/reset
// values when registering even though no candidate or selection was observed.
function classifyMayhemUpdate(gameId, data, catalog) {
  const result = { fieldUpdate: false, validContent: false, mappedCandidates: false, mappedPick: false };
  if (gameId !== LOL_GAME_ID || !data || typeof data !== 'object' || Array.isArray(data) ||
    (data.gameId !== undefined && data.gameId !== LOL_GAME_ID) || data.feature !== 'augments' ||
    data.category !== 'me' || !['augments', 'picked_augment'].includes(data.key)) return result;
  result.fieldUpdate = true;
  // A fresh parser ensures earlier good candidates cannot make a later bad
  // payload look valid. Only its bounded, sanitized output determines success.
  const state = new GepMayhemTracker({ catalog }).observeInfo(gameId, data);
  if (data.key === 'augments') {
    result.validContent = state.offersValid === true && state.offers.length > 0;
    result.mappedCandidates = state.offersComplete;
  } else {
    result.validContent = state.observedPicks.length + state.unmappedPicks.length > 0;
    result.mappedPick = state.observedPicks.length > 0;
  }
  return result;
}

function createSdkDiagnostics() {
  let tail = '';
  const signals = { missingCredentials: false, validationFailure: false };
  return {
    observe(chunk) {
      // Keep a small boundary suffix in memory so a split diagnostic phrase is
      // recognized. Raw SDK text is never returned or written to a file.
      const text = tail + String(chunk);
      signals.missingCredentials ||= /no.{0,40}(?:dev.key|credential)|missing.{0,40}(?:credential|dev.key)|credentials?.{0,40}(?:missing|not (?:set|found|provided))/i.test(text);
      signals.validationFailure ||= /signature|integrity|authentication|unauthori[sz]ed|dev.mode.{0,50}(?:fail|invalid)/i.test(text);
      tail = text.slice(-160);
    },
    snapshot() { return { ...signals }; },
  };
}

module.exports = { classifyMayhemUpdate, createSdkDiagnostics };
