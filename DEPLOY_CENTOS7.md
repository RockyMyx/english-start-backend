# 单词练练后端 CentOS 7 通用部署与运维手册

> 适用项目：`english-start-backend`
>
> 部署环境：CentOS 7、Docker、Docker Compose
> 最后更新：2026-07-28

## 1. 使用范围

本文档记录已经在当前 CentOS 7 服务器上验证成功的部署方法，包含：

- Docker 和国内镜像源准备。
- PostgreSQL 17 启动。
- CentOS 7 的 PostgreSQL seccomp 兼容处理。
- Node.js 24 容器内安装依赖、运行 Prisma 和编译 TypeScript。
- Fastify API 启动、验证和更新。
- 前后端版本一致性检查。
- 数据库查看、备份和恢复。
- 云平台安全组、小程序开发版和正式版注意事项。
- 本次部署中实际遇到的错误及处理方法。

CentOS 7 已停止常规维护，无法直接可靠运行新版 Node.js 官方宿主机二进制。本文不升级
宿主系统，而是把 Node.js、Prisma 和 PostgreSQL 全部放入容器中运行。

## 2. 当前架构

```text
微信小程序开发版
        |
        | HTTP :3000（仅开发测试）
        v
english-start-api
Node.js 24 + Fastify
        |
        | Docker 内部网络 :5432
        v
english-start-postgres-v2
PostgreSQL 17
        |
        v
Docker 命名数据卷
```

当前仓库的 `docker-compose.yml` 只定义 PostgreSQL，不包含 API 服务。因此：

- PostgreSQL 使用 `docker compose` 管理。
- Node 依赖安装、Prisma 和编译使用临时 Node 容器。
- API 使用独立的 `english-start-api` 容器运行。
- `dist`、`node_modules` 和头像保存在服务器项目目录。
- PostgreSQL 数据保存在 Docker 命名卷。

## 3. 固定名称和目录

本文统一使用：

| 项目 | 值 |
| --- | --- |
| 项目目录 | `/opt/english-start-backend` |
| 备份目录 | `/opt/backups/english-start` |
| Compose 项目名 | `english-start` |
| API 容器 | `english-start-api` |
| 数据库容器 | `english-start-postgres-v2` |
| 数据库 | `english_start` |
| API 端口 | `3000` |
| PostgreSQL 端口 | `5432` |

文档中的占位符必须按实际部署环境填写：

| 占位符 | 含义 |
| --- | --- |
| `SERVER_PUBLIC_IP` | 目标服务器公网 IP，仅用于开发测试 |
| `API_DOMAIN` | 正式 API 域名 |
| `DB_PASSWORD` | PostgreSQL 高强度密码 |
| `/实际路径/english-start-backend` | 服务器上的实际项目目录 |

本文不记录任何真实公网 IP、正式域名、账号、密码、密钥或云服务器实例标识。

如果实际代码目录不同，进入真实目录后再执行本文命令：

```bash
cd /实际路径/english-start-backend
pwd
```

## 4. 部署前检查

```bash
cat /etc/centos-release
uname -a
free -h
df -h
timedatectl
```

建议至少准备：

- 2 核 CPU。
- 4 GB 内存。
- 30 GB 磁盘。
- 可用公网连接。
- 云平台安全组允许受信任来源访问 SSH `22`。

创建目录：

```bash
mkdir -p /opt/english-start-backend
mkdir -p /opt/backups/english-start
chmod 700 /opt/backups/english-start
```

## 5. Docker 准备

### 5.1 必需组件

- Docker Engine。
- Docker CLI。
- containerd。
- Docker Compose 插件。

检查：

```bash
docker version
docker compose version
containerd --version
```

启动并设置开机启动：

```bash
systemctl enable docker
systemctl start docker
systemctl status docker --no-pager
```

当前流程不依赖 `docker-buildx-plugin`。Compose 插件必须可用。

### 5.2 CentOS 7 软件源错误

