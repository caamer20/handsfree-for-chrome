// All collection writers share this queue so a reviewed replacement and an
// import cannot commit snapshots read before another library mutation.
let pending: Promise<unknown> = Promise.resolve();
export function withLibraryWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => undefined);
  return result;
}
