// Count interval coverage using sample indices instead of scanning every rental at every sample.
// Rentals are half-open [start, end): a return exactly at a sample is no longer out.
export function sampledStockoutRate(intervals, samples, owned) {
  if (!owned || !intervals?.length || !samples.length) return 0;
  const lowerBound = (value) => {
    let lo = 0, hi = samples.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (samples[mid] < value) lo = mid + 1; else hi = mid;
    }
    return lo;
  };
  const changes = new Float64Array(samples.length + 1);
  for (const [start, end, qty] of intervals) {
    const a = lowerBound(start), b = lowerBound(end);
    if (a >= b) continue;
    changes[a] += qty; changes[b] -= qty;
  }
  let out = 0, full = 0;
  for (let i = 0; i < samples.length; i++) {
    out += changes[i];
    if (out >= owned) full++;
  }
  return full / samples.length;
}
