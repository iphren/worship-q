/**
 * The built-in **Default** background: a rose and violet aurora drifting across the top of
 * a dark screen, with a teal glow along the bottom, drawn on a canvas as it plays rather
 * than shipped as a video. Every movement completes a whole number of cycles in one
 * period, and the moment in the period comes from the clock, so it never jumps and every
 * screen showing it moves together.
 *
 * Each band of light is a soft ellipse: a Gaussian with the spread of the ellipse blurred,
 * painted as a radial gradient, which every browser draws quickly and alike.
 */

/** One full cycle of the movement. */
export const AURORA_PERIOD_MS = 30_000;

/** The design's own size; the drawing covers any other the way an image would. */
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;
const TAU = Math.PI * 2;

/** Top to bottom: plum, near black, and a dark teal. */
const SKY: [number, string][] = [
  [0, '#12081a'],
  [0.6, '#0b0816'],
  [1, '#07101a'],
];

/** The aurora's bands: centre x, y, radii, tilt in degrees, color and opacity. */
const BANDS: [number, number, number, number, number, string, number][] = [
  [-93, 162, 296, 56, -4.2, '#d66fa6', 0.141],
  [206, 243, 319, 45, 5.0, '#a07ae0', 0.141],
  [437, 258, 321, 62, 5.8, '#e08aa0', 0.126],
  [731, 210, 338, 52, 8.3, '#d66fa6', 0.143],
  [975, 153, 239, 70, -3.1, '#a07ae0', 0.171],
  [1301, 115, 327, 77, 3.5, '#e08aa0', 0.201],
  [1547, 112, 257, 63, 9.5, '#d66fa6', 0.215],
  [1820, 181, 258, 77, -7.1, '#a07ae0', 0.159],
  [2084, 220, 302, 76, 6.6, '#e08aa0', 0.12],
];
const BAND_BLUR = 55;

const GLOW = { x: 960, y: 1160, rx: 1100, ry: 220, color: '#2f9fb0', opacity: 0.14, blur: 100 };

export interface AuroraLight {
  x: number;
  y: number;
  /** Spread of the light along and across its tilt, in design pixels. */
  sx: number;
  sy: number;
  /** Radians. */
  angle: number;
  color: string;
  /** Brightness at the centre, from 0 to 1. */
  alpha: number;
}

/** A blurred ellipse as a Gaussian of the same spread, no brighter than the ellipse. */
function light(
  x: number,
  y: number,
  rx: number,
  ry: number,
  degrees: number,
  color: string,
  opacity: number,
  blur: number,
): AuroraLight {
  const sx = Math.sqrt((rx * rx) / 3 + blur * blur);
  const sy = Math.sqrt((ry * ry) / 3 + blur * blur);
  const alpha = Math.min(opacity, (opacity * rx * ry) / (2 * sx * sy));
  return { x, y, sx, sy, angle: (degrees * Math.PI) / 180, color, alpha };
}

/** The lights at a moment, `phase` going from 0 to 1 over one period and then repeating. */
export function auroraLights(phase: number): AuroraLight[] {
  const p = phase - Math.floor(phase);
  const wave = (cycles: number, offset: number) => Math.sin(TAU * cycles * p + offset);
  const lights = [
    light(
      GLOW.x + 70 * wave(1, 0),
      GLOW.y,
      GLOW.rx,
      GLOW.ry,
      0,
      GLOW.color,
      GLOW.opacity * (1 + 0.25 * wave(1, 1.3)),
      GLOW.blur,
    ),
  ];
  BANDS.forEach(([x, y, rx, ry, tilt, color, opacity], i) => {
    // Fixed offsets, spread around the circle, so no two bands move in step.
    const q = (j: number) => (i * 2.39996 + j * 1.71) % TAU;
    lights.push(
      light(
        x + 90 * wave(1, q(0)),
        y + 22 * wave(2, q(1)),
        rx * (1 + 0.12 * wave(1, q(2))),
        ry,
        tilt + 6 * wave(1, q(3)),
        color,
        opacity * (1 + 0.35 * wave((i % 2) + 1, q(4))),
        BAND_BLUR,
      ),
    );
  });
  return lights;
}

/** The phase now, the same on every screen whose clock agrees. */
export function auroraPhase(now = Date.now()): number {
  return (now % AURORA_PERIOD_MS) / AURORA_PERIOD_MS;
}

/** The sky's colors as a CSS gradient, shown until the first drawing. */
export const AURORA_SKY_CSS = `linear-gradient(${SKY.map(([at, color]) => `${color} ${at * 100}%`).join(', ')})`;

/** Draws the aurora at `phase` over the whole of a 2D context's canvas. */
export function createAuroraPainter(context: CanvasRenderingContext2D) {
  // A unit Gaussian, three spreads wide, per color; scaled into place by the transform.
  const gradients = new Map<string, CanvasGradient>();
  const gaussian = (color: string) => {
    let gradient = gradients.get(color);
    if (!gradient) {
      gradient = context.createRadialGradient(0, 0, 0, 0, 0, 3);
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16));
      for (let k = 0; k <= 12; k++) {
        const t = k / 12;
        const a = k === 12 ? 0 : Math.exp(-((3 * t) ** 2) / 2);
        gradient.addColorStop(t, `rgba(${r}, ${g}, ${b}, ${a.toFixed(4)})`);
      }
      gradients.set(color, gradient);
    }
    return gradient;
  };
  let sky: { gradient: CanvasGradient; height: number } | null = null;

  return (phase: number) => {
    const { width, height } = context.canvas;
    if (!width || !height) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    if (sky?.height !== height) {
      const gradient = context.createLinearGradient(0, 0, 0, height);
      for (const [at, color] of SKY) gradient.addColorStop(at, color);
      sky = { gradient, height };
    }
    context.fillStyle = sky.gradient;
    context.fillRect(0, 0, width, height);
    // Cover the canvas, as an image background would, centred.
    const scale = Math.max(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
    const left = (width - DESIGN_WIDTH * scale) / 2;
    const top = (height - DESIGN_HEIGHT * scale) / 2;
    for (const l of auroraLights(phase)) {
      context.setTransform(1, 0, 0, 1, left + l.x * scale, top + l.y * scale);
      context.rotate(l.angle);
      context.scale(l.sx * scale, l.sy * scale);
      context.globalAlpha = l.alpha;
      context.fillStyle = gaussian(l.color);
      context.fillRect(-3, -3, 6, 6);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
  };
}
