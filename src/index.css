@import "tailwindcss";

/* ── 흐름 단계 슬라이딩 전환 (모든 화면에서 항상 로드) ── */
@keyframes wmsSlideInRight {
  from { opacity: 0.15; transform: translateX(90px); }
  to   { opacity: 1;    transform: translateX(0); }
}
@keyframes wmsSlideInLeft {
  from { opacity: 0.15; transform: translateX(-90px); }
  to   { opacity: 1;    transform: translateX(0); }
}
.step-forward { animation: wmsSlideInRight 0.5s cubic-bezier(0.16, 1, 0.3, 1); will-change: transform, opacity; }
.step-back    { animation: wmsSlideInLeft  0.5s cubic-bezier(0.16, 1, 0.3, 1); will-change: transform, opacity; }
@media (prefers-reduced-motion: reduce) {
  .step-forward, .step-back { animation: none; }
}
