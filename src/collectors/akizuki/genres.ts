/**
 * Default genre set crawled for the Akizuki store. These 18 top-level genre
 * listings together cover the whole online catalogue (products belong to
 * several genres; the crawler deduplicates by sales code). The set is the
 * store's coverage id, so changing it changes `coverageId` of every later run.
 *
 * Overridable through the pipeline configuration (`config/akizuki.json`).
 */
export const AKIZUKI_DEFAULT_GENRES: readonly string[] = [
  'rkit',
  'rdisp',
  'rcamera',
  'rkosaku',
  'rbatt',
  'rparts',
  'rcar',
  'rsensor',
  'rsbcomp1',
  'rmicon',
  'rmicon2',
  'rsemi',
  'rpower',
  'rcomp',
  'rrf',
  'rled',
  'ropto',
  'rai',
];

export const AKIZUKI_BASE_URL = 'https://akizukidenshi.com';
export const AKIZUKI_GENRE_SLUG_PATTERN = /^r[A-Za-z0-9]{1,30}$/;

export function akizukiGenreUrl(baseUrl: string, slug: string, page = 1): string {
  if (!AKIZUKI_GENRE_SLUG_PATTERN.test(slug)) throw new Error(`invalid genre slug ${slug}`);
  if (!Number.isInteger(page) || page < 1) throw new Error(`invalid page ${page}`);
  return page === 1 ? `${baseUrl}/catalog/r/${slug}/` : `${baseUrl}/catalog/r/${slug}_p${page}/`;
}
