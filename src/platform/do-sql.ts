import type { Sql, SqlRow, SqlValue } from "./sql";

/** Adapts Durable Object SQLite storage to the shared `Sql` interface. */
export function durableObjectSql(storage: DurableObjectStorage): Sql {
  return {
    all<T extends SqlRow>(query: string, ...params: SqlValue[]): T[] {
      return storage.sql.exec<T>(query, ...params).toArray();
    },
    first<T extends SqlRow>(query: string, ...params: SqlValue[]): T | undefined {
      return storage.sql.exec<T>(query, ...params).toArray()[0];
    },
    run(query: string, ...params: SqlValue[]): void {
      // Draining the cursor guarantees the statement ran to completion.
      storage.sql.exec(query, ...params).toArray();
    },
    transaction<T>(fn: () => T): T {
      // DO SQLite rejects BEGIN/COMMIT statements; transactionSync is the supported way.
      return storage.transactionSync(fn);
    },
  };
}