如果安装时出现：

```text
[Errno 256] No more mirrors to try
```

原因通常是 CentOS 7 默认源停止维护，或者所选 Docker 镜像不包含指定 RPM。

处理原则：

1. 将 CentOS 源切换到 Vault 或可用的国内归档源。
2. 使用可访问的 Docker CE 国内镜像。
3. 清理缓存后重试。

```bash
yum clean all
rm -rf /var/cache/yum
yum makecache
```

Docker 已经安装成功时不要重复修改软件源。

### 5.3 Docker Hub 超时

错误示例：

```text
Get "https://registry-1.docker.io/v2/":
Client.Timeout exceeded while awaiting headers
```

如果 `/etc/docker/daemon.json` 不存在，可以配置：

```json
{
  "registry-mirrors": [
    "https://mirror.ccs.tencentyun.com"
  ]
}
```

文件已存在时应合并 JSON，不要覆盖其他 Docker 设置。

```bash
systemctl daemon-reload
systemctl restart docker
docker info
```

备用镜像代理：

```bash
docker pull m.daocloud.io/docker.io/library/postgres:17-alpine
docker tag m.daocloud.io/docker.io/library/postgres:17-alpine postgres:17-alpine

docker pull m.daocloud.io/docker.io/library/node:24-bookworm-slim
docker tag m.daocloud.io/docker.io/library/node:24-bookworm-slim node:24-bookworm-slim
```

## 6. 上传代码

将完整后端代码复制到服务器项目目录，至少包括：

```text
prisma/
src/
docker-compose.yml
package.json
package-lock.json
prisma.config.ts
tsconfig.json
```

更新代码时必须同时上传：

- `src` 源码。
- `prisma/schema.prisma`。
- 新增的 `prisma/migrations`。
- `package.json` 和 `package-lock.json`。

不要从本地覆盖服务器的：

```text
.env
storage/avatars/
```

不要依赖从开发电脑复制来的 `dist` 和 `node_modules`，应在服务器的 Linux Node 容器中
重新生成。

## 7. 环境变量

创建服务器环境文件：

```bash
cd /opt/english-start-backend
cp .env.example .env
chmod 600 .env
vi .env
```

### 7.1 开发测试配置

```dotenv
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:DB_PASSWORD@english-start-postgres-v2:5432/english_start?schema=public
CORS_ORIGIN=*
DEV_LOGIN_ENABLED=true
SESSION_TTL_DAYS=30
AVATAR_STORAGE_PATH=/app/storage/avatars
AI_EVALUATION_PROVIDER=rules
```

如果配置智谱：

```dotenv
AI_EVALUATION_PROVIDER=zhipu
ZHIPU_API_KEY=通过安全方式填写
```

如果配置 Azure 语音：

```dotenv
AZURE_TTS_ENDPOINT=通过安全方式填写
AZURE_TTS_KEY=通过安全方式填写
AZURE_TTS_REGION=通过安全方式填写
AZURE_SPEECH_VOICE=en-US-JennyNeural
```

注意：

- 容器内数据库主机不能写 `localhost`。
- 当前真实数据库容器名是 `english-start-postgres-v2`。
- `.env` 不得提交到 Git。
- 不得把 `.env`、AppSecret、数据库密码和 API Key 发到聊天或日志。
- `postgres` 只是测试密码，正式环境必须更换。

## 8. CentOS 7 PostgreSQL 兼容配置

部分 CentOS 7 服务器运行 `postgres:17-alpine` 时，可能出现：

```text
could not write to file "postmaster.pid": Operation not permitted
could not write to file "pg_wal/xlogtemp.*": Operation not permitted
```

容器会不断显示 `restarting`。这是 CentOS 7 老内核与新版容器 seccomp 策略的兼容问题。

创建覆盖文件：

```bash
tee docker-compose.centos7.yml >/dev/null <<'EOF'
services:
  postgres:
    security_opt:
      - seccomp:unconfined
EOF
```

