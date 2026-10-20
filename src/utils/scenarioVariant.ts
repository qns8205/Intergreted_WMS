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
