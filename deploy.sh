#!/usr/bin/env bash
set -Eeuo pipefail

cd "$(dirname "$0")"

if [[ ! -f .env ]]; then
  echo "错误：缺少 .env，请先从 .env.example 复制并填写。" >&2
  exit 1
fi

for command_name in docker date; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "错误：缺少命令 $command_name。" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "错误：Docker Compose 插件不可用。" >&2
  exit 1
fi

if [[ "${1:-}" == "--pull" ]]; then
  if ! command -v git >/dev/null 2>&1; then
    echo "错误：缺少 git，不能使用 --pull。" >&2
    exit 1
  fi
  if [[ ! -d .git ]]; then
    echo "错误：当前目录不是 Git 仓库，不能使用 --pull。" >&2
    exit 1
  fi
  git pull --ff-only
fi

project_name="${COMPOSE_PROJECT_NAME:-english-start}"
compose=(docker compose -p "$project_name" -f docker-compose.yml)

if [[ -f /etc/centos-release ]] && grep -q "CentOS Linux release 7" /etc/centos-release; then
  compose+=(-f docker-compose.centos7.yml)
fi

backup_dir="${BACKUP_DIR:-.backups}"
mkdir -p "$backup_dir" storage/avatars
chmod 700 "$backup_dir"

timestamp="$(date +%Y%m%d_%H%M%S)"
backup_file="$backup_dir/english_start_${timestamp}.dump"

on_error() {
  echo "部署失败：请查看上方错误和 API 日志。" >&2
}
trap on_error ERR

echo "[1/6] 启动并检查 PostgreSQL"
"${compose[@]}" up -d postgres

database_ready=false
for _ in $(seq 1 60); do
  status="$(docker inspect english-start-postgres-v2 --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    database_ready=true
    break
  fi
  sleep 2
done

if [[ "$database_ready" != "true" ]]; then
  "${compose[@]}" logs --tail=100 postgres
  echo "错误：PostgreSQL 未在规定时间内进入健康状态。" >&2
  exit 1
fi

echo "[2/6] 备份数据库到 $backup_file"
"${compose[@]}" exec -T postgres \
  pg_dump -U postgres -d english_start -Fc > "$backup_file"

if [[ ! -s "$backup_file" ]]; then
  echo "错误：数据库备份文件为空。" >&2
  exit 1
fi

echo "[3/6] 构建并验证新版 API 镜像"
if ! "${compose[@]}" build api; then
  echo "Docker Hub 构建失败，切换到国内镜像代理重试。"
  "${compose[@]}" build \
    --build-arg NODE_IMAGE=m.daocloud.io/docker.io/library/node:24-bookworm-slim \
    api
fi

echo "[4/6] 应用数据库 migration 和 seed"
"${compose[@]}" --profile deploy run --rm migrate

echo "[5/6] 切换到新版 API"
managed_project="$(docker inspect english-start-api --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
if [[ -n "$(docker ps -a --filter name='^/english-start-api$' --format '{{.Names}}')" && "$managed_project" != "$project_name" ]]; then
  echo "发现旧的手工 API 容器，切换前将其移除。"
  docker rm -f english-start-api >/dev/null
fi
"${compose[@]}" up -d --no-deps api

api_ready=false
for _ in $(seq 1 60); do
  status="$(docker inspect english-start-api --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    api_ready=true
    break
  fi
  sleep 2
done

if [[ "$api_ready" != "true" ]]; then
  "${compose[@]}" logs --tail=100 api
  echo "错误：新版 API 未通过健康检查。" >&2
  exit 1
fi

echo "[6/6] 部署完成"
"${compose[@]}" ps
echo "数据库备份：$backup_file"
echo "健康检查：http://127.0.0.1:${API_PORT:-3000}/health"
