/**
 * What a transcribed speech corpus leaves the browser as.
 *
 * The same clips and transcripts feed two ecosystems that want different
 * files, so both are written rather than one being picked for you:
 *
 *   metadata.csv   LJSpeech layout, `id|transcript|normalised`, pipe
 *                  separated. What most TTS training scripts read.
 *   manifest.jsonl One JSON object per line with the path, the duration and
 *                  the text. What speech-recognition toolkits read, and the
 *                  reason the duration is measured at all.
 *
 * Only clips with a transcript are written. An untranscribed clip is work not
 * yet done, and putting it in with an empty string trains a model to answer
 * silence — a corpus is better short than quietly wrong.
 */

/** `speech_001.wav` -> `speech_001`, which is the id both formats use. */
export const clipId = (name) => name.replace(/\.[^./\\]+$/, '');

/**
 * Flattens a transcript onto one line.
 *
 * The pipe is LJSpeech's column separator and a newline ends the record, so a
 * transcript containing either would split into columns or rows that were
 * never meant to exist. Both are replaced rather than rejected: this is
 * somebody's typing, and losing a line of it to punctuation would be worse
 * than the substitution.
 */
export const flattenText = (text) => String(text ?? '')
  .replace(/[\r\n]+/g, ' ')
  .replace(/\|/g, '/')
  .replace(/\s+/g, ' ')
  .trim();

export const transcribed = (clips) => clips.filter((clip) => flattenText(clip.text));

/** LJSpeech `metadata.csv`. */
export const buildMetadataCsv = (clips) => {
  const rows = transcribed(clips).map((clip) => {
    const text = flattenText(clip.text);
    // Third column is the normalised text. Nothing here normalises numbers or
    // abbreviations, so it repeats the transcript — which is what a corpus
    // built by hand does, and the column has to be present either way.
    return [clipId(clip.name), text, text].join('|');
  });

  return `${rows.join('\n')}\n`;
};

/** NeMo-style JSON Lines manifest. */
export const buildManifestJsonl = (clips, audioDir = 'wavs') => {
  const rows = transcribed(clips).map((clip) => JSON.stringify({
    audio_filepath: `${audioDir}/${clip.name}`,
    duration: Number((clip.seconds || 0).toFixed(3)),
    text: flattenText(clip.text),
  }));

  return `${rows.join('\n')}\n`;
};

/** Totals for the progress line and the export summary. */
export const datasetSummary = (clips) => {
  const done = transcribed(clips);
  const seconds = done.reduce((sum, clip) => sum + (clip.seconds || 0), 0);
  const words = done.reduce((sum, clip) => sum + flattenText(clip.text).split(' ').filter(Boolean).length, 0);

  return {
    total: clips.length,
    done: done.length,
    seconds,
    words,
    // The figure that decides whether a corpus is worth training on, so it is
    // shown from the first clip rather than left to be worked out at the end.
    hours: seconds / 3600,
  };
};
