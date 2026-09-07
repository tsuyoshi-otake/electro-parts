/**
 * The extension icon, drawn from code: a rounded dark tile with the step line
 * a price history actually looks like -- flat stretches, occasional jumps --
 * in the panel's own accent colour.
 *
 * Rendered by 4x supersampling and a box downsample, which is enough
 * anti-aliasing at 16 px and costs nothing at build time.
 */

const BACKGROUND: readonly [number, number, number] = [0x16, 0x1b, 0x22]; // panel dark --bg
const ACCENT: readonly [number, number, number] = [0x6e, 0xa8, 0xff]; // panel dark --accent

/** Normalised polyline: price steps down, holds, steps up, holds. */
const STEPS: readonly (readonly [number, number])[] = [
  [0.16, 0.62],
  [0.34, 0.62],
  [0.34, 0.40],
  [0.53, 0.40],
  [0.53, 0.72],
  [0.72, 0.72],
  [0.72, 0.28],
  [0.84, 0.28],
];

const CORNER_RADIUS = 0.22;
const LINE_HALF_WIDTH = 0.055;
const SUPERSAMPLE = 4;

function insideRoundedSquare(x: number, y: number): boolean {
  const r = CORNER_RADIUS;
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const dx = Math.max(r - x, x - (1 - r), 0);
  const dy = Math.max(r - y, y - (1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax;
  const vy = by - ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * vx + (py - ay) * vy) / lengthSquared));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function onStepLine(x: number, y: number): boolean {
  for (let i = 1; i < STEPS.length; i += 1) {
    const a = STEPS[i - 1];
    const b = STEPS[i];
    if (a === undefined || b === undefined) continue;
    if (distanceToSegment(x, y, a[0], a[1], b[0], b[1]) <= LINE_HALF_WIDTH) return true;
  }
  return false;
}

/** RGBA bytes for a square icon of `size` pixels. */
export function renderIcon(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let tile = 0;
      let line = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) / size;
          const y = (py + (sy + 0.5) / SUPERSAMPLE) / size;
          if (!insideRoundedSquare(x, y)) continue;
          tile += 1;
          if (onStepLine(x, y)) line += 1;
        }
      }
      const alpha = tile / samples;
      const at = (py * size + px) * 4;
      if (alpha === 0) continue;
      // The line is composited over the tile before the tile's own coverage,
      // so an edge pixel fades out instead of showing a hard accent border.
      const lineShare = tile === 0 ? 0 : line / tile;
      for (let c = 0; c < 3; c += 1) {
        pixels[at + c] = Math.round((BACKGROUND[c] ?? 0) * (1 - lineShare) + (ACCENT[c] ?? 0) * lineShare);
      }
      pixels[at + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
}
