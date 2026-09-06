import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AKIZUKI_CAPABILITIES } from '../../src/adapters/akizuki/capabilities.ts';
import { openInMemory } from '../../src/db/connection.ts';
import { importSnapshot } from '../../src/db/importSnapshot.ts';
import { migrate, SQLITE_SCHEMA_VERSION } from '../../src/db/migrations/index.ts';
import { readStoreHistory } from '../../src/db/read.ts';
import { generateStoreDataset } from '../../src/publisher/generate.ts';
import { writeStoreDataset } from '../../src/publisher/write.ts';
import { buildUserscript } from '../../scripts/build-userscript.ts';
import { loadAkizukiNormalized } from '../helpers/fixtures.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
export const E2E_SITE_DIR = path.resolve(here, '..', '..', 'test-results', 'e2e-site');

/**
 * Produces, once per run, a real contract v1 dataset from the two checked-in
 * Akizuki snapshots plus the built userscript, under test-results/e2e-site.
 */
export default async function globalSetup(): Promise<void> {
  await rm(E2E_SITE_DIR, { recursive: true, force: true });
  await mkdir(E2E_SITE_DIR, { recursive: true });
  const db = openInMemory();
  migrate(db);
  for (const which of ['aug', 'sep'] as const) importSnapshot(db, await loadAkizukiNormalized(which), { capabilities: AKIZUKI_CAPABILITIES });
  const dataset = generateStoreDataset(readStoreHistory(db, 'akizuki'), {
    generatedAt: new Date().toISOString(),
    sqliteSchemaVersion: SQLITE_SCHEMA_VERSION,
    sourceSchemaVersion: '2',
  });
  db.close();
  const summary = await writeStoreDataset(E2E_SITE_DIR, dataset);
  const built = await buildUserscript(E2E_SITE_DIR);
  await writeFile(path.join(E2E_SITE_DIR, 'e2e-setup.json'), JSON.stringify({ datasetVersion: dataset.manifest.datasetVersion, products: summary.productCount, userscriptBytes: built.bytes }));
}
