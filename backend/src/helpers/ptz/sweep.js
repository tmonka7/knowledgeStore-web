/*
 * Planning a 180-degree sweep.
 *
 * The naive plan — "divide 180 by the field of view and turn that many times"
 * — misses people, and it misses them silently, which is the worst property an
 * attendance system can have. Two corrections are what this file is for.
 *
 * FIRST: a camera at pan angle P sees from P - fov/2 to P + fov/2. To cover an
 * arc, the outermost STOPS sit half a frame inside the arc's edges, not on
 * them. So the stops span (180 - fov) degrees, not 180, and the count comes
 * from that shorter span. Planning across the full 180 aims the end stops half
 * a frame beyond the arc and leaves two blind wedges just inside its edges.
 *
 * SECOND: frames must overlap. A face on the exact seam between two abutting
 * frames is cut in half in both, and a half face is not recognised in either —
 * so the sweep reports everyone except the person standing at the join. The
 * overlap below is a fraction of the frame width, defaulting to a quarter,
 * which comfortably exceeds the width of a head at conversational distance.
 *
 * Angles here are degrees relative to the centre of the arc. Turning them into
 * ONVIF's normalised -1..1 needs the head's full pan travel, which differs by
 * model and is part of the camera's configuration.
 */

export const SWEEP_DEFAULTS = {
  // Most PTZ heads travel a full turn; 360 is the common case and the one that
  // makes the normalised units line up with degrees the way operators expect.
  panRangeDegrees: 360,
  // Horizontal field of view fully zoomed out. 65 is typical of a PTZ dome at
  // 1x; it is configurable because getting it wrong is what causes gaps.
  hfovDegrees: 65,
  // Optical zoom at ONVIF zoom 1.0, as a multiplier on focal length.
  maxZoomFactor: 20,
  arcDegrees: 180,
  overlap: 0.25,
  // How long the head is given to stop wobbling after it arrives. A frame
  // grabbed mid-settle is motion-blurred, and a blurred face yields a
  // descriptor that matches nobody — the person is present and recorded absent.
  settleMs: 900,
};

/** Field of view at a given ONVIF zoom (0..1). */
export const fovAtZoom = (hfovDegrees, zoom, maxZoomFactor) => {
  const factor = 1 + (Math.max(0, Math.min(1, zoom)) * (Math.max(1, maxZoomFactor) - 1));
  return hfovDegrees / factor;
};

/** Degrees to ONVIF's normalised pan, wrapped into the head's travel. */
export const degreesToNormalised = (degrees, panRangeDegrees) => {
  const half = Math.max(1, panRangeDegrees) / 2;
  // Wrap into -half..+half so an arc that crosses the camera's zero point does
  // not ask for a position beyond the end of its travel.
  const wrapped = (((degrees + half) % (half * 2)) + (half * 2)) % (half * 2) - half;
  return Math.max(-1, Math.min(1, wrapped / half));
};

/**
 * The stops for one sweep, in order.
 *
 * Returns { stops, fov, coverageDegrees, complete }. `complete` is false when
 * the requested zoom makes the field of view so narrow that the stop count hit
 * `maxStops` before the arc was covered — the sweep still runs, but it covers
 * less than was asked for and the caller must say so rather than quietly
 * returning a short list.
 */
export const planSweep = ({
  panRangeDegrees = SWEEP_DEFAULTS.panRangeDegrees,
  hfovDegrees = SWEEP_DEFAULTS.hfovDegrees,
  maxZoomFactor = SWEEP_DEFAULTS.maxZoomFactor,
  arcDegrees = SWEEP_DEFAULTS.arcDegrees,
  overlap = SWEEP_DEFAULTS.overlap,
  homeDegrees = 0,
  tilt = 0,
  zoom = 0,
  maxStops = 24,
} = {}) => {
  const arc = Math.max(1, Math.min(360, Number(arcDegrees) || SWEEP_DEFAULTS.arcDegrees));
  const fov = Math.max(1, fovAtZoom(hfovDegrees, zoom, maxZoomFactor));

  // One frame already covers the arc: turning would only add blur and time.
  if (fov >= arc) {
    return {
      fov,
      complete: true,
      coverageDegrees: arc,
      stops: [{ index: 0, degrees: homeDegrees, pan: degreesToNormalised(homeDegrees, panRangeDegrees), tilt, zoom }],
    };
  }

  const span = arc - fov;                       // distance between first and last stop
  const step = fov * (1 - Math.max(0, Math.min(0.9, overlap)));
  // +1 because N intervals need N+1 stops; ceil so the last stop reaches the
  // far edge rather than stopping just short of it.
  const wanted = Math.ceil(span / step) + 1;
  const count = Math.min(maxStops, Math.max(2, wanted));
  const complete = count >= wanted;

  /*
   * When the stop budget is not enough for the whole arc — a narrow field of
   * view at high zoom needs a lot of stops — the sweep covers a SMALLER arc
   * properly rather than spreading the same few stops across the full 180 and
   * leaving holes between them. Holes are the failure that does not announce
   * itself: the sweep completes, the list looks plausible, and whoever stood
   * in a gap is marked absent. A narrower arc is visible in the plan and can
   * be argued with; an invisible gap cannot.
   */
  const usedSpan = complete ? span : (count - 1) * step;

  // Spread the stops evenly over the span rather than stepping by `step` and
  // letting the remainder fall off the end: an even spread keeps the overlap
  // uniform instead of concentrating all the slack in the final gap.
  const gap = usedSpan / (count - 1);
  const first = homeDegrees - (usedSpan / 2);

  const stops = Array.from({ length: count }, (unused, index) => {
    const degrees = first + (gap * index);
    return { index, degrees, pan: degreesToNormalised(degrees, panRangeDegrees), tilt, zoom };
  });

  return { fov, stops, complete, coverageDegrees: usedSpan + fov };
};
