// Immutable observations let asynchronous capture/OCR results prove that they
// still belong to the same active window and geometry before updating state.
function visualContext(window, useClient = true) {
  const rect = useClient ? window?.clientRect : window;
  if (!window || !/^[1-9][0-9]*$/.test(String(window.hwnd)) ||
      !Number.isInteger(window.pid) || window.pid <= 0 ||
      !rect || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect[k])) ||
      rect.width <= 0 || rect.height <= 0 ||
      !Number.isInteger(window.dpi) || window.dpi < 48 || window.dpi > 960) return null;
  return {
    hwnd: String(window.hwnd), pid: window.pid, dpi: window.dpi, useClient,
    rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
    foreground: window.foreground === true, visible: window.visible === true,
    minimized: window.minimized !== false,
  };
}
function sameVisualContext(a, b) {
  if (!a || !b) return a === b;
  return ['hwnd', 'pid', 'dpi', 'useClient', 'foreground', 'visible', 'minimized'].every(k => a[k] === b[k]) &&
    ['x', 'y', 'width', 'height'].every(k => a.rect[k] === b.rect[k]);
}
function isCurrentVisualContext(context, window) {
  return Boolean(context?.foreground && context.visible && !context.minimized &&
    sameVisualContext(context, visualContext(window, context.useClient)));
}
function captureMatchesContext(frame, context) {
  return Boolean(context?.useClient && frame?.hwnd === context.hwnd && frame.pid === context.pid && frame.dpi === context.dpi &&
    frame.clientRect && ['x', 'y', 'width', 'height'].every(k => frame.clientRect[k] === context.rect[k]));
}
function captureIsFresh(frame, now = Date.now(), maxAgeMs = 2500) {
  const at=Date.parse(frame?.capturedAt);
  return Number.isFinite(at)&&Number.isFinite(now)&&Number.isFinite(maxAgeMs)&&maxAgeMs>=0&&at<=now+250&&now-at<=maxAgeMs;
}
function trackingPresentation(result, lastOffer) {
  const offer = {cards: result.cards || [], stable: Boolean(result.stable),
    present: lastOffer?.cards?.length === 3, pendingSelection: result.pendingSelection || null};
  // The tracker intentionally keeps cards for one absent sample. Presence is
  // independent: hide immediately while retaining its two-sample pick logic.
  return {offer, signature: JSON.stringify({result, present: offer.present})};
}
module.exports = {visualContext, sameVisualContext, isCurrentVisualContext, captureMatchesContext, captureIsFresh, trackingPresentation};
