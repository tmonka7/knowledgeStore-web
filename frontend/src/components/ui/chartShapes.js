/**
 * A bar with only its top corners rounded, so the mark still reads as anchored
 * to the baseline rather than floating.
 */
export const roundedTopBar = (x, y, width, height, radius = 4) => {
  const r = Math.min(radius, width / 2, height);
  return [
    `M${x},${y + height}`,
    `L${x},${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `L${x + width - r},${y}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `L${x + width},${y + height}`,
    'Z',
  ].join(' ');
};
