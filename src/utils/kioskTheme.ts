// 무인 PC 화면(시나리오 물품·공구 대여/반납)이 함께 쓰는 색. 공구 화면도 같은 색과 크기를 써야
// 한 프로그램 안에서 화면이 바뀌어도 딴 프로그램처럼 보이지 않는다.
export interface KioskPalette {
  bg: string; panel: string; text: string; dim: string;
  border: string; accent: string; surface: string;
}

// 앱의 기본 테마는 라이트이며, 사용자가 명시적으로 다크 모드를 선택한 경우에만
// 같은 Planfit 계열의 차콜 팔레트로 전환한다.
export const kioskPalette = (isLightMode: boolean): KioskPalette => isLightMode ? {
  bg: "#f4f5f7", panel: "#ffffff",
  text: "#17191f", dim: "#70737d",
  border: "#e1e4e8", accent: "#0dbb9e", surface: "#f8f9fa",
} : {
  bg: "#18191e", panel: "#222329",
  text: "#f7f8fa", dim: "#9699a3",
  border: "#3a3c44", accent: "#25e0bd", surface: "#2b2d33",
};

export const KIOSK_ACCENT_SOFT = "rgba(37,224,189,.13)";
export const KIOSK_PRIMARY_BG = "#25e0bd";
export const KIOSK_PRIMARY_TEXT = "#0d1c18";
