import React, { useEffect, useState } from "react";

interface Props {
  // 순서대로 순환할 사진 URL들(대표 사진 먼저, 그 뒤로 추가 사진). 1장뿐이면 고정으로 보여준다.
  photos: string[];
  alt?: string;
  style?: React.CSSProperties;
  referrerPolicy?: React.HTMLAttributeReferrerPolicy;
}

/** 대표 사진 + 추가 사진을 5초마다 자동으로 넘겨가며 보여주는 목록/그리드용 썸네일. */
export default function ItemThumbnailSlideshow({ photos, alt, style, referrerPolicy }: Props) {
  const [idx, setIdx] = useState(0);
  // photos는 부모가 매 렌더마다 새 배열을 만들어 넘길 수 있어, 배열 참조가 아니라
  // 내용(join)을 의존성으로 써야 5초 주기가 렌더마다 리셋되지 않는다.
  const key = photos.join("|");
  useEffect(() => {
    setIdx(0);
    if (photos.length <= 1) return;
    const timer = window.setInterval(() => {
      setIdx((i) => (i + 1) % photos.length);
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (photos.length === 0) return null;
  return (
    <img
      src={photos[idx % photos.length]}
      alt={alt || ""}
      loading="lazy"
      decoding="async"
      referrerPolicy={referrerPolicy}
      style={style}
    />
  );
}
