import { useEffect, useState } from "react";

/** 새 안내가 열릴 때마다 최소 5초 동안 읽을 시간을 확보한다. */
export function useNoticeCountdown(noticeKey: string | null): number {
  const [countdown, setCountdown] = useState<{ key: string | null; remaining: number }>({ key: noticeKey, remaining: noticeKey === null ? 0 : 5 });

  useEffect(() => {
    if (noticeKey === null) {
      setCountdown({ key: null, remaining: 0 });
      return;
    }
    const deadline = Date.now() + 5_000;
    setCountdown({ key: noticeKey, remaining: 5 });
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1_000));
      setCountdown({ key: noticeKey, remaining });
      if (remaining === 0) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [noticeKey]);

  // 새로운 안내의 첫 렌더에서도 이전 안내의 '0초' 상태로 확인할 수 없게 한다.
  return noticeKey === null ? 0 : countdown.key === noticeKey ? countdown.remaining : 5;
}
