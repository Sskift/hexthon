const clamp = (n, min, max) => Math.min(Math.max(n, min), Math.max(min, max));
function cardBounds(window, card) {
  if (!window || window.width < 640 || window.height < 400 || !card?.rect) return null;
  const r = card.rect;
  if (![r.x,r.y,r.width,r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) return null;
  const width = Math.round(clamp(window.width * r.width * .88, 190, 270));
  const height = 116;
  // Use whitespace above the estimated card. Keep titles and lower reroll controls unobstructed.
  let x = window.x + (r.x + r.width / 2) * window.width - width / 2;
  let y = window.y + r.y * window.height - height - 10;
  if (y < window.y + 8) y = window.y + (r.y + r.height) * window.height + 8;
  return { x: Math.round(clamp(x, window.x + 8, window.x + window.width - width - 8)),
    y: Math.round(clamp(y, window.y + 8, window.y + window.height - height - 8)), width, height };
}
function companionBounds(window, phase) {
  if (!window) return null;
  const width = Math.min(320, Math.round(window.width * .27));
  const height = Math.min(590, window.height - 30);
  // Beside the champion selection area or at the game's outer right margin.
  return { x: Math.round(window.x + window.width - width - 12), y: Math.round(window.y + (phase === 'ChampSelect' ? 48 : 18)),
    width, height: Math.max(220, height - (phase === 'ChampSelect' ? 48 : 0)) };
}
module.exports = { cardBounds, companionBounds };