验证 Compose：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.centos7.yml \
  -p english-start \
  config
```

该设置只应用于 PostgreSQL，不要给所有容器添加 `seccomp:unconfined`。

## 9. 首次启动数据库

拉取镜像：

```bash
docker pull postgres:17-alpine
docker pull node:24-bookworm-slim
```

启动 PostgreSQL：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.centos7.yml \
  -p english-start \
  up -d postgres
```

检查：

```bash
docker ps -a --filter name=english-start-postgres-v2
docker logs --tail=100 english-start-postgres-v2
```

数据库健康检查：

```bash
docker exec english-start-postgres-v2 \
  pg_isready -U postgres -d english_start
```

正常结果：

```text
/var/run/postgresql:5432 - accepting connections
```

获取 Docker 网络：

```bash
APP_NETWORK=$(docker inspect english-start-postgres-v2 \
  --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}}{{end}}')

echo "$APP_NETWORK"
```

通常输出：

```text
english-start_default
```

测试容器间连接：

```bash
docker run --rm \
  --network "$APP_NETWORK" \
  postgres:17-alpine \
  pg_isready \
  -h english-start-postgres-v2 \
  -U postgres \
  -d english_start
```

## 10. 构建、迁移和初始化数据

创建头像目录：

```bash
mkdir -p storage/avatars
```

执行：

```bash
APP_NETWORK=$(docker inspect english-start-postgres-v2 \
  --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}}{{end}}')

docker run --rm \
  --network "$APP_NETWORK" \
  --env-file "$PWD/.env" \
  -v "$PWD:/app" \
  -w /app \
  node:24-bookworm-slim \
  sh -lc '
    apt-get update &&
    apt-get install -y --no-install-recommends openssl ca-certificates &&
    npm config set registry https://registry.npmmirror.com &&
    npm ci &&
    npm run build &&
    npm run prisma:deploy &&
    npm run db:seed
  '
```

说明：

1. `openssl` 解决 Prisma 在 slim 镜像中的 OpenSSL 检测问题。
2. `npm ci` 根据锁文件安装一致的依赖并生成 Prisma Client。
3. `npm run build` 生成 `dist`。
4. `prisma:deploy` 应用已有 migration。
5. `db:seed` 使用 upsert 初始化或更新共享内容。

确认入口文件：

```bash
ls -l dist/src/server.js
```

不存在时不要启动 API，应先处理构建错误。

## 11. 启动 API

删除旧 API 容器：

```bash
docker rm -f english-start-api 2>/dev/null || true
```

启动开发测试 API：

```bash
APP_NETWORK=$(docker inspect english-start-postgres-v2 \
  --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}}{{end}}')

docker run -d \
  --name english-start-api \
  --restart unless-stopped \
  --network "$APP_NETWORK" \
  --env-file "$PWD/.env" \
  -e NODE_ENV=development \
  -e DEV_LOGIN_ENABLED=true \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e AVATAR_STORAGE_PATH=/app/storage/avatars \
  -p 3000:3000 \
  -v "$PWD:/app" \
  -w /app \
  node:24-bookworm-slim \
  node dist/src/server.js
```

检查：

```bash
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker logs --tail=100 english-start-api
curl http://127.0.0.1:3000/health
```

正确结果：

```json
{"status":"ok"}
```

公网测试，将 `SERVER_PUBLIC_IP` 替换为目标服务器的公网 IP：

```text
http://SERVER_PUBLIC_IP:3000/health
```

## 12. 前后端版本一致性

健康检查成功只代表 API 进程启动，并不能证明服务器包含前端需要的最新路由。

每次新增前端接口后，都应完成以下检查：

```text
前端请求路径
    =
后端 src/app.ts 注册路径
    =
服务器 dist/src/app.js 编译路径
    =
运行容器 /app/dist/src/app.js 中的路径
```

### 12.1 每日计划版本要求

