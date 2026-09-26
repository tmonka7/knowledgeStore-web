/**
 * Raster to SVG — real tracing, not a raster wrapped in an `<svg>` tag.
 *
 * Plenty of "convert to SVG" tools hand back a PNG inside an SVG element. The
 * file has the right extension and none of the properties anybody wanted one
 * for: it does not scale, it cannot be recoloured, and it is larger than what
 * went in. So this traces outlines instead.
 *
 * The method is the straightforward one that suits flat artwork:
 *
 *   1. reduce the image to a small palette,
 *   2. for each colour, walk the boundary between its pixels and everything
 *      else, giving closed polygons on the pixel grid,
 *   3. drop the points that do not change the shape,
 *   4. emit one <path> per colour.
 *
 * Which means it is good at logos, icons, screenshots and line art, and bad at
 * photographs — a photograph has no flat regions to find, so it comes back as
 * thousands of blotches, larger than the original and worse to look at. The UI
 * says so rather than letting people discover it one 12MB file at a time.
 */

// Absolute (with origin) on purpose: in dev, Vite appends ?import to a
// root-relative dynamic import, which makes it treat a /public file as source
// and refuse to serve it. A full URL is passed through untouched.
const GIFENC_URL = new URL('/gifenc/gifenc.esm.js', self.location.origin).href;

/*
 * Tracing happens at this size at most, whatever the output size is.
 *
 * Work is proportional to pixel count, and past about this point extra pixels
 * stop adding shape and start adding noise along every edge — more points, a
 * bigger file, no more detail. The SVG carries a viewBox, so the result still
 * scales to any requested size without being traced at it.
 */
const TRACE_MAX = 800;

/** Below this, a pixel is treated as not there rather than as a colour. */
const ALPHA_FLOOR = 128;

const hex = (r, g, b) => `#${[r, g, b].map((value) => Math.max(0, Math.min(255, Math.round(value)))
  .toString(16)
  .padStart(2, '0')).join('')}`;

/**
 * Ramer–Douglas–Peucker, with an explicit stack.
 *
 * Recursion would be the obvious way to write this and would also blow the
 * stack on a long boundary — a detailed outline traced at 800px can run to
 * tens of thousands of points before it is simplified.
 */
const simplify = (points, tolerance) => {
  if (points.length < 3 || tolerance <= 0) return points;

  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;

  const stack = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;

  while (stack.length) {
    const [first, last] = stack.pop();
    if (last - first < 2) continue;

    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;

    let worst = 0;
    let worstIndex = -1;

    for (let index = first + 1; index < last; index += 1) {
      const [px, py] = points[index];
      let distanceSquared;

      if (lengthSquared === 0) {
        distanceSquared = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        // Distance from the point to the segment, squared — no square roots in
        // the inner loop of the hottest function here.
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
        distanceSquared = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }

      if (distanceSquared > worst) {
        worst = distanceSquared;
        worstIndex = index;
      }
    }

    if (worstIndex !== -1 && worst > toleranceSquared) {
      keep[worstIndex] = 1;
      stack.push([first, worstIndex], [worstIndex, last]);
    }
  }

  return points.filter((_, index) => keep[index]);
};

/**
 * Every closed boundary of one colour, as polygons on the pixel grid.
 *
 * Each filled pixel contributes the sides that face a pixel of some other
 * colour, wound clockwise. Chaining those segments end to end gives closed
 * loops, and the winding falls out of it: outer boundaries come back clockwise
 * and holes anticlockwise, which is exactly what fill-rule="evenodd" needs to
 * punch the holes out.
 */
