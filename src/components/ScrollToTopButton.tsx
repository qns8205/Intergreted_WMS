import React, { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

/**
 * 화면 우측 하단에 떠 있는 "맨 위로" 버튼.
 * 렌더된 위치에서 가장 가까운 스크롤 가능한 조상 요소를 자동으로 찾아서(없으면 window),
 * 일정량 이상 스크롤됐을 때만 나타난다.
 */
export default function ScrollToTopButton() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const scrollElRef = useRef<HTMLElement | Window | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let el: HTMLElement | null = anchorRef.current ? anchorRef.current.parentElement : null;
    let target: HTMLElement | Window = window;
    while (el) {
      const style = window.getComputedStyle(el);
      if ((style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight) {
        target = el;
        break;
      }
      el = el.parentElement;
    }
    scrollElRef.current = target;

    const handler = () => {
      const top = target === window ? window.scrollY : (target as HTMLElement).scrollTop;
      setVisible(top > 300);
    };
    target.addEventListener("scroll", handler);
    handler();
    return () => target.removeEventListener("scroll", handler);
  }, []);

  function scrollToTop() {
    const target = scrollElRef.current;
    if (!target) return;
    if (target === window) window.scrollTo({ top: 0, behavior: "smooth" });
    else (target as HTMLElement).scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <div ref={anchorRef} style={{ display: "none" }} />
      {visible ? (
        <button
          onClick={scrollToTop}
          title="맨 위로"
          style={{
            position: "fixed",
            bottom: "28px",
            right: "28px",
            zIndex: 500,
            width: "46px",
            height: "46px",
            borderRadius: "50%",
            border: "none",
            background: "#2563eb",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            boxShadow: "0 6px 18px rgba(37,99,235,0.45)",
          }}
        >
          <ArrowUp size={20} />
        </button>
      ) : null}
    </>
  );
}