每日计划功能要求部署的后端源码和编译产物包含：

```text
GET /daily-plans/today
GET /daily-plans/:id/tasks/:taskKey/words
```

以及数据库迁移：

```text
20260727203000_daily_plan_and_spaced_review
```

检查服务器源码：

```bash
grep -n 'daily-plans/today' src/app.ts
```

检查编译产物：

```bash
grep -n 'daily-plans/today' dist/src/app.js
```

检查运行容器中的代码：

```bash
docker exec english-start-api \
  grep -n 'daily-plans/today' /app/dist/src/app.js
```

检查容器挂载路径：

```bash
docker inspect english-start-api \
  --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
```

期望当前项目目录挂载到：

```text
/app
```

### 12.2 路由存在性验证

不携带登录令牌请求受保护路由：

```bash
curl -i http://127.0.0.1:3000/daily-plans/today
```

正确结果应为：

```text
HTTP/1.1 401 Unauthorized
```

`401` 说明路由存在，只是没有登录。

如果返回：

```text
404
Route GET:/daily-plans/today not found
```

说明运行中的后端版本没有注册该路由，不是数据库错误。

如果路由存在但数据库 migration 缺失，通常会返回 `500`，并在 API 日志中出现数据库表
或字段不存在的错误。

### 12.3 检查每日计划迁移

```bash
docker exec english-start-postgres-v2 \
  psql -U postgres -d english_start \
  -c "SELECT migration_name, finished_at FROM \"_prisma_migrations\" WHERE migration_name = '20260727203000_daily_plan_and_spaced_review';"
```

必须能看到该 migration 已完成。

## 13. 小程序开发版配置

前端配置：

```js
module.exports = {
  apiBaseUrl: "http://SERVER_PUBLIC_IP:3000",
  useDevLogin: true
};
```

微信开发者工具中：

1. 关闭合法域名、TLS 和 HTTPS 证书校验。
2. 清除全部缓存。
3. 重新编译。
4. 在网络面板确认请求目标是配置的 `SERVER_PUBLIC_IP:3000`。

后端对应设置：

```dotenv
NODE_ENV=development
DEV_LOGIN_ENABLED=true
```

HTTP IP 只适合开发工具调试，不作为正式发布地址。

## 14. 云平台安全组

开发测试阶段：

| 协议 | 端口 | 来源 |
| --- | --- | --- |
| TCP | 3000 | 开发电脑公网 IP/32 |

临时使用 `0.0.0.0/0` 后，应立即限制来源。

不要开放：

- PostgreSQL `5432`。
- Docker API。
- 无明确用途的管理端口。

服务器本机健康检查成功，但公网失败时检查：

```bash
docker ps --format 'table {{.Names}}\t{{.Ports}}'
ss -lntp | grep 3000
firewall-cmd --state
```

`firewalld not running` 表示系统防火墙没有运行，不会导致 `Connection refused`。

## 15. 标准更新部署流程

正确顺序：

```text
备份
→ 更新完整源码和 migration
→ 安装依赖
→ 编译
→ 迁移数据库
→ 更新 seed
→ 重建 API
→ 验证路由和业务
```

### 15.1 备份

```bash
BACKUP_FILE="/opt/backups/english-start/english_start_$(date +%Y%m%d_%H%M%S).dump"

umask 077
docker exec english-start-postgres-v2 \
  pg_dump -U postgres -d english_start -Fc > "$BACKUP_FILE"

ls -lh "$BACKUP_FILE"
```

### 15.2 更新代码

使用 Git：

```bash
git status
git pull --ff-only
git log -1 --oneline
```

手工上传时：

- 上传整个最新后端项目。
- 保留 `.env`。
- 保留 `storage/avatars`。
- 确认新增 migration 已上传。

### 15.3 构建并迁移

