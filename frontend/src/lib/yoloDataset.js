/**
 * The labelling dataset: what a shape is, and how it leaves the browser.
 *
 * Shapes are stored normalised to the image — 0..1 on both axes — and never in
 * pixels. The canvas is whatever size the window allows and the same image may
 * be labelled at two different zooms in one session, so pixels would make the
 * stored value depend on the monitor it was drawn on. Normalised is also what
 * both YOLO label formats want, so the export is a formatting step rather than
 * a conversion.
 *
 * Two tasks are supported, matching the two models asked for:
 *
 *   detection    (YOLO26n)      boxes    `class cx cy w h`
 *   segmentation (YOLO26-seg)   polygons `class x1 y1 x2 y2 ...`
 *
 * Pose (YOLO26n-pos) and its line/keypoint shape are deliberately absent.
 */

import { buildZip } from './zipWriter';

export const TASKS = [
  {
    value: 'detect',
    label: 'Detection — YOLO26n',
    shape: 'box',
    hint: 'Drag a rectangle around each object.',
  },
  {
    value: 'segment',
    label: 'Segmentation — YOLO26-seg',
    shape: 'polygon',
    hint: 'Click around each object, then close the shape.',
  },
];

export const shapeForTask = (task) => (task === 'segment' ? 'polygon' : 'box');

/** Decimal places kept in the exports. Six is ~1/1000 of a pixel at 4K. */
const PRECISION = 6;

const round = (value) => {
  // Clamped as well as rounded: a box dragged past the edge of the image is a
  // normal thing to do with a mouse, and a coordinate outside 0..1 makes
  // Ultralytics reject the whole label file.
  const clamped = Math.min(1, Math.max(0, value));
  return Number(clamped.toFixed(PRECISION));
};

/** The axis-aligned bounds of any shape, as { x, y, w, h } with x/y top-left. */
export const boundsOf = (shape) => {
  if (shape.type === 'box') return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };

  const xs = shape.points.map(([x]) => x);
  const ys = shape.points.map(([, y]) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/** Is this point inside the shape? Ray casting for polygons. */
export const hitTest = (shape, px, py) => {
  if (shape.type === 'box') {
    return px >= shape.x && px <= shape.x + shape.w
      && py >= shape.y && py <= shape.y + shape.h;
  }

  let inside = false;
  const points = shape.points;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const crosses = (yi > py) !== (yj > py)
      && px < ((xj - xi) * (py - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
};

/** A box as YOLO writes it: centre point and size, not corners. */
const boxToYolo = (shape) => {
  const { x, y, w, h } = boundsOf(shape);
  return [round(x + w / 2), round(y + h / 2), round(w), round(h)];
};

/**
 * A polygon for the segmentation format.
 *
 * A box reaching this point is emitted as its four corners rather than being
 * dropped — the person drew it deliberately, and silently losing labels at
 * export is the worst thing a labelling tool can do.
 */
const polygonPoints = (shape) => {
  if (shape.type === 'polygon') return shape.points.flatMap(([x, y]) => [round(x), round(y)]);

  const { x, y, w, h } = boundsOf(shape);
  return [x, y, x + w, y, x + w, y + h, x, y + h].map(round);
};

/** RFC 4180: quote anything containing a comma, quote or newline. */
const csvCell = (value) => {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const CSV_HEADER = [
  'image', 'image_width', 'image_height',
  'class_id', 'class_name', 'shape', 'points',
];

/**
 * dataset.csv — every image, every shape, one row each.
 *
 * Both shape kinds are written exactly as drawn, whatever the chosen task, so
 * the CSV stays the complete record and the task only decides what the YOLO
 * export makes of it.
 *
 * An image with nothing on it still gets a row, with shape `none`. That is not
 * padding: an image deliberately left empty is a background sample, and it is
 * the only way to tell one apart from an image nobody got to yet.
 */
export const buildCsv = (images, classes) => {
  const rows = [CSV_HEADER.join(',')];

  images.forEach((image) => {
    if (!image.shapes.length) {
      rows.push([
        csvCell(image.name), image.width || '', image.height || '',
        '', '', 'none', '',
      ].join(','));
      return;
    }

    image.shapes.forEach((shape) => {
      const numbers = shape.type === 'box' ? boxToYolo(shape) : polygonPoints(shape);
      rows.push([
        csvCell(image.name),
        image.width || '',
        image.height || '',
        shape.classId,
        csvCell(classes[shape.classId] || ''),
        shape.type,
        csvCell(numbers.join(' ')),
      ].join(','));
    });
  });

  // A trailing newline: some tools drop the last row without one.
  return `${rows.join('\n')}\n`;
};

/** One image's YOLO label file, in the format the chosen task trains from. */
export const buildLabelFile = (image, task) => image.shapes
  .map((shape) => {
    const numbers = task === 'segment' ? polygonPoints(shape) : boxToYolo(shape);
    return [shape.classId, ...numbers].join(' ');
  })
  .join('\n');

/** `photo.jpg` -> `photo.txt`, leaving a dotless name alone. */
const labelName = (name) => `${name.replace(/\.[^./\\]+$/, '')}.txt`;

const dataYaml = (classes, task) => {
  const names = classes.map((name, index) => `  ${index}: ${name}`).join('\n');
  return `# Written by the Knowledge Store labelling tool.
# Put this file beside your images and split train/val before training —
# both keys point at the same folder here, which trains and validates on
# identical data and will flatter the numbers.
path: .
train: images
val: images

# ${task === 'segment' ? 'Segmentation: labels are polygons.' : 'Detection: labels are boxes.'}
names:
${names}
`;
};

const README = `Labels exported from the Knowledge Store labelling tool.

  labels/     one .txt per image, in YOLO format, normalised 0..1
  data.yaml   class names and the dataset layout

The images are not in here. Ultralytics expects them beside the labels:

  dataset/
    data.yaml
    images/   <- copy your image folder here
    labels/   <- the folder from this archive

An image you reviewed and left empty has an empty .txt file, which is how a
background sample is written. An image you never opened has no file at all.
`;

/**
 * The YOLO archive: one label file per image, plus data.yaml.
 *
 * The images themselves are left out. They are already in a folder on the
 * machine that produced them, and copying tens of thousands of them through
 * the browser's memory to hand them straight back is not a service.
 */
export const buildYoloZip = (images, classes, task) => {
  const files = images
    .filter((image) => image.visited || image.shapes.length)
    .map((image) => ({
      name: `labels/${labelName(image.name)}`,
      text: buildLabelFile(image, task),
    }));

  files.push({ name: 'data.yaml', text: dataYaml(classes, task) });
  files.push({ name: 'README.txt', text: README });

  return buildZip(files);
};

/** What the export would contain, for the summary shown before downloading. */
export const datasetSummary = (images) => {
  const labelled = images.filter((image) => image.shapes.length).length;
  const visited = images.filter((image) => image.visited).length;
  const shapes = images.reduce((sum, image) => sum + image.shapes.length, 0);
  return { total: images.length, labelled, visited, shapes };
};
