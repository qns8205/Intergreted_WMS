/** Short-lived, bounded read cache. Concurrent callers share one request; failures are never cached. */
export function createRequestCache<T>(ttlMs: number, maxEntries = 6, now = Date.now) {
  const entries = new Map<string, { until: number; value?: T; pending?: Promise<T> }>();
  const trim = () => {
    for (const [oldKey, oldEntry] of entries) {
      if (entries.size <= maxEntries) break;
      if (!oldEntry.pending) entries.delete(oldKey);
    }
  };
  return (key: string, fetcher: () => Promise<T>, fresh = false): Promise<T> => {
    const previous = entries.get(key);
    if (previous?.pending) return previous.pending;
    if (!fresh && previous && previous.until > now()) return Promise.resolve(previous.value!);
    const entry: { until: number; value?: T; pending?: Promise<T> } = { until: 0 };
    entry.pending = Promise.resolve().then(fetcher).then(value => {
      entry.value = value; entry.until = now() + ttlMs; entry.pending = undefined;
      trim();
      return value;
    }, error => { if (entries.get(key) === entry) entries.delete(key); throw error; });
    entries.delete(key);
    entries.set(key, entry);
    // Don't evict in-flight requests and accidentally start duplicate work.
    trim();
    return entry.pending;
  };
}
