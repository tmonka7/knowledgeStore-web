import { purgeStaleVisitors } from '../models/attendanceModel.js';

/*
 * Unidentified faces are forgotten after a while.
 *
 * Automatic attendance stores a face descriptor for everybody a camera sees,
 * including people who have nothing to do with this system and were never
 * asked. Without an expiry that collection only ever grows, and what it grows
 * into is a permanent biometric record of every person who has walked past a
 * camera — a liability to hold, and in a good many jurisdictions unlawful to
 * hold indefinitely without a reason.
 *
 * So the default is to keep an unidentified face for thirty days, which is
 * long enough for the same visitor to be recognised across several sweeps and
 * for somebody to put a name to them. Faces that HAVE been named or linked are
 * kept: a person decided they mattered, and that decision is the record.
 *
 * Set VISITOR_FACE_RETENTION_DAYS to change the window, or to 0 to switch the
 * expiry off — which is a deliberate choice to keep them forever, and should
 * be made deliberately.
 */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export const startVisitorRetention = () => {
  const run = async () => {
    try {
      const removed = await purgeStaleVisitors();
      if (removed) console.log(`Visitor face retention: removed ${removed} unidentified face(s).`);
    } catch (error) {
      console.error('Visitor face retention sweep failed:', error.message);
    }
  };

  run();
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  // Never hold the process open for a cleanup timer.
  timer.unref?.();
  return timer;
};
