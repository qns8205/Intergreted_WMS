# SQLite 백업

운영 서버의 DB는 `/home/configds/wms/server/data/db.sqlite3`(WAL 모드)입니다. 서버에는 `sqlite3` CLI가 없지만, Node 24의 `node:sqlite`에 온라인 백업 API(`backup()`)가 있어서 **서비스를 멈추지 않고** 일관된 사본을 뜰 수 있습니다. 백업은 `/home/configds/backups/<타임스탬프>/`에 둡니다.

> 현재 자동 백업(cron)은 설정되어 있지 않습니다. 배포·DB 변경 전에 아래 1번을 수동으로 실행합니다.

## 1. 온라인 백업 (서비스 유지)

서버에서 (node는 PATH에 없어 전체 경로를 씁니다):

```bash
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p /home/configds/backups/$TS
cd /home/configds/wms
/home/configds/.nvm/versions/node/v24.19.0/bin/node --input-type=module -e "
import { DatabaseSync, backup } from 'node:sqlite';
const db = new DatabaseSync('server/data/db.sqlite3');
await backup(db, '/home/configds/backups/$TS/db.sqlite3');
console.log('backup ok');
"
```

> `/tmp/package.json`에 `"type":"module"`이 있어 일회성 스크립트는 `.mjs`로 두거나 `--input-type=module`을 씁니다.

## 2. 서비스를 멈추고 파일째 복사 (대안)

```bash
sudo systemctl stop wms
cd /home/configds/wms/server/data
cp db.sqlite3 db.sqlite3-wal db.sqlite3-shm /home/configds/backups/<타임스탬프>/
sudo systemctl start wms
```

**`-wal`과 `-shm`을 함께 복사해야 합니다.** WAL만 빠뜨리면 최신 데이터가 사라집니다.

## 3. 복구

```bash
sudo systemctl stop wms
cd /home/configds/wms/server/data
rm -f db.sqlite3-wal db.sqlite3-shm
cp /home/configds/backups/<원하는-백업>/db.sqlite3 db.sqlite3
sudo systemctl start wms
```

복구 전에 현재 DB를 1번 또는 2번으로 한 번 더 백업해 두세요.
