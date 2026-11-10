/**
 * Ends a dashboard session: closes the dedicated Chrome if one still answers,
 * then deletes its profile, which holds the owner's sign-in.
 *
 * The person often closes the window themself after pressing 「審査のため送信」.
 * The profile must be deleted in that case too, so a Chrome that does not
 * answer is not an error here (#118). What is an error: a profile that cannot
 * be deleted, because a Chrome still holds its files.
 */
export interface CloseProfileIo {
  /** Asks the running Chrome to close. Resolves false when no Chrome answers. */
  closeBrowser(): Promise<boolean>;
  /** Deletes the profile directory; throws while Chrome still holds a file. */
  removeProfile(): Promise<void>;
  wait(ms: number): Promise<void>;
}

/** Chrome releases the profile shortly after it exits: 10 tries a second apart. */
export const REMOVE_ATTEMPTS = 10;

export async function closeProfile(io: CloseProfileIo): Promise<{ browserClosed: boolean }> {
  const browserClosed = await io.closeBrowser();
  let last: unknown;
  for (let attempt = 1; attempt <= REMOVE_ATTEMPTS; attempt += 1) {
    try {
      await io.removeProfile();
      return { browserClosed };
    } catch (e) {
      last = e;
      if (attempt < REMOVE_ATTEMPTS) await io.wait(1000);
    }
  }
  throw new Error(`could not delete the profile after ${REMOVE_ATTEMPTS} tries; delete it once Chrome has exited (${(last as Error)?.message ?? last})`);
}
