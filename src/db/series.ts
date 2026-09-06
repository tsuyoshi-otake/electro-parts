import { planInsert, type ChangePoint, type Equal, type InsertPlan, type SeriesWindow } from '../core/history.ts';
import type { SQLInputValue } from 'node:sqlite';
import type { Db } from './connection.ts';

/**
 * Generic access to a change-point table. Each table has one or more key
 * columns identifying the entity, an `observed_at` column and state columns.
 * Inserting an observation only touches the three-point window around it, so
 * cost is O(log n) per observation regardless of series length.
 */
export interface SeriesSpec<S> {
  table: string;
  keyColumns: readonly string[];
  stateColumns: readonly string[];
  toRow(state: S): SQLInputValue[];
  fromRow(row: Record<string, unknown>): S;
  equal: Equal<S>;
  /** State in effect before the first change point, if the series has one. */
  initial?: { state: S };
}

export type SeriesKey = readonly (number | string)[];

export class SeriesAccess<S> {
  private readonly selectExisting;
  private readonly selectPrev;
  private readonly selectNext;
  private readonly selectAll;
  private readonly insertStmt;
  private readonly deleteStmt;

  constructor(
    db: Db,
    readonly spec: SeriesSpec<S>,
  ) {
    const where = spec.keyColumns.map((c) => `${c} = ?`).join(' AND ');
    const cols = ['observed_at', ...spec.stateColumns].join(', ');
    this.selectExisting = db.prepare(`SELECT ${cols} FROM ${spec.table} WHERE ${where} AND observed_at = ?`);
    this.selectPrev = db.prepare(
      `SELECT ${cols} FROM ${spec.table} WHERE ${where} AND observed_at < ? ORDER BY observed_at DESC LIMIT 1`,
    );
    this.selectNext = db.prepare(
      `SELECT ${cols} FROM ${spec.table} WHERE ${where} AND observed_at > ? ORDER BY observed_at ASC LIMIT 1`,
    );
    this.selectAll = db.prepare(`SELECT ${cols} FROM ${spec.table} WHERE ${where} ORDER BY observed_at ASC`);
    const insertCols = [...spec.keyColumns, 'observed_at', ...spec.stateColumns];
    this.insertStmt = db.prepare(
      `INSERT INTO ${spec.table}(${insertCols.join(', ')}) VALUES (${insertCols.map(() => '?').join(', ')})`,
    );
    this.deleteStmt = db.prepare(`DELETE FROM ${spec.table} WHERE ${where} AND observed_at = ?`);
  }

  private toPoint(row: unknown): ChangePoint<S> | undefined {
    if (row === undefined || row === null) return undefined;
    const r = row as Record<string, unknown>;
    return { t: r['observed_at'] as number, state: this.spec.fromRow(r) };
  }

  window(key: SeriesKey, t: number): SeriesWindow<S> {
    return {
      existing: this.toPoint(this.selectExisting.get(...key, t)),
      prev: this.toPoint(this.selectPrev.get(...key, t)),
      next: this.toPoint(this.selectNext.get(...key, t)),
    };
  }

  readAll(key: SeriesKey): ChangePoint<S>[] {
    return this.selectAll.all(...key).map((row) => this.toPoint(row) as ChangePoint<S>);
  }

  /**
   * Inserts an observation. `runs` are the ascending times in which the
   * entity was observed, excluding `obs.t`. Returns the applied plan together
   * with the window it was computed from (callers may derive extra columns).
   */
  insert(key: SeriesKey, obs: ChangePoint<S>, runs: readonly number[]): { plan: InsertPlan<S>; window: SeriesWindow<S> } {
    const window = this.window(key, obs.t);
    const plan = planInsert(window, obs, runs, this.spec.equal, this.spec.initial);
    this.apply(key, plan);
    return { plan, window };
  }

  apply(key: SeriesKey, plan: InsertPlan<S>): void {
    if (!plan.changed) return;
    for (const t of plan.deletes) this.deleteStmt.run(...key, t);
    for (const cp of plan.inserts) this.insertStmt.run(...key, cp.t, ...this.spec.toRow(cp.state));
  }
}
