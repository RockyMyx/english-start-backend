# English Start Backend

“单词练练”微信小程序的统一后端，负责身份与会话、个人词库、启蒙内容、练习出题与
计分、学习记录、AI 语义判断、语音合成、语音转写和发音评测。

## 技术栈

- Node.js + TypeScript
- Fastify 5
- Prisma 7
- PostgreSQL 17
- Vitest

## 本地启动

需要准备 Node.js、npm 和 Docker。也可以不使用 Docker，直接连接已有的 PostgreSQL。

```powershell
Copy-Item .env.example .env
docker compose up -d postgres
npm install
npm run prisma:deploy
npm run db:seed
npm run dev
```

默认监听 `http://localhost:3000`。可以访问以下地址确认服务状态：

```text
GET http://localhost:3000/health
```

初始化命令会写入启蒙词、造句题和对话题；重复执行 seed 使用 upsert，不会重复创建
同一份共享内容。

## 环境变量

`.env.example` 提供了本地模板。`.env` 包含凭证，不应提交到仓库。

### 基础配置

| 变量 | 默认值/示例 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 运行环境；生产环境使用 `production` |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `3000` | API 端口 |
| `DATABASE_URL` | 本地 PostgreSQL 连接串 | 必填，供 Prisma 和服务启动使用 |
| `CORS_ORIGIN` | `*` | 允许的跨域来源 |
| `DEV_LOGIN_ENABLED` | `true` | 是否开放开发模拟登录 |
| `SESSION_TTL_DAYS` | `30` | 会话有效天数 |

### 微信登录

| 变量 | 说明 |
| --- | --- |
| `WECHAT_APP_ID` | 正式小程序 AppID |
| `WECHAT_APP_SECRET` | 正式小程序 AppSecret |

开发模式可以调用 `/auth/dev-login`。当 `NODE_ENV=production` 时，该接口始终不可用，
不受 `DEV_LOGIN_ENABLED` 的值影响。正式登录需要同时配置微信 AppID 和 AppSecret。

### AI 语义判断

| 变量 | 默认值/示例 | 说明 |
| --- | --- | --- |
| `AI_EVALUATION_PROVIDER` | 示例文件为 `zhipu` | `auto`、`rules`、`zhipu` 或 `openai` |
| `ZHIPU_API_KEY` | 空 | 智谱 Coding API Key |
| `ZHIPU_BASE_URL` | Coding API 地址 | 智谱文本接口地址 |
| `ZHIPU_TEXT_MODEL` | `glm-5.2` | 智谱文本模型 |
| `OPENAI_API_KEY` | 空 | OpenAI 兼容接口 Key |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI 兼容接口地址 |
| `OPENAI_MODEL` | `gpt-5.6-luna` | OpenAI 兼容模型名 |

实际的造句和对话评审使用以上文本配置。`AI_EVALUATION_PROVIDER=auto` 时依次选择已配置
的智谱、OpenAI，均未配置则使用本地规则；远程模型调用失败时也会回退到本地规则。
显式选择 `zhipu` 或 `openai` 时，缺少对应 Key 或调用失败会直接返回错误。

`ZHIPU_PLATFORM_API_KEY`、`ZHIPU_PLATFORM_BASE_URL`、`ZHIPU_VISION_MODEL` 和
`ZHIPU_IMAGE_MODEL` 已预留在配置中，但当前 API 路由尚未使用图片理解或图片生成能力。

### Azure 语音

| 变量 | 默认值/示例 | 说明 |
| --- | --- | --- |
| `AZURE_TTS_ENDPOINT` | 空 | Azure TTS HTTPS 端点 |
| `AZURE_TTS_KEY` | 空 | Azure Speech Key |
| `AZURE_TTS_REGION` | 空 | Azure Speech 区域 |
| `AZURE_SPEECH_VOICE` | `en-US-JennyNeural` | 句子朗读音色 |

单个英文单词通过有道词典语音获取，不需要 Azure 配置。句子和对话朗读使用 Azure TTS；
语音回答的英文转写与发音评测使用同一组 Azure Key 和 Region。未配置 Azure 时，文字
练习仍可使用，但句子朗读和语音回答不可用。

## 功能规则

| 模块 | 开放条件 | 答对得分 |
| --- | --- | ---: |
| 三种选择题 | 个人词库至少 4 个词 | 1 分/题 |
| 单词听写 | 个人词库至少 1 个词 | 2 分/题 |
| 单词造句 | 至少 12 个启蒙词，且题目涉及的词已在个人词库 | 5 分/题 |
| 模拟对话 | 至少 12 个启蒙词 | 2 分/题 |

