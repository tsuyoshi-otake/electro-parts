import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AKIZUKI_CAPABILITIES } from '../../src/adapters/akizuki/capabilities.ts';
import { SWITCH_SCIENCE_CAPABILITIES } from '../../src/adapters/switch-science/capabilities.ts';
import { openInMemory } from '../../src/db/connection.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { migrate, SQLITE_SCHEMA_VERSION } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import { generateStoreDataset } from '../../src/publisher/generate.ts';
import { writeStoreDataset } from '../../src/publisher/write.ts';
import { buildExtension } from '../../scripts/build-extension.ts';
import { buildUserscript } from '../../scripts/build-userscript.ts';
import { loadAkizukiNormalized, loadSwitchScienceNormalized } from '../helpers/fixtures.ts';
import { loadM5StackNormalized } from '../helpers/m5stack.ts';
import { M5STACK_CAPABILITIES } from '../../src/adapters/m5stack/snapshotAdapter.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const E2E_SITE_DIR = path.resolve(here, '..', '..', 'test-results', 'e2e-site');
/** Unpacked Chrome extension under test, built from the same sources as the userscript. */
export const E2E_EXTENSION_DIR = path.resolve(here, '..', '..', 'test-results', 'e2e-extension');

/**
 * Produces, once per run, real contract v1 datasets from the checked-in
 * snapshots plus the built userscript, under test-results/e2e-site.
 *
 * Both stores are written into the *same* site directory, which is what the
 * published site is: one Pages deployment with a dataset per store. Akizuki has
 * two observations and Switch Science one, so the specs between them cover both
 * a history with a change and a store's very first run.
 */
export default async function globalSetup(): Promise<void> {
  await rm(E2E_SITE_DIR, { recursive: true, force: true });
  await mkdir(E2E_SITE_DIR, { recursive: true });
  const db = openInMemory();
  migrate(db);
  for (const which of ['aug', 'sep'] as const) importSnapshot(db, await loadAkizukiNormalized(which), { capabilities: AKIZUKI_CAPABILITIES });
  importSnapshot(db, await loadSwitchScienceNormalized(), { capabilities: SWITCH_SCIENCE_CAPABILITIES });
  importSnapshot(db, await loadM5StackNormalized(), { capabilities: M5STACK_CAPABILITIES });
  const generatedAt = new Date().toISOString();
  const options = { generatedAt, sqliteSchemaVersion: SQLITE_SCHEMA_VERSION };
  const akizuki = generateStoreDataset(readStoreHistory(db, 'akizuki'), { ...options, sourceSchemaVersion: '2' });
  const switchScience = generateStoreDataset(readStoreHistory(db, 'switch-science'), { ...options, sourceSchemaVersion: '1' });
  const m5stack = generateStoreDataset(readStoreHistory(db, 'm5stack'), { ...options, sourceSchemaVersion: '1' });
  db.close();
  const summaries = [await writeStoreDataset(E2E_SITE_DIR, akizuki), await writeStoreDataset(E2E_SITE_DIR, switchScience), await writeStoreDataset(E2E_SITE_DIR, m5stack)];
  const built = await buildUserscript(E2E_SITE_DIR);
  await rm(E2E_EXTENSION_DIR, { recursive: true, force: true });
  await buildExtension(E2E_EXTENSION_DIR);
  await writeFile(
    path.join(E2E_SITE_DIR, 'e2e-setup.json'),
    JSON.stringify({
      stores: summaries.map((s, i) => ({ storeId: [akizuki, switchScience, m5stack][i]!.manifest.storeId, products: s.productCount })),
      datasetVersion: akizuki.manifest.datasetVersion,
      userscriptBytes: built.bytes,
    }),
  );
}
