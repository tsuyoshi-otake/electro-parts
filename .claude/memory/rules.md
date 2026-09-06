# Rules (distilled, verified)

- **Akizuki WAF rejects User-Agents containing the word `crawler` with 403.** A descriptive project UA with a contact URL (`electro-parts-price-history/0.1 (+https://github.com/...; research)`) is accepted. Never fake a browser UA; if refused, stop.
- **`curl.exe` on this box segfaults on some HTTPS hosts.** Use `node -e "fetch(...)"` for live probes instead.
- **Bash heredocs in this harness mangle content**: `\\0` becomes a NUL byte, `\\01` an octal escape, and non-ASCII (Japanese) can arrive as broken bytes; long heredocs with many quotes fail with "unexpected EOF while looking for matching `''". Write whole files with the Write tool (or a Python script written with Write, then executed). Patch bytes with `python -c` using `chr()`.
- **The Edit tool interprets `\u0000` in `old_string`.** Use `String.fromCharCode(0)` in source and avoid escape sequences in the match text.
- **Bash cwd resets on every call.** Always `cd "C:\Codes\tsuyoshi-otake\electro-parts"` first (the worktree path is only a pointer for this session).
- **`basisKey` joins fields with `\u0000` and encodes a null `unitLabel` as `\u0001`.** Tests must build expected keys with `String.fromCharCode`.
- **`npm run pipeline -- summary` is wrong**: the script already contains `pipeline`. Use `node --import tsx src/cli/main.ts summary --report ...`.
- **Sanity thresholds are strict `>`.** A drop of exactly the threshold is not quarantined; tests must use the boundary in both directions.
- **Stryker with `vitest.related: true` produced 100 NoCoverage mutants (68.95 %)**; `related: false, dir: 'tests'` plus targeted guard tests gives 89.45 %. Keep `related: false`.
- **Buffer → ArrayBuffer**: slice with `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)`; a pooled Buffer's `.buffer` is larger than the data.
- **jsdom fixtures**: building test DOMs with `innerHTML` is fine in tests, but the production bundle must never contain HTML-string sinks (CI greps the bundle).
- **Playwright needs `npx playwright install chromium`** once per machine; in CI `--with-deps`.
- **After test / bench runs, verify processes exited** (`Get-CimInstance Win32_Process` filtered on the command line). Long benches run for 30+ min; do not block on them.
- **Full 9,000-product daily benchmark takes ~3 min (1 y), ~10 min (3 y), ~20 min (5 y) of import time.** Run it in the background and write results to a file outside the repo.
