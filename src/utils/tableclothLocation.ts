/**
 * 테이블보 보관 위치를 눈으로 구분하기 위한 도구.
 * 목록은 위치별로 끊어서 구분선과 함께 보여주고, 필터도 같은 묶음을 쓴다.
 *
 * 위치 문자열은 사람이 손으로 적어와서 표기가 흔들린다("B2 Box" / "B2 box", "B2" / "B02").
 * 그래서 비교·묶음은 정규화한 키로 하고, 화면에 보이는 이름은 실제로 가장 많이 쓰인 표기를 쓴다.
 */

/** 대소문자·공백·앞자리 0 차이를 없앤 비교용 키. */
export function locationKey(raw?: string): string {
  const s = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return "";
  // "b02" 와 "b2" 를 같은 곳으로 본다 — 실제로 같은 선반을 가리키며 표기만 갈렸다.
  return s.replace(/\b([a-z]+)0+(\d)/g, "$1$2");
}

/**
 * 위치 묶음을 "내가 있는 층"이 맨 앞에 오도록 다시 세운다.
 *
 * 천을 빌리러 가는 사람은 결국 걸어가야 해서, 같은 층에 있는 것부터 보는 게 자연스럽다.
 * 층 이름("2F")과 보관 위치("2F")는 같은 표기를 쓰므로 정규화 키로 맞춰 본다 —
 * 맞는 게 없으면(예: 층은 3F인데 천은 B1·COS에만 있다) 원래 순서를 그대로 둔다.
 */
export function withMyFloorFirst<T extends { key: string }>(options: T[], floor?: string): T[] {
  const mine = locationKey(floor);
  if (!mine) return options;
  const idx = options.findIndex((o) => o.key === mine);
  if (idx <= 0) return options;
  return [options[idx], ...options.slice(0, idx), ...options.slice(idx + 1)];
}

/** 어떤 위치가 "내 층"인지. 목록·필터에 표시를 달아 눈에 띄게 하는 데 쓴다. */
export function isMyFloor(locationOrKey: string | undefined, floor?: string): boolean {
  const mine = locationKey(floor);
  return !!mine && locationKey(locationOrKey) === mine;
}

/** 목록에서 위치 필터 후보를 뽑는다 — 표기가 갈린 것은 가장 많이 쓰인 쪽으로 합친다. */
export function locationOptions(items: { location?: string }[]): { key: string; label: string; count: number }[] {
  const groups = new Map<string, Map<string, number>>();
  for (const it of items) {
    const key = locationKey(it.location);
    if (!groups.has(key)) groups.set(key, new Map());
    const spellings = groups.get(key)!;
    const shown = String(it.location || "").trim() || "위치 미지정";
    spellings.set(shown, (spellings.get(shown) || 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, spellings]) => {
      let label = "", best = -1, count = 0;
      for (const [text, n] of spellings) {
        count += n;
        if (n > best) { best = n; label = text; }
      }
      return { key, label, count };
    })
    .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : a.label.localeCompare(b.label)));
}
