/**
 * The retry policy of `scripts/cws-dashboard.ts fill`, apart from the dashboard.
 *
 * The dashboard saves on its own when a field loses focus and disables its
 * 「下書きとして保存する」 button while it does, so a field put in and "saved"
 * can still come back as the old text (0.7.8: two privacy fields did, while
 * the script printed `saved`). Neither a toast nor a pause proves a field
 * stuck; reading it back from a freshly loaded tab does. So a round puts the
 * fields that are not kept, then reads every field back, because saving one
 * field can undo another. The rounds are bounded; what is still not kept after
 * the last one is returned for the caller to report.
 */

export interface FieldIo<F> {
  /** Puts the wanted text into the field and saves the draft. Resolves when the dashboard has finished saving, whether or not the text stuck. */
  put(field: F): Promise<void>;
  /** Reads the field from a freshly loaded tab and says whether it holds the wanted text. */
  kept(field: F): Promise<boolean>;
}

/** Rounds of put-then-read-back before giving up. Three: one to put, one to repair a field another save undid, one spare. */
export const FILL_ROUNDS = 3;

/** Returns the fields that are still not kept: none when the dashboard holds every wanted text. */
export async function fillUntilKept<F>(fields: readonly F[], io: FieldIo<F>, rounds: number = FILL_ROUNDS): Promise<F[]> {
  const unkept = async (among: readonly F[]): Promise<F[]> => {
    const left: F[] = [];
    for (const field of among) if (!(await io.kept(field))) left.push(field);
    return left;
  };
  // A field that already holds its text needs no put: the dashboard is not touched for it.
  let remaining = await unkept(fields);
  for (let round = 1; round <= rounds && remaining.length > 0; round += 1) {
    for (const field of remaining) await io.put(field);
    remaining = await unkept(fields);
  }
  return remaining;
}
