import { parseKstMs } from "./time.js";

/**
 * 공지사항 규칙.
 *  - 대여자 로그인 직후 팝업은 "작성한 지 48시간 이내"의 공지만 띄운다.
 *  - 팝업은 서버 시각 기준으로 판정한다. 브라우저 시계나 시간대에 기대면 PC마다 결과가 달라진다.
 */
export const NOTICE_POPUP_HOURS = 48;

const toNotice = (r) => ({ title: r.title || undefined, text: r.content || "", updatedAt: r.created_at || undefined, author: r.author || undefined });

/**
 * 관리자 편집기에 보여줄 팝업 상태. 각 공지가 로그인 팝업에 아직 나가는지, 얼마나 남았는지.
 * remainingMinutes는 팝업이 끝날 때까지 남은 분(이미 끝났으면 0), active는 지금 팝업 대상인지.
 */
export function popupStatus(createdAt, nowMs = Date.now(), hours = NOTICE_POPUP_HOURS) {
  const at = parseKstMs(createdAt);
  if (!Number.isFinite(at)) return { active: false, remainingMinutes: 0, ageMinutes: null };
  const endMs = at + hours * 3600_000;
  return {
    active: nowMs <= endMs,
    remainingMinutes: Math.max(0, Math.ceil((endMs - nowMs) / 60_000)),
    ageMinutes: Math.max(0, Math.floor((nowMs - at) / 60_000)),
  };
}

/** 편집기용 공지 목록: 공지 내용 + 팝업 상태. 관리자가 적은 순서(id 오름차순) 그대로. */
export function noticesForEditor(rows, nowMs = Date.now()) {
  return rows.map((r) => ({ ...toNotice(r), popup: popupStatus(r.created_at, nowMs) }));
}

/** 작성 시각이 읽히고 hours 이내인 공지만 남긴다. 시각이 비었거나 읽을 수 없으면 오래된 것으로 본다. */
export function recentNotices(rows, nowMs = Date.now(), hours = NOTICE_POPUP_HOURS) {
  const limit = hours * 3600_000;
  return rows
    .filter((r) => {
      const at = parseKstMs(r.created_at);
      return Number.isFinite(at) && nowMs - at <= limit;
    })
    .map(toNotice);
}

/**
 * 공지를 저장할 때 각 공지에 넣을 작성 시각·작성자를 정한다.
 *
 * 저장은 공지 전체를 지우고 다시 넣는 방식이라, 그냥 두면 이미 있던 공지도 전부 "방금 작성"이 된다.
 * 그러면 오래전 공지가 48시간 팝업으로 다시 뜬다. 그래서 제목·내용이 그대로인 공지는 기존 작성 시각과
 * 작성자를 이어받고, 새로 쓴 공지나 내용을 고친 공지만 지금 시각으로 찍는다(고친 공지는 다시 알려야 하므로).
 * 같은 내용의 공지가 여러 개여도 기존 행을 하나씩만 짝지어 쓴다.
 *
 * @param existing  지금 DB의 공지 행들(created_at, author, title, content)
 * @param incoming  저장하려는 공지들({ title, text })
 * @returns [{ createdAt, author }] — incoming과 같은 순서
 */
export function carryNoticeTimes(existing, incoming, now, author) {
  const pool = existing.map((r) => ({ key: noticeKey(r.title, r.content), createdAt: r.created_at, author: r.author, used: false }));
  return incoming.map((n) => {
    const key = noticeKey(n.title, n.text);
    const match = pool.find((p) => !p.used && p.key === key && p.createdAt);
    if (match) {
      match.used = true;
      return { createdAt: match.createdAt, author: match.author ?? author ?? null };
    }
    return { createdAt: now, author: author ?? null };
  });
}

const noticeKey = (title, text) => `${String(title ?? "").trim()}\u0000${String(text ?? "").trim()}`;
