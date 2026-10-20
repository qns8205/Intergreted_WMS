export interface ScenarioVariantDisplay {
  variantName?: string;
  variantPending?: boolean;
  variantUnassigned?: boolean;
}

export function scenarioVariantText(item: ScenarioVariantDisplay): string {
  if (item.variantPending) return "미정";
  if (item.variantName) return item.variantName === "종류 미정" ? "미정" : item.variantName === "종류 미확인" ? "미확인" : item.variantName;
  if (item.variantUnassigned) return "미확인";
  return "";
}

/** 같은 물품의 직전 대여·반납 종류를 알리는 문구. 촬영 다양성을 위해 같은 종류가 연달아 나가지 않게 보라색으로 띄운다. */
export function previousVariantLabel(kind: "대여" | "반납"): string {
  return `직전 ${kind}${kind === "반납" ? "과" : "와"} 같은 종류`;
}

/** 직전 대여·반납과 같은 종류에 마우스를 올렸을 때 보이는 설명. */
export function previousVariantTitle(use: { kind: "대여" | "반납"; at: string }): string {
  return `이 물품의 직전 ${use.kind}(${use.at})도 이 종류였습니다. 촬영 다양성을 위해 가능하면 다른 종류를 골라주세요.`;
}

/** 직전 대여·반납과 같은 종류 표시 색(보라). 관리자 대여 확인·반납 화면과 같은 색을 쓴다. */
export function previousVariantColors(isLightMode: boolean) {
  return {
    repeat: isLightMode ? "#7c3aed" : "#c4b5fd",
    repeatSoft: isLightMode ? "rgba(124,58,237,0.10)" : "rgba(196,181,253,0.16)",
  };
}
