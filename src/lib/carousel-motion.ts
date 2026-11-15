// Monotone Hermite interpolation follows the supplied corridor reference.
// Distance runs toward zero: small outer cards grow into the full-size center.
const travel = [0, .28, .43, .54, .64];
const scales = [1, .22, .10, .055, .03];
const rotations = [0, 16, 28, 36, 42];
const clamp = (x: number) => Math.max(0, Math.min(1, x));
function interpolate(values: number[], distance: number) {
  const d = Math.max(0, Math.min(values.length - 1, distance));
  const lower = Math.min(Math.floor(d), values.length - 2), t = d - lower;
  const slope = (i: number) => {
    if (i === 0) return values[1] - values[0];
    if (i === values.length - 1) return values[i] - values[i - 1];
    const a = values[i] - values[i - 1], b = values[i + 1] - values[i];
    return a * b <= 0 ? 0 : 2 * a * b / (a + b);
  };
  return (2*t*t*t - 3*t*t + 1)*values[lower] + (t*t*t - 2*t*t + t)*slope(lower)
    + (-2*t*t*t + 3*t*t)*values[lower + 1] + (t*t*t - t*t)*slope(lower + 1);
}
export function carouselFrame(sequence: number, position: number) {
  // Consecutive arrivals alternate sides; each side's cards are two steps apart.
  const distance = (sequence - position) / 2;
  const side = Math.abs(sequence % 2) === 0 ? -1 : 1;
  const opacity = distance < 0 ? 1 - clamp((-distance - .06) / .22) : clamp((4 - distance) * 2);
  return {
    transform: `translateX(${side * interpolate(travel, distance) * 100}%) scale(${interpolate(scales, distance)}) rotateY(${-side * interpolate(rotations, distance)}deg)`,
    opacity,
    zIndex: distance < 0 ? 0 : 100 - Math.round(distance * 20),
  };
}
export function slideIndex(sequence: number, count: number) {
  if (count < 1) return 0;
  return ((sequence % count) + count) % count;
}
