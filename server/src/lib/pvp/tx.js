/** BEGIN IMMEDIATE. Nested calls are savepoints; don't start a second immediate inside one. */
export function withImmediate(db, fn) {
  return db.transaction(fn).immediate();
}
