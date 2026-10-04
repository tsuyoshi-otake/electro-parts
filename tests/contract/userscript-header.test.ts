import { describe, expect, it } from 'vitest';
import { userscriptHeader } from '../../scripts/build-userscript.ts';
import { PAGE_ADAPTERS } from '../../userscript/adapters/registry.ts';
import { EXCHANGE_RATE_URL } from '../../userscript/core/exchangeRate.ts';
import { DATA_HOSTS, DEFAULT_DATA_BASE_URL } from '../../userscript/version.ts';

/**
 * Tampermonkey enforces `@connect` for GM_xmlhttpRequest, so the header is the
 * userscript's network allowlist: the data origin, the one exchange rate host,
 * and nothing else.
 */

const values = (header: string, key: string) =>
  header.split('\n').filter((line) => line.startsWith(`// ${key} `)).map((line) => line.slice(`// ${key} `.length).trim());

describe('userscript header', () => {
  const header = userscriptHeader(DEFAULT_DATA_BASE_URL);

  it('connects to the data origin and the exchange rate host only', () => {
    expect(values(header, '@connect')).toEqual([...DATA_HOSTS, 'open.er-api.com']);
    expect(new URL(EXCHANGE_RATE_URL).hostname).toBe('open.er-api.com');
  });

  it('matches exactly the registered adapters and grants only GM storage and requests', () => {
    expect(values(header, '@match')).toEqual(PAGE_ADAPTERS.flatMap((a) => [...a.matchPatterns]));
    expect(values(header, '@grant')).toEqual(['GM_xmlhttpRequest', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues']);
  });
});