```bash
APP_NETWORK=$(docker inspect english-start-postgres-v2 \
  --format '{{range $name,$value := .NetworkSettings.Networks}}{{$name}}{{end}}')

docker run --rm \
  --network "$APP_NETWORK" \
  --env-file "$PWD/.env" \
  -v "$PWD:/app" \
  -w /app \
  node:24-bookworm-slim \
  sh -lc '
    apt-get update &&
    apt-get install -y --no-install-recommends openssl ca-certificates &&
    npm config set registry https://registry.npmmirror.com &&
    npm ci &&
    npm run build &&
    npm run prisma:deploy &&
    npm run db:seed
  '
```

### 15.4 重建 API

```bash
docker rm -f english-start-api

docker run -d \
  --name english-start-api \
  --restart unless-stopped \
  --network "$APP_NETWORK" \
  --env-file "$PWD/.env" \
  -e HOST=0.0.0.0 \
  -e PORT=3000 \
  -e AVATAR_STORAGE_PATH=/app/storage/avatars \
  -p 3000:3000 \
  -v "$PWD:/app" \
  -w /app \
  node:24-bookworm-slim \
  node dist/src/server.js
```

该更新命令以 `.env` 中的 `NODE_ENV` 和 `DEV_LOGIN_ENABLED` 为准。

### 15.5 更新后验证

```bash
docker ps --filter name=english-start-api
docker logs --tail=100 english-start-api
curl http://127.0.0.1:3000/health
```

如果本次更新包含每日计划：

```bash
grep -n 'daily-plans/today' dist/src/app.js

docker exec english-start-api \
  grep -n 'daily-plans/today' /app/dist/src/app.js

curl -i http://127.0.0.1:3000/daily-plans/today
```

最后在小程序中检查：

- 开发登录。
- 首页。
- 今日计划。
- 词库。
- 提交练习。
- 学习数据是否写入。

## 16. 数据库查看

```bash
docker exec -it english-start-postgres-v2 \
  psql -U postgres -d english_start
```

常用命令：

```sql
\l
\dt
\d "DailyPlan"
```

查看迁移：

```sql
SELECT migration_name, finished_at
FROM "_prisma_migrations"
ORDER BY finished_at;
```

查看数据量：

```sql
SELECT COUNT(*) FROM "User";
SELECT COUNT(*) FROM "StarterVocabulary";
SELECT COUNT(*) FROM "VocabularyItem";
SELECT COUNT(*) FROM "DailyPlan";
SELECT COUNT(*) FROM "PracticeAttempt";
```

退出：

```sql
\q
```

## 17. 日志和服务管理

```bash
docker ps
docker ps -a
docker logs -f --tail=100 english-start-api
docker logs -f --tail=100 english-start-postgres-v2
docker stats
```

重启：

```bash
docker restart english-start-api
docker restart english-start-postgres-v2
```

服务器重启后检查：

```bash
systemctl status docker --no-pager
docker ps
curl http://127.0.0.1:3000/health
```

## 18. 数据库和头像备份

数据库：

```bash
mkdir -p /opt/backups/english-start
chmod 700 /opt/backups/english-start

BACKUP_FILE="/opt/backups/english-start/english_start_$(date +%Y%m%d_%H%M%S).dump"

umask 077
docker exec english-start-postgres-v2 \
  pg_dump -U postgres -d english_start -Fc > "$BACKUP_FILE"

ls -lh "$BACKUP_FILE"
```

头像：

```bash
AVATAR_BACKUP="/opt/backups/english-start/avatars_$(date +%Y%m%d_%H%M%S).tar.gz"

tar -czf "$AVATAR_BACKUP" storage/avatars
chmod 600 "$AVATAR_BACKUP"
ls -lh "$AVATAR_BACKUP"
```

验证数据库备份：

```bash
docker exec -i english-start-postgres-v2 \
  pg_restore --list < "$BACKUP_FILE" | head
```

备份应同步到服务器以外的位置，并定期执行恢复演练。

## 19. 数据库恢复

恢复会覆盖当前数据库。

停止 API：

