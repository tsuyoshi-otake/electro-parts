import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Anchor: 2026-09-11 05:00 JST. Use elapsed days, not day-of-month,
// so 31-day months and leap years cannot create consecutive crawl days.
export function observationDue(event: string | undefined, cron: string | undefined, now = Date.now()): boolean {
  if (event !== 'schedule') return true;
  if (cron !== '0 20 * * *') throw new Error(`Unknown observation schedule: ${cron}`);
  if (!Number.isFinite(now)) throw new Error('Invalid schedule time');
  const days = Math.floor((now - Date.parse('2026-09-10T20:00:00Z')) / 86_400_000);
  return days % 2 === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const due = observationDue(process.env.GITHUB_EVENT_NAME, process.env.EVENT_CRON);
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  appendFileSync(process.env.GITHUB_OUTPUT, `due=${due}\n`);
  console.log(due ? 'Observation day (or manual run)' : 'Intervening day: no crawl or publication');
}
