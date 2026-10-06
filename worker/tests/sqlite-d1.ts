import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Database } from "@cloudflare/workers-types";

export function createSqliteD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys=ON");
  sqlite.exec(readFileSync(new URL("../src/db/schema.sql", import.meta.url), "utf8"));
  for (const migration of ["0007_signals_prospective_history.sql", "0008_aureus_portfolio.sql", "0009_signals_immutability.sql"]) {
    sqlite.exec(readFileSync(new URL("../src/db/migrations/" + migration, import.meta.url), "utf8"));
  }
  let failureAt = -1;
  let failuresLeft = 0;
  const prepare = (sql: string, args: any[] = []) => ({
    sql, args,
    bind(...bound: any[]) { return prepare(sql, bound); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async all() { return { success: true, results: sqlite.prepare(sql).all(...args), meta: { changes: 0 } }; },
    async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, results: [], meta: { changes: Number(result.changes), rows_written: Number(result.changes) } }; },
  });
  const adapter = {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement, i) => {
          if (i === failureAt && failuresLeft > 0) { failuresLeft--; throw new Error("falha DB induzida"); }
          const result = sqlite.prepare(statement.sql).run(...statement.args);
          return { success: true, results: [], meta: { changes: Number(result.changes) } };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return { DB: adapter as unknown as D1Database, sqlite, failNextBatchAt(index: number) { failureAt = index; failuresLeft = 1; } };
}
