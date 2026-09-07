/** Userscript version (independent of the data contract and the SQLite schema). */
export const USERSCRIPT_VERSION = '0.3.0';

/** Default origin of the published dataset. Overridable per install via the `dataBaseUrl` GM value. */
export const DEFAULT_DATA_BASE_URL = 'https://tsuyoshi-otake.github.io/electro-parts';

export const DATA_HOSTS = ['tsuyoshi-otake.github.io'] as const;
