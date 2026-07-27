# English Start Backend

“单词练练”微信小程序后端。当前版本采用单用户身份，提供个人词库、50 词启蒙包、四种单词练习、支持文字与语音回答的单词造句、AI 模拟对话、发音评测和学习记录。

## 本地启动

1. 复制 `.env.example` 为 `.env`，按需填写环境变量。
2. 启动 PostgreSQL：`docker compose up -d postgres`。
3. 安装依赖：`npm install`。
4. 应用数据库迁移：`npm run prisma:deploy`。
5. 初始化启蒙词库和练习题：`npm run db:seed`。
6. 启动 API：`npm run dev`。

本地接口默认监听 `http://localhost:3000`。开发模式允许 `/auth/dev-login`；生产环境必须关闭模拟登录并配置微信 AppID 与 AppSecret。

## AI 与语音

- 未配置 `OPENAI_API_KEY` 时，文字造句与对话会使用本地规则判断，完整流程仍可使用。
- 当前产品的文字判断和后续出题使用智谱 Coding 端点与 `glm-5.2`；图片理解和图片生成预留普通开放平台的独立 Key 与端点。`AI_EVALUATION_PROVIDER=auto` 会在模型故障时回退到本地规则。
- 单词发音使用有道词典语音；句子和对话朗读使用 Azure TTS。配置统一使用 `AZURE_TTS_ENDPOINT`、`AZURE_TTS_KEY` 和 `AZURE_TTS_REGION`，同一组 Key 与 Region 也用于语音转写和发音评测。
- 所有密钥只放在本地 `.env` 或部署环境变量中，不提交到仓库。

## 校验

- `npm run typecheck`
- `npm test`
- `npm run build`
