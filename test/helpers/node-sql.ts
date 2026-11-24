import { DatabaseSync } from "node:sqlite";
import type { Sql, SqlRow, SqlValue } from "../../src/platform/sql";

/** `node:sqlite` behind the same interface the Durable Object uses. */
export function nodeSql(db = new DatabaseSync(":memory:")): Sql {
  return {
    all<T extends SqlRow>(query: string, ...params: SqlValue[]): T[] {
      return db.prepare(query).all(...params) as T[];
    },
    first<T extends SqlRow>(query: string, ...params: SqlValue[]): T | undefined {
      return db.prepare(query).get(...params) as T | undefined;
    },
    run(query: string, ...params: SqlValue[]): void {
      db.prepare(query).run(...params);
    },
    transaction<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
