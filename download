/**
 * Parses various date formats into milliseconds since epoch.
 * Supported formats:
 * - "2026-07-10 02:40:00" (ISO/hyphenated)
 * - "2026. 7. 10. 오전 2:10:05" (Korean locale format)
 * - "2026. 7. 10. 오후 12:10:05" (Korean PM format)
 * - "7/10/2026 2:10:05 AM" (US locale format)
 * - Standard JS Dates / ISO Strings
 */
export function parseDateString(ts: string | undefined | null): number {
  if (!ts) return 0;
  
  const clean = ts.trim().replace(/\s+/g, " ");
  
  // 1. Try standard Date.parse
  const parsed = Date.parse(clean);
  if (!isNaN(parsed)) return parsed;

  // 2. Handle Korean format: "2026. 7. 10. 오전 2:10:05" or "2026. 7. 10. 오후 2:10:05"
  const koMatch = clean.match(/^(\d{4})[.-]\s*(\d{1,2})[.-]\s*(\d{1,2})[.]?\s*(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/i);
  if (koMatch) {
    const year = parseInt(koMatch[1], 10);
    const month = parseInt(koMatch[2], 10) - 1;
    const day = parseInt(koMatch[3], 10);
    const ampm = koMatch[4];
    let hour = parseInt(koMatch[5], 10);
    const minute = parseInt(koMatch[6], 10);
    const second = koMatch[7] ? parseInt(koMatch[7], 10) : 0;

    if (ampm) {
      const isPm = ampm === "오후" || ampm.toUpperCase() === "PM";
      const isAm = ampm === "오전" || ampm.toUpperCase() === "AM";
      if (isPm && hour < 12) {
        hour += 12;
      } else if (isAm && hour === 12) {
        hour = 0;
      }
    }
    
    const d = new Date(year, month, day, hour, minute, second);
    if (!isNaN(d.getTime())) {
      return d.getTime();
    }
  }

  // 3. Last fallback: extract all digit groups
  const digits = clean.match(/\d+/g);
  if (digits && digits.length >= 3) {
    const year = parseInt(digits[0], 10);
    const month = parseInt(digits[1], 10) - 1;
    const day = parseInt(digits[2], 10);
    const hour = digits[3] ? parseInt(digits[3], 10) : 0;
    const minute = digits[4] ? parseInt(digits[4], 10) : 0;
    const second = digits[5] ? parseInt(digits[5], 10) : 0;
    const d = new Date(year, month, day, hour, minute, second);
    if (!isNaN(d.getTime())) {
      return d.getTime();
    }
  }

  return 0;
}

/**
 * Compares two date strings in descending order (Newest first).
 */
export function compareDatesDescending(a: string | undefined | null, b: string | undefined | null): number {
  const timeA = parseDateString(a);
  const timeB = parseDateString(b);
  return timeB - timeA;
}

/**
 * Compares two date strings in ascending order (Oldest first).
 */
export function compareDatesAscending(a: string | undefined | null, b: string | undefined | null): number {
  const timeA = parseDateString(a);
  const timeB = parseDateString(b);
  return timeA - timeB;
}
