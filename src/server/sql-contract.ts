export type SqlValue = string | number | ArrayBuffer | null;
export interface SqlCursor<T extends Record<string, SqlValue> = Record<string, SqlValue>> extends Iterable<T> {
  toArray(): T[];
  one(): T;
}
export interface TenantSql {
  exec<T extends Record<string, SqlValue> = Record<string, SqlValue>>(query: string, ...bindings: SqlValue[]): SqlCursor<T>;
  readonly databaseSize: number | null;
  /**
   * How many bindings the adapter prepends to its own text before the caller's, for a read of
   * `table`. A tenant read is rewritten to merge the buffered writes, so the caller cannot know how
   * many parameters its own query will end up binding, and a caller that builds a long `IN (...)`
   * list has to budget against this rather than assume zero.
   */
  deltaBindings(table: string): number;
}
export interface TransactionRunner {
  transactionSync<T>(callback: () => T): T;
}
