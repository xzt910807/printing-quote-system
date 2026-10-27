#!/usr/bin/env bash
# printing-quote 数据库每日备份脚本
# 用法：crontab -e 添加  0 3 * * * /path/to/printing-quote-system/scripts/backup.sh
# 依赖：mysqldump / mysql-client；备份保留 7 天；可选 scp 异地副本
set -euo pipefail

# ---------- 配置（从项目 .env 读取，缺省值兜底） ----------
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${APP_DIR}/.env"

get_env() { grep -E "^$1=" "${ENV_FILE}" 2>/dev/null | tail -1 | cut -d= -f2- || true; }

DB_HOST="$(get_env DB_HOST)"; DB_HOST="${DB_HOST:-localhost}"
DB_PORT="$(get_env DB_PORT)"; DB_PORT="${DB_PORT:-3306}"
DB_USER="$(get_env DB_USER)"; DB_USER="${DB_USER:-root}"
DB_PASSWORD="$(get_env DB_PASSWORD)"
DB_NAME="$(get_env DB_NAME)";  DB_NAME="${DB_NAME:-printing_quote}"

BACKUP_DIR="${BACKUP_DIR:-/var/backups/printing-quote}"
KEEP_DAYS=7
DATE_TAG="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/${DB_NAME}_${DATE_TAG}.sql.gz"

# 可选异地副本：scp 到备份机，未配置 BACKUP_REMOTE 则跳过
BACKUP_REMOTE="${BACKUP_REMOTE:-}"   # 形如 user@backup-host:/backups/printing-quote/

mkdir -p "${BACKUP_DIR}"

# ---------- 导出 ----------
export MYSQL_PWD="${DB_PASSWORD}"
mysqldump -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" \
  --single-transaction --quick --routines --triggers \
  "${DB_NAME}" | gzip > "${DUMP_FILE}"
unset MYSQL_PWD

# ---------- 清理 7 天前 ----------
find "${BACKUP_DIR}" -name "${DB_NAME}_*.sql.gz" -mtime +${KEEP_DAYS} -delete

# ---------- 可选异地副本 ----------
if [ -n "${BACKUP_REMOTE}" ]; then
  scp -o BatchMode=yes "${DUMP_FILE}" "${BACKUP_REMOTE}/" || echo "WARN: scp 异地备份失败（不影响本地备份）"
fi

echo "OK ${DUMP_FILE} ($(du -h "${DUMP_FILE}" | cut -f1))"
