export type SqlValue = string | number | null;

export interface Statement {
  sql: string;
  params?: SqlValue[];
}

/**
 * The only way the app reaches its database. The desktop app implements it over the native
 * core; tests implement it over an in-memory SQLite database.
 */
export interface SqlDriver {
  select<Row = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<Row[]>;
  /** Runs every statement in one transaction: all of them are applied, or none. */
  batch(statements: Statement[]): Promise<void>;
}
