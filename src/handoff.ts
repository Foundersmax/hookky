/** A video one tool hands to the next (AI video → Caption / Upscale): the sheet that opens takes it. */
export const handoff: { file?: File } = {};
export function takeHandoff(): File | undefined {
  const f = handoff.file;
  handoff.file = undefined;
  return f;
}
