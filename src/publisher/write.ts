import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isSafeKey } from '../core/identity.ts';
import { manifestPath, productPath, storeDir, validateManifestV1, validateProductFileV1, type ManifestV1 } from './contract.ts';
import type { StoreDataset } from './generate.ts';

export interface WriteSummary {
  storeDir: string;
  productCount: number;
  bytesTotal: number;
  bytesMax: number;
}

export interface VerifySummary extends WriteSummary {
  datasetVersion: string;
  manifest: ManifestV1;
}

export class DatasetVerificationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = 'DatasetVerificationError';
  }
}

/** Resolves `relative` under `root` and refuses anything that escapes it. */
export function resolveInside(root: string, relative: string): string {
  const rootAbs = path.resolve(root);
  const target = path.resolve(rootAbs, relative);
  const rel = path.relative(rootAbs, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`path ${relative} escapes ${root}`);
  }
  return target;
}

/**
 * Writes one store's dataset under `siteRoot` (the directory later uploaded
 * to Pages). The store directory is built next to its final location and
 * swapped in with a rename, so a crash never leaves a half-written store
 * behind; publication-level atomicity is the deployment's job.
 */
export async function writeStoreDataset(siteRoot: string, dataset: StoreDataset): Promise<WriteSummary> {
  const storeId = dataset.manifest.storeId;
  if (!isSafeKey(storeId)) throw new Error(`unsafe store id ${storeId}`);
  const finalDir = resolveInside(siteRoot, storeDir(storeId));
  const stagingDir = `${finalDir}.staging-${process.pid}`;
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(path.join(stagingDir, 'products'), { recursive: true });

  let bytesTotal = 0;
  let bytesMax = 0;
  const seen = new Set<string>();
  for (const product of dataset.products) {
    if (product.storeId !== storeId) throw new Error(`product ${product.pageKey} belongs to store ${product.storeId}, not ${storeId}`);
    if (!isSafeKey(product.pageKey)) throw new Error(`unsafe page key ${product.pageKey}`);
    if (product.datasetVersion !== dataset.manifest.datasetVersion) throw new Error(`dataset version mismatch for ${product.pageKey}`);
    if (seen.has(product.pageKey)) throw new Error(`duplicate page key ${product.pageKey}`);
    seen.add(product.pageKey);
    const file = resolveInside(stagingDir, `products/${product.pageKey}.json`);
    const body = JSON.stringify(product);
    const bytes = Buffer.byteLength(body);
    bytesTotal += bytes;
    if (bytes > bytesMax) bytesMax = bytes;
    await writeFile(file, body, 'utf8');
  }
  if (dataset.manifest.productCount !== dataset.products.length) throw new Error('manifest productCount does not match products');
  const manifestBody = JSON.stringify(dataset.manifest);
  bytesTotal += Buffer.byteLength(manifestBody);
  await writeFile(path.join(stagingDir, 'manifest.json'), manifestBody, 'utf8');

  await mkdir(path.dirname(finalDir), { recursive: true });
  await rm(finalDir, { recursive: true, force: true });
  await rename(stagingDir, finalDir);
  return { storeDir: finalDir, productCount: dataset.products.length, bytesTotal, bytesMax };
}

/**
 * Re-reads a written store dataset and checks it against the contract: the
 * manifest validates, every product file validates, carries the manifest's
 * dataset version, matches its file name, and the count matches. Throws
 * `DatasetVerificationError` with the collected issues otherwise.
 */
export async function verifyStoreDataset(siteRoot: string, storeId: string): Promise<VerifySummary> {
  const issues: string[] = [];
  const dir = resolveInside(siteRoot, storeDir(storeId));
  const manifestRaw = await readFile(resolveInside(siteRoot, manifestPath(storeId)), 'utf8');
  const manifestValue: unknown = JSON.parse(manifestRaw);
  const manifestIssues = validateManifestV1(manifestValue);
  if (manifestIssues.length > 0) throw new DatasetVerificationError('manifest is invalid', manifestIssues.map((i) => `manifest ${i}`));
  const manifest = manifestValue as ManifestV1;
  if (manifest.storeId !== storeId) issues.push(`manifest storeId ${manifest.storeId} != ${storeId}`);

  let bytesTotal = Buffer.byteLength(manifestRaw);
  let bytesMax = 0;
  const productsDir = path.join(dir, 'products');
  const names = (await readdir(productsDir)).filter((n) => n.endsWith('.json')).sort();
  for (const name of names) {
    const pageKey = name.slice(0, -'.json'.length);
    const file = resolveInside(siteRoot, productPath(storeId, pageKey));
    const raw = await readFile(file, 'utf8');
    const bytes = Buffer.byteLength(raw);
    bytesTotal += bytes;
    if (bytes > bytesMax) bytesMax = bytes;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      issues.push(`${name}: not valid JSON`);
      continue;
    }
    const problems = validateProductFileV1(value);
    if (problems.length > 0) {
      issues.push(...problems.slice(0, 5).map((p) => `${name} ${p}`));
      continue;
    }
    const product = value as { pageKey: string; storeId: string; datasetVersion: string };
    if (product.pageKey !== pageKey) issues.push(`${name}: pageKey ${product.pageKey} does not match file name`);
    if (product.storeId !== storeId) issues.push(`${name}: storeId ${product.storeId}`);
    if (product.datasetVersion !== manifest.datasetVersion) issues.push(`${name}: datasetVersion ${product.datasetVersion} != ${manifest.datasetVersion}`);
    if (issues.length > 200) break;
  }
  if (names.length !== manifest.productCount) issues.push(`manifest productCount ${manifest.productCount} but ${names.length} product files`);
  if (issues.length > 0) throw new DatasetVerificationError(`dataset for ${storeId} failed verification (${issues.length} issues)`, issues);
  const s = await stat(dir);
  if (!s.isDirectory()) throw new DatasetVerificationError('store dir missing', []);
  return { storeDir: dir, productCount: names.length, bytesTotal, bytesMax, datasetVersion: manifest.datasetVersion, manifest };
}
