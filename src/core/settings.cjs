const DEFAULTS = Object.freeze({ leaguePath: '', autoFollow: true, autoOverlay: true,
  autoScan: true, manualChampion: 'ahri', opacity: 0.94, anchor: 'top-right', displayId: null,
  ocrRegion: { x: 0.15, y: 0.25, width: 0.7, height: 0.48 } });
function validateSettings(input, current = DEFAULTS) {
  const next = { ...DEFAULTS, ...current };
  for (const key of ['autoFollow', 'autoOverlay', 'autoScan']) if (typeof input[key] === 'boolean') next[key] = input[key];
  if (typeof input.leaguePath === 'string' && input.leaguePath.length < 1000) next.leaguePath = input.leaguePath.trim();
  if (typeof input.manualChampion === 'string' && /^[a-z0-9]+$/.test(input.manualChampion)) next.manualChampion = input.manualChampion;
  if (typeof input.opacity === 'number' && Number.isFinite(input.opacity)) next.opacity = Math.max(0.5, Math.min(1, input.opacity));
  if (['top-right', 'top-left', 'bottom-right', 'bottom-left'].includes(input.anchor)) next.anchor = input.anchor;
  if (input.displayId === null || Number.isInteger(input.displayId)) next.displayId = input.displayId;
  if (input.ocrRegion) {
    const r = input.ocrRegion;
    if ([r.x, r.y, r.width, r.height].every(n => typeof n === 'number' && Number.isFinite(n)) &&
        r.x >= 0 && r.y >= 0 && r.width >= .05 && r.height >= .05 && r.x + r.width <= 1.001 && r.y + r.height <= 1.001) next.ocrRegion = { x: r.x, y: r.y, width: r.width, height: r.height };
    else throw new Error('识别区域必须位于窗口内，宽高至少为 5%');
  }
  return next;
}
function overlayBounds(area, anchor) {
  const width = Math.min(366, area.width - 24), height = Math.min(610, area.height - 32);
  return { width, height, x: anchor.endsWith('right') ? area.x + area.width - width - 16 : area.x + 16,
    y: anchor.startsWith('bottom') ? area.y + area.height - height - 16 : area.y + 16 };
}
module.exports = { DEFAULTS, validateSettings, overlayBounds };