```bash
docker stop english-start-api
```

指定备份：

```bash
RESTORE_FILE="/opt/backups/english-start/需要恢复的备份.dump"
ls -lh "$RESTORE_FILE"
```

终止连接并重建数据库：

```bash
docker exec english-start-postgres-v2 \
  psql -U postgres -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'english_start' AND pid <> pg_backend_pid();"

docker exec english-start-postgres-v2 \
  dropdb -U postgres --if-exists english_start

docker exec english-start-postgres-v2 \
  createdb -U postgres english_start
```

恢复：

```bash
docker exec -i english-start-postgres-v2 \
  pg_restore -U postgres -d english_start < "$RESTORE_FILE"
```

启动 API：

```bash
docker start english-start-api
curl http://127.0.0.1:3000/health
```

## 20. 正式发布

正式地址应使用：

```text
https://API_DOMAIN
```

后端：

```dotenv
NODE_ENV=production
DEV_LOGIN_ENABLED=false
HOST=0.0.0.0
PORT=3000
WECHAT_APP_ID=正式小程序AppID
WECHAT_APP_SECRET=通过安全方式填写
```

API 映射改为：

```text
-p 127.0.0.1:3000:3000
```

由 Nginx 代理：

```nginx
server {
    listen 80;
    server_name API_DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 6m;
    }
}
```

配置可信 TLS 证书后：

- 安全组只开放 `80`、`443` 和受限来源的 `22`。
- 关闭公网 `3000`。
- 不开放 `5432`。
- 在微信公众平台配置 request 和 uploadFile 合法域名。
- 前端设置 `useDevLogin: false`。
- 后端设置 `NODE_ENV=production`、`DEV_LOGIN_ENABLED=false`。
- 核对微信平台当时的备案和域名资质要求。

如果服务器不在中国大陆，应根据云平台接入区域、小程序主体和服务地区，核对域名备案、
平台审核及数据合规要求。

## 21. 正式数据库密码

仓库示例中可能存在默认测试密码，正式部署前必须替换。

正式 Compose 应使用环境变量：

```yaml
environment:
  POSTGRES_DB: english_start
  POSTGRES_USER: postgres
  POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}
```

已初始化数据库不能仅通过修改容器环境变量更换密码。应进入 psql：

```bash
docker exec -it english-start-postgres-v2 \
  psql -U postgres -d postgres
```

执行：

```sql
\password postgres
```

然后更新 `.env` 中的 `DATABASE_URL` 并重建 API。使用交互命令可以避免密码进入
shell 历史。

## 22. 常见错误

### 22.1 Docker RPM 下载失败

```text
No more mirrors to try
```

处理 CentOS 7 归档源和 Docker 国内镜像，不是反复安装 Buildx。

### 22.2 Docker Hub 超时

```text
Client.Timeout exceeded while awaiting headers
```

配置 registry mirror 或使用 DaoCloud 镜像代理。

### 22.3 `docker ps` 没有端口

只有 PostgreSQL、没有 API 时不会出现 `3000`。

```bash
docker ps -a --filter name=english-start-api
docker logs --tail=200 english-start-api
```

### 22.4 API 不断重启

```text
Cannot find module '/app/dist/src/server.js'
```

说明没有成功编译：

```bash
ls -l dist/src/server.js
```

重新执行第 10 节。

### 22.5 Prisma OpenSSL 警告

```text
Prisma failed to detect the libssl/openssl version
```

在 Node slim 容器内安装：

```bash
apt-get update
apt-get install -y --no-install-recommends openssl ca-certificates
```

### 22.6 Prisma `P1001`

```text
Can't reach database server
```

检查 PostgreSQL：

```bash
docker ps -a --filter name=english-start-postgres-v2
docker logs --tail=100 english-start-postgres-v2
docker exec english-start-postgres-v2 \
  pg_isready -U postgres -d english_start
```

容器内数据库主机使用 `english-start-postgres-v2`，不是 `localhost`。

