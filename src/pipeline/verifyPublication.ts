import path from 'node:path';
import { openDatabase } from '../db/connection.ts';
import { verifyStateDir, type FinalizedState } from '../db/finalize.ts';
import { readStoreHistory } from '../db/read.ts';
import { datasetVersionOf } from '../publisher/generate.ts';
import { verifyStoreDataset } from '../publisher/write.ts';
import type { PipelineConfig } from './config.ts';

export interface PublicationVerification {
  datasetVersion: string;
  productCount: number;
  bytesTotal: number;
  stateSha256: string;
  stateBytes: number;
  stores: FinalizedState['stores'];
}

/** Verifies both artifacts and proves the dataset was derived from the bundled state. */
export async function verifyPublication(siteDir: string, config: PipelineConfig): Promise<PublicationVerification> {
  const dataset = await verifyStoreDataset(siteDir, config.storeId);
  const state = await verifyStateDir(path.join(siteDir, 'state'));
  const db = openDatabase(path.join(siteDir, 'state', state.fileName), { readOnly: true });
  try {
    const history = readStoreHistory(db, config.storeId);
    const latest = history.runs[history.runs.length - 1];
    const expected = datasetVersionOf(history, {
      sqliteSchemaVersion: state.sqliteSchemaVersion,
      sourceSchemaVersion: latest === undefined ? null : db.prepare(
        'SELECT source_schema_version AS v FROM crawl_runs WHERE run_id = ?',
      ).get(latest.runId)?.['v'] as string | null,
      inventoryPointLimit: config.inventory.pointLimit,
      observationCadence: config.observation.cadence,
    });
    if (dataset.datasetVersion !== expected) {
      throw new Error(`datasetVersion ${dataset.datasetVersion} does not match bundled state ${expected}`);
    }
    return {
      datasetVersion: dataset.datasetVersion,
      productCount: dataset.productCount,
      bytesTotal: dataset.bytesTotal,
      stateSha256: state.sha256,
      stateBytes: state.bytes,
      stores: state.stores,
    };
  } finally {
    db.close();
  }
}
