# SQLite 정기 백업

`/var/wms/backups/`에 날짜별 백업 파일을 남기는 cron 작업입니다. SQLite의 온라인 백업 API(`.backup`)를 사용하므로 서버가 켜져 있는 동안에도 안전하게 백업할 수 있습니다.

## 1. 백업 스크립트

`/opt/wms/deploy/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

DB_PATH="/var/wms/db.sqlite3"
BACKUP_DIR="/var/wms/backups"
STAMP="$(date +%Y%m%d_%H%M%S)"

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/$STAMP.sqlite3'"

# 30일 지난 백업은 정리
find "$BACKUP_DIR" -name "*.sqlite3" -mtime +30 -delete
```

```bash
chmod +x /opt/wms/deploy/backup.sh
```

## 2. cron 등록 (매일 새벽 3시)

```bash
sudo crontab -e
```

```cron
0 3 * * * /opt/wms/deploy/backup.sh >> /var/log/wms-backup.log 2>&1
```

## 3. 복구

```bash
sudo systemctl stop wms
cp /var/wms/backups/<원하는-백업>.sqlite3 /var/wms/db.sqlite3
sudo systemctl start wms
```
