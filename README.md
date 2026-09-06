# English Start Backend

“单词练练”微信小程序的统一后端，负责身份与会话、虚拟支付会员、个人词库、启蒙
内容、练习出题与计分、学习记录、AI 语义判断、语音合成、语音转写和发音评测。

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

## 服务器一键更新

服务器首次放置好 `.env` 后，可以通过一个脚本完成数据库备份、镜像构建、类型检查、
测试、Prisma migration、seed、API 更新和健康检查：

```bash
bash deploy.sh
```

如果服务器目录是 Git 仓库，还可以同时拉取最新代码：

```bash
bash deploy.sh --pull
```

CentOS 7 会自动加载 `docker-compose.centos7.yml` 中的 PostgreSQL seccomp 兼容配置。
完整的首次部署、环境变量和故障处理见 `DEPLOY_CENTOS7.md`。

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

### 虚拟支付会员

启蒙 70 词对免费用户开放；新增单个单词、图片识别和
批量加入单词需要有效会员。会员过期不会删除已经加入的个人词汇。

年度会员默认价格为 9900 分、有效期 365 天，均通过环境变量配置。小程序使用
`wx.requestVirtualPayment` 的道具直购模式，后端负责生成支付签名、查询支付状态，并在收到
`xpay_goods_deliver_notify` 后幂等发放会员。前端支付成功不会直接修改会员状态。

| 变量 | 说明 |
| --- | --- |
| `WECHAT_MESSAGE_TOKEN` | 微信消息推送 Token，回调使用明文模式 |
| `WECHAT_VIRTUAL_PAYMENT_OFFER_ID` | 虚拟支付基础配置中的 OfferId |
| `WECHAT_VIRTUAL_PAYMENT_APP_KEY` | 与支付环境匹配的沙箱或现网 AppKey |
| `WECHAT_VIRTUAL_PAYMENT_PRODUCT_ID` | 已上传、审核并发布的会员道具 ID |
| `WECHAT_VIRTUAL_PAYMENT_ENV` | `0` 正式、`1` 沙箱；正式版必须为 `0` |
| `MEMBERSHIP_PRICE_FEN` | 会员售价，单位分，默认 `9900` |
| `MEMBERSHIP_DURATION_DAYS` | 会员有效天数，默认 `365` |

修改价格时，必须同时修改微信虚拟支付后台对应道具的价格并重新发布，否则微信会拒绝下单。
消息推送 URL 配置为 `https://你的API域名/wechat/xpay-callback`，数据格式可使用 JSON 或 XML，
消息加解密方式使用明文模式。

兑换码接口和生成工具暂时保留为运营应急能力，但小程序会员中心不再展示兑换入口。
开发兑换码使用本地命令生成，数据库只保存兑换码哈希：

```powershell
npm run membership:codes -- --count 10 --days 7 --label development
```

一次生成多个时长并写入 CSV：

```powershell
npm run membership:codes -- --batch 7:200 --batch 365:200 --output membership-codes.csv
```

没有数据库连接时可以增加 `--offline` 只生成文件。将文件上传到实际后端服务器后导入：

```powershell
npm run membership:codes:import -- --input membership-codes.csv
```

也可以使用 `--migration-output` 生成只包含哈希的数据库迁移，随部署自动导入初始批次。

可以增加 `--expires-in-days 30` 设置兑换码本身的有效期。未提供时兑换码长期有效，
但每个兑换码只能成功使用一次。

会员可以重复完成能力测评。学习资料只收集年龄段、年级、英语接触时间和可多选的
学习目标；每次结果独立保存，测评答案不计入日常练习、积分和签到。免费用户仍可查看基础学习
报告，四维能力变化、具体证据和下一步建议仅向有效会员返回。

能力测评按英语接触时间选择并固定题组：未接触或半年以内使用基础题组，半年至一年使用
标准题组，一年以上使用进阶题组。题组难度保存在测评记录中，中途修改资料不会改变续测题目。

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
| `GET` | `/membership` | 查询会员状态、到期时间和会员商品配置 |
| `POST` | `/membership/payment/orders` | 创建会员虚拟支付订单并返回签名参数 |
| `POST` | `/membership/payment/orders/:outTradeNo/confirm` | 服务端查询并确认支付结果 |
| `GET`、`POST` | `/wechat/xpay-callback` | 微信消息验证与虚拟支付发货回调 |
| `POST` | `/membership/redeem` | 使用一次性兑换码开通会员 |
| `GET` | `/onboarding` | 查询学习资料、当前测评和历史结果 |
| `PUT` | `/onboarding/profile` | 保存学习资料和多选学习目标（会员） |
| `POST` | `/assessments/initial/start` | 开始新一轮或继续进行中的能力测评（会员） |
| `POST` | `/assessments/initial/:id/answers` | 提交选择、拼写或跳过的发音题（会员） |
| `POST` | `/assessments/initial/:id/questions/:questionKey/voice` | 提交测评录音（会员） |
| `POST` | `/assessments/initial/:id/complete` | 完成测评并计算四维结果（会员） |
| `GET` | `/reports/learning` | 基础学习报告；有效会员额外返回个性化报告 |
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

- `User`：一个微信 OpenID 对应一个学习用户，并保存每日目标、会员到期时间和学习资料。
- `MembershipRedemptionCode`：只保存哈希的一次性会员兑换码。
- `MembershipPaymentOrder`：虚拟支付会员订单及幂等发放状态。
- `InitialAssessment`、`InitialAssessmentAnswer`：可重复能力测评和独立答题记录。
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