每日目标默认 50 分，可设置为 1–999。首页统计按服务器当天零点之后的练习记录计算，
包括练习次数、答对次数、得分和正确率。

## API 概览

除根路径、健康检查和登录接口外，其余接口均需要请求头：

```text
Authorization: Bearer <token>
```

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/`、`/health` | 服务与健康检查 |
| `POST` | `/auth/dev-login` | 开发模拟登录 |
| `POST` | `/auth/wechat` | 使用微信 code 登录 |
| `GET` | `/me` | 首页统计、词库数量和模块开放状态 |
| `PUT` | `/me/daily-goal` | 修改每日达标分数 |
| `GET` | `/starter-pack` | 查看启蒙词包 |
| `POST` | `/starter-pack/import` | 将启蒙词导入个人词库 |
| `GET`、`POST`、`DELETE` | `/words` | 查询、新增或清空个人词库 |
| `PUT`、`DELETE` | `/words/:id` | 修改或移除单词 |
| `GET` | `/practice/questions` | 获取选择题 |
| `POST` | `/practice/answers` | 提交选择题或听写答案 |
| `GET` | `/sentences` | 获取当前词库可用的造句题 |
| `POST` | `/sentences/:id/answer` | 提交文字造句 |
| `POST` | `/sentences/:id/voice-answer` | 提交语音造句 |
| `GET` | `/dialogues` | 获取模拟对话题 |
| `POST` | `/dialogues/:id/text-answer` | 提交文字对话回答 |
| `POST` | `/dialogues/:id/voice-answer` | 提交语音对话回答 |
| `POST` | `/speech/tts` | 获取单词或句子的朗读音频 |

普通 JSON 请求体上限为 1 MB。语音上传使用 multipart，单个文件最大 5 MB，仅接受 WAV
或 OGG；每次请求最多一个文件。

## 数据模型

- `User`：一个微信 OpenID 对应一个学习用户，并保存每日目标。
- `Session`：保存哈希后的会话令牌及过期时间。
- `StarterVocabulary`：全局共享的启蒙词内容。
- `VocabularyItem`：用户个人词库；移除操作采用归档方式，保留历史练习记录。
- `SentencePrompt`、`DialoguePrompt`：全局共享的造句与对话题。
- `PracticeAttempt`：练习结果、文字/转写、语义和发音评分。
- `WordProgress`：每个用户对每个单词的累计练习进度。

## 项目结构

```text
english-start-backend/
├─ prisma/
│  ├─ migrations/         # 数据库迁移
│  ├─ schema.prisma       # 数据模型
│  └─ seed.ts             # 启蒙词和练习题
├─ src/
│  ├─ domain/             # 类型、计分和业务规则
│  ├─ repositories/       # Prisma 实现及测试用内存实现
│  ├─ services/           # 登录、微信、AI 和语音服务
│  ├─ app.ts              # Fastify 路由
│  ├─ config.ts           # 环境变量解析
│  └─ server.ts           # 服务入口
├─ docker-compose.yml
├─ package.json
└─ README.md
```

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 监听源码变更并启动开发服务 |
| `npm run build` | 编译到 `dist/` |
| `npm start` | 运行已编译的生产入口 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行 Vitest 测试 |
| `npm run prisma:generate` | 生成 Prisma Client |
| `npm run prisma:migrate` | 创建并应用开发迁移 |
| `npm run prisma:deploy` | 应用已有迁移 |
| `npm run prisma:studio` | 打开 Prisma Studio |
| `npm run db:seed` | 初始化或更新共享内容 |

## 缓存与外部服务

- TTS 结果在后端进程内最多缓存 200 条，服务重启后清空。
- 单词朗读依赖有道词典公开语音地址，因此即使未配置 Azure，服务仍需要外网访问。
- AI、微信登录和 Azure 语音均依赖各自的外部服务及有效凭证。

## 上线检查

1. 设置 `NODE_ENV=production` 和 `DEV_LOGIN_ENABLED=false`。
2. 使用强凭证的生产 PostgreSQL，并妥善配置 `DATABASE_URL`。
3. 配置微信 AppID、AppSecret 和小程序 HTTPS 合法域名。
4. 将 `CORS_ORIGIN` 限制为实际需要的来源。
5. 通过部署环境注入 AI、微信和语音密钥，不提交 `.env`。
6. 部署前执行以下校验：

```powershell
npm run typecheck
npm test
npm run build
```