const traceColour = (indices, width, height, target) => {
  const stride = width + 1;
  const edges = new Map();

  const addEdge = (x0, y0, x1, y1) => {
    const key = y0 * stride + x0;
    const list = edges.get(key);
    if (list) list.push(x1, y1);
    else edges.set(key, [x1, y1]);
  };

  const isTarget = (x, y) => x >= 0 && y >= 0 && x < width && y < height
    && indices[y * width + x] === target;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (indices[y * width + x] !== target) continue;
      if (!isTarget(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!isTarget(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!isTarget(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!isTarget(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const loops = [];
  const limit = width * height * 4 + 8;

  /*
   * A worklist rather than a walk over the map.
   *
   * Where two regions of this colour touch only at a corner, that corner has
   * two boundaries running through it. Tracing one of them consumes a single
   * edge and leaves the other behind — and a plain pass over the map would
   * already have moved past that corner and never come back, silently losing
   * a shape. A corner goes back on the list whenever it still has edges.
   */
  const pending = [...edges.keys()];

  while (pending.length) {
    const startKey = pending.pop();
    const startList = edges.get(startKey);
    if (!startList?.length) continue;

    const startX = startKey % stride;
    const startY = (startKey - startX) / stride;

    const loop = [[startX, startY]];
    let y = startList.pop();
    let x = startList.pop();
    if (startList.length) pending.push(startKey);

    // A guard, not a condition: the walk closes on its own for any well-formed
    // boundary, and this only stops a malformed one from hanging the tab.
    let guard = 0;

    while ((x !== startX || y !== startY) && guard < limit) {
      loop.push([x, y]);
      const key = y * stride + x;
      const list = edges.get(key);
      if (!list?.length) break;
      y = list.pop();
      x = list.pop();
      if (list.length) pending.push(key);
      guard += 1;
    }

    loops.push(loop);
  }

  return loops;
};

const pathData = (loops, tolerance) => {
  const parts = [];

  loops.forEach((loop) => {
    // Closed for the simplifier's benefit — it treats the run as a polyline
    // and would otherwise be free to discard the corner the loop starts on.
    const simplified = simplify([...loop, loop[0]], tolerance);
    if (simplified.length < 4) return;

    // The repeated closing point goes again; `Z` says it better.
    const points = simplified.slice(0, -1);
    parts.push(`M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`);
  });

  return parts.join('');
};

/**
 * Traces `image` and returns SVG markup.
 *
 * @param image       a drawable source (HTMLImageElement or canvas)
 * @param width/height the size the SVG declares; the viewBox scales to it
 * @param colours     palette size, 2..64
 * @param detail      0..100, how much of the outline detail to keep
 * @param background  CSS colour to flatten onto, or null to keep transparency
 */
export const traceToSvg = async ({
  image,
  width,
  height,
  colours = 12,
  detail = 60,
  background = null,
}) => {
  const { quantize, applyPalette } = await import(/* @vite-ignore */ GIFENC_URL);

  // Traced at its own size and scaled by the viewBox, so a huge output size
  // costs nothing and a huge input does not drown the tracer in edge noise.
  const scale = Math.min(1, TRACE_MAX / Math.max(width, height));
  const traceWidth = Math.max(1, Math.round(width * scale));
  const traceHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = traceWidth;
  canvas.height = traceHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, traceWidth, traceHeight);
  }
  context.drawImage(image, 0, 0, traceWidth, traceHeight);

  const { data } = context.getImageData(0, 0, traceWidth, traceHeight);

  const paletteSize = Math.max(2, Math.min(64, Math.round(colours)));
  const palette = quantize(data, paletteSize, { format: 'rgb565' });
  const indexed = applyPalette(data, palette, 'rgb565');

  // Transparent pixels belong to no colour at all. Without this they are
  // quantised like any other, and a transparent background comes back as a
  // solid block of whatever colour the empty pixels happened to average to.
  const indices = Int16Array.from(indexed);
  let opaque = true;
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    if (data[pixel * 4 + 3] < ALPHA_FLOOR) {
      indices[pixel] = -1;
      opaque = false;
    }
  }

  const counts = new Array(palette.length).fill(0);
  for (let pixel = 0; pixel < indices.length; pixel += 1) {
    if (indices[pixel] >= 0) counts[indices[pixel]] += 1;
  }

  /*
   * The most-used colour becomes a background rectangle instead of a traced
   * shape, when nothing is transparent.
   *
   * It is the single biggest saving in the file, and it also removes the
   * hairline seams: neighbouring paths share an edge exactly, but each is
   * anti-aliased on its own, so two halves of a boundary pixel blend to less
   * than full coverage and a pale line shows through. Painting the dominant
   * colour underneath leaves nothing to show through.
   */
  const dominant = opaque
    ? counts.reduce((best, count, index) => (count > counts[best] ? index : best), 0)
    : -1;

  // 0 keeps every pixel step; 100 is heavily simplified. The top of the range
  // is deliberately modest — past ~3px the shapes stop resembling the picture.
  const tolerance = (1 - Math.max(0, Math.min(100, detail)) / 100) * 3;

  const layers = [];
  for (let index = 0; index < palette.length; index += 1) {
    if (!counts[index] || index === dominant) continue;
    const loops = traceColour(indices, traceWidth, traceHeight, index);
    const d = pathData(loops, tolerance);
    if (d) layers.push({ colour: hex(...palette[index]), d, size: counts[index] });
  }

  // Largest first: a small shape drawn over a large one is the intent, and the
  // reverse leaves the detail buried.
  layers.sort((left, right) => right.size - left.size);

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(width)}" height="${Math.round(height)}"`
    + ` viewBox="0 0 ${traceWidth} ${traceHeight}">`,
  ];

  if (dominant >= 0) {
    parts.push(`<rect width="${traceWidth}" height="${traceHeight}" fill="${hex(...palette[dominant])}"/>`);
  }

  layers.forEach((layer) => {
    parts.push(`<path fill="${layer.colour}" fill-rule="evenodd" d="${layer.d}"/>`);
  });

  parts.push('</svg>');

  return { markup: parts.join('\n'), paths: layers.length + (dominant >= 0 ? 1 : 0) };
};
