import { useEffect } from "react";

export const VERSION_WORK_CHANGED_EVENT = "wms:version-work-changed";

export interface VersionWorkItem {
  id: string;
  label: string;
}

const activeWork = new Map<string, string>();

function notify() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(VERSION_WORK_CHANGED_EVENT));
}

export function getVersionWorkItems(): VersionWorkItem[] {
  return Array.from(activeWork, ([id, label]) => ({ id, label }));
}

export function hasVersionWorkInProgress(): boolean {
  return activeWork.size > 0;
}

/** 새 버전 발급 때 즉시 새로고침시키면 안 되는 작성/전송 작업을 등록한다. */
export function useVersionWorkGuard(id: string, active: boolean, label: string): void {
  useEffect(() => {
    if (active) activeWork.set(id, label);
    else activeWork.delete(id);
    notify();
    return () => {
      activeWork.delete(id);
      notify();
    };
  }, [id, active, label]);
}
