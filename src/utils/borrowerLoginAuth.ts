import type { SmBorrower } from "./borrowerAuth";

/** Share a blur/button request; never persist passwords or let an old response replace a new identity. */
export function createBorrowerLoginAuth(
  login: (employeeId: string, password: string) => Promise<SmBorrower>,
  logout: () => Promise<void>,
) {
  let user: SmBorrower | null = null;
  let generation = 0;
  let pending: { employeeId: string; generation: number; promise: Promise<SmBorrower> } | null = null;
  let clearing = Promise.resolve();
  return {
    async authenticate(employeeId: string, password: string): Promise<SmBorrower> {
      if (user?.employeeId === employeeId) return user;
      if (pending?.employeeId === employeeId && pending.generation === generation) return pending.promise;
      const started = generation;
      const cleared = clearing;
      const promise = (async () => {
        await cleared;
        try {
          const verified = await login(employeeId, password);
          if (started !== generation) throw Error("로그인 정보가 변경되었습니다. 다시 입력해주세요.");
          if (verified.employeeId !== employeeId) throw Error("로그인 사번을 확인해주세요.");
          user = verified;
          return verified;
        } finally { password = ""; }
      })();
      pending = { employeeId, generation: started, promise };
      try { return await promise; }
      finally { if (pending?.promise === promise) pending = null; }
    },
    invalidate(): Promise<void> {
      const oldPending = pending?.promise;
      const revoke = !!user || !!oldPending;
      user = null;
      pending = null;
      generation++;
      if (revoke) clearing = clearing.then(async () => {
        await oldPending?.catch(() => {});
        await logout();
      });
      return clearing;
    },
  };
}