### 22.7 PostgreSQL 不断重启

```text
could not write to file "postmaster.pid": Operation not permitted
```

使用 `docker-compose.centos7.yml` 后重建数据库容器：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.centos7.yml \
  -p english-start \
  up -d --force-recreate postgres
```

不要添加 `-v`。

### 22.8 `Connection refused`

表示端口没有服务监听：

```bash
docker ps -a --filter name=english-start-api
docker logs --tail=200 english-start-api
ss -lntp | grep 3000
```

### 22.9 `/daily-plans/today not found`

原因：

- 前端已经更新。
- 服务器仍运行旧后端源码、旧 `dist` 或旧容器挂载目录。

这不是数据库错误。检查：

```bash
grep -n 'daily-plans/today' src/app.ts
grep -n 'daily-plans/today' dist/src/app.js

docker exec english-start-api \
  grep -n 'daily-plans/today' /app/dist/src/app.js
```

判断：

- 源码没有：重新上传完整最新后端。
- 源码有、`dist` 没有：重新编译。
- 两者都有、容器内没有：重建 API 并检查挂载目录。
- 三处都有但数据库报错：执行 migration 并检查 API 日志。

未登录验证应返回 `401`，返回 `404` 说明路由仍不存在：

```bash
curl -i http://127.0.0.1:3000/daily-plans/today
```

## 23. 高风险命令

没有可验证备份时禁止执行：

```bash
docker compose down -v
docker volume rm ...
docker system prune --volumes
rm -rf /var/lib/docker
```

这些操作可能永久删除 PostgreSQL 数据。

删除 API 容器：

```bash
docker rm -f english-start-api
```

不会删除数据库卷，但必须确认容器名准确。

## 24. 上线验收清单

### 开发测试

- [ ] PostgreSQL 为 `Up` 或 `healthy`。
- [ ] API 为 `Up`。
- [ ] `dist/src/server.js` 存在。
- [ ] `/health` 返回 `{"status":"ok"}`。
- [ ] `/daily-plans/today` 未登录返回 `401`，不是 `404`。
- [ ] 每日计划 migration 已执行。
- [ ] 公网测试地址可以访问。
- [ ] 云平台安全组只向开发者 IP 开放 3000。
- [ ] 小程序开发工具关闭合法域名校验。
- [ ] 前后端都启用开发登录。
- [ ] 登录、词库、今日计划和练习提交正常。
- [ ] 数据库和头像完成备份。

### 正式环境

- [ ] 使用 HTTPS 域名。
- [ ] API 只映射到 `127.0.0.1:3000`。
- [ ] 公网关闭 `3000` 和 `5432`。
- [ ] PostgreSQL 使用强密码。
- [ ] `NODE_ENV=production`。
- [ ] `DEV_LOGIN_ENABLED=false`。
- [ ] 前端 `useDevLogin=false`。
- [ ] 微信 AppID、AppSecret 安全注入。
- [ ] request 和 uploadFile 合法域名已配置。
- [ ] TLS 证书链和到期时间已检查。
- [ ] 数据库恢复演练已完成。

## 25. 后续一键部署优化

当前方案已运行成功，但长命令较多。后续建议：

1. 增加生产 `Dockerfile`，预装 OpenSSL 并完成 TypeScript 构建。
2. 在 Compose 中增加 API 服务。
3. 使用 healthcheck 和 `depends_on` 管理数据库启动顺序。
4. 从 Compose 中移除 PostgreSQL 宿主机端口映射。
5. 将数据库密码改为环境变量。
6. 固定 PostgreSQL 和 Node 镜像精确版本。
7. 加入 Nginx、HTTPS 和自动备份。
8. 增加部署前测试、版本标识和失败回滚。

完成后，首次部署和更新可以收敛为：

```bash
docker compose up -d --build
```

继续使用 CentOS 7 时仍需保留 PostgreSQL 的 seccomp 兼容配置。
