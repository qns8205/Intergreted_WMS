/** Adopt only our named systemd socket, and do not pass activation metadata to children. */
export function consumeHttpsSocket(env = process.env, pid = process.pid) {
  if (Number(env.LISTEN_PID) !== pid) return null;
  const count = Number(env.LISTEN_FDS);
  const names = String(env.LISTEN_FDNAMES || "").split(":");
  delete env.LISTEN_PID;
  delete env.LISTEN_FDS;
  delete env.LISTEN_FDNAMES;
  if (!Number.isInteger(count) || count < 1 || count > 64 || names.length !== count) {
    throw Error("잘못된 WMS systemd 소켓 설정입니다.");
  }
  const matches = names.flatMap((name, index) => name === "wms-https" ? [index + 3] : []);
  if (matches.length !== 1) throw Error("WMS HTTPS 소켓이 없거나 중복되었습니다.");
  return matches[0];
}
