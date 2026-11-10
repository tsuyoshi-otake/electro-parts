import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeProfile, REMOVE_ATTEMPTS } from '../../scripts/lib/close-profile.ts';

const exists = (p: string) => stat(p).then(() => true, () => false);

/** A profile directory with a file in it, as Chrome leaves one. */
async function profileDir(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'close-profile-'));
  const profile = path.join(root, 'profile');
  await mkdir(path.join(profile, 'Default'), { recursive: true });
  await writeFile(path.join(profile, 'Default', 'Cookies'), 'signed in');
  return profile;
}

describe('closeProfile (#118)', () => {
  it('deletes the profile when no Chrome answers on the port (the person closed the window first)', async () => {
    const profile = await profileDir();
    const log: string[] = [];
    const result = await closeProfile({
      async closeBrowser() { log.push('connect'); return false; },
      removeProfile: async () => { log.push('remove'); await rm(profile, { recursive: true, force: true }); },
      wait: async () => { log.push('wait'); },
    });
    expect(result).toEqual({ browserClosed: false });
    expect(log).toEqual(['connect', 'remove']);
    expect(await exists(profile)).toBe(false);
  });

  it('closes a Chrome that still answers before deleting the profile', async () => {
    const profile = await profileDir();
    const log: string[] = [];
    const result = await closeProfile({
      async closeBrowser() { log.push('Browser.close'); return true; },
      removeProfile: async () => { log.push('remove'); await rm(profile, { recursive: true, force: true }); },
      wait: async () => { log.push('wait'); },
    });
    expect(result).toEqual({ browserClosed: true });
    expect(log).toEqual(['Browser.close', 'remove']);
    expect(await exists(profile)).toBe(false);
  });

  it('retries while Chrome still holds a file, a second apart', async () => {
    let tries = 0;
    const waits: number[] = [];
    await closeProfile({
      closeBrowser: async () => true,
      removeProfile: async () => { tries += 1; if (tries < 3) throw new Error('EBUSY'); },
      wait: async (ms) => { waits.push(ms); },
    });
    expect(tries).toBe(3);
    expect(waits).toEqual([1000, 1000]);
  });

  it('fails with the reason when the profile cannot be deleted, after the bounded tries', async () => {
    let tries = 0;
    const waits: number[] = [];
    await expect(closeProfile({
      closeBrowser: async () => false,
      removeProfile: async () => { tries += 1; throw new Error('EBUSY: resource busy or locked'); },
      wait: async (ms) => { waits.push(ms); },
    })).rejects.toThrow(/could not delete the profile after 10 tries.*EBUSY/);
    expect(tries).toBe(REMOVE_ATTEMPTS);
    expect(waits).toHaveLength(REMOVE_ATTEMPTS - 1);
  });
});
