/**
 * The tiny synchronous SQL surface the bot needs.
 *
 * Production runs on Durable Object SQLite (`ctx.storage.sql`), tests run on
 * `node:sqlite`. Both are real SQLite, so the same SQL text works in both;
 * only this adapter differs.
 */
export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

export interface Sql {
  all<T extends SqlRow = SqlRow>(query: string, ...params: SqlValue[]): T[];
  first<T extends SqlRow = SqlRow>(query: string, ...params: SqlValue[]): T | undefined;
  run(query: string, ...params: SqlValue[]): void;
  /** Runs `fn` atomically: either every write inside it lands or none do. */
  transaction<T>(fn: () => T): T;
}
