# my-game-bot

朋友群里玩的 Telegram 游戏 bot。现在有两个游戏：

- **真心话大冒险**（`/play`）：在群里点按钮玩。
- **心照不宣**（`/guess`）：猜词游戏，在 Telegram 的 Mini App（群里点一下就打开的游戏页面）里玩。

框架按「以后还要加谁是卧底、狼人杀、Avalon、海龟汤、飞行棋」来搭：聊天按钮类的游戏和 Mini App 类的游戏共用同一套房间、邀请、计时和记录。

- 跑在 **Cloudflare Workers + Durable Objects** 上：免费额度够用，24 小时在线，不用管服务器。
- **每个群一个 Durable Object**，房间、turn-log、积分都存在它自带的 SQLite 里。同一个群里几个人同时点按钮，也会一个一个按顺序处理，不会把状态弄乱。
- 中英双语，每个群可以单独切换语言（`/lang`）。

## 真心话大冒险怎么玩

| 环节 | 规则 |
| --- | --- |
| 开房 | 群里发 `/play`，开房的人是房主 |
| 进房 | 房主点「邀请」从名单里选人，或者发 `/invite @用户名`，对方点「接受」才进房；其他人点「申请加入」，房主同意后进房。游戏中途也能进出 |
| 设置 | 尺度：轻松 ●○○、微辣 ●●○、重口 ●●●（18+）；题目来源：题库、AI、题库 + AI；每人每局换题次数 0–3；大冒险类型：语音表演、往群里发东西、联系群外的人；投票时长 30/60/90 秒 |
| 转瓶子 | 完全随机，每个人概率相同，可能连着转到同一个人 |
| 完成判定 | 被转到的人在语音里回答，或者做完大冒险，点「做完了」，其他人投「过」或「不过」。时间到或者都投完了就出结果，**平票算过** |
| 计分 | 真心话过关 +1，大冒险过关 +2；没过关 −1、怂了 −2，然后要做一道**惩罚题**（不能再怂）：完成 +1，没过 −1 |
| turn-log | 房间消息会变成**实时战报**（bot 是管理员时自动置顶）；`/log` 看本局每一轮；结束时发**本局总结**；`/stats` 看**跨局统计**，`/stats` 回复某人看个人战绩 |

题库共 192 道题，中英双语：真心话 90 道、大冒险 72 道、惩罚题 30 道。没有需要开摄像头的题，语音表演类特意放得少。尺度选微辣或重口时，大约每 4 道里有 1 道来自低一档，这样一晚上不至于把同一档抽空；题目下面会如实标出它属于哪一档。

AI 出题默认用 **Claude Opus 5.5**（官方 Anthropic SDK，思考强度设为 low，几秒出一道），用结构化输出保证返回的是合法 JSON。如果被 Claude 的安全分类器拒绝，会在服务端自动换 Anthropic 推荐的模型重试；还是不行，就依次试 DeepSeek、Gemini（前提是配了它们的 key），最后从题库抽，不会让一轮卡住。发给 AI 的只有尺度、语言、允许的大冒险类型和本局已经出过的题，**不会发送任何人名或群聊内容**。

想换模型，改 `wrangler.jsonc` 里的 `ANTHROPIC_MODEL` 后重新部署：`claude-fable-5-2` 是 Anthropic 综合能力最强的模型（价格是 Opus 5.5 的两倍，思考关不掉，出题更慢）；`claude-haiku-5-5` 最便宜。

## 心照不宣怎么玩

群里发 `/guess` 开房，拉人和真心话大冒险一样。房间消息上多一个「打开游戏」按钮，点开就是游戏页面；人齐了房主在页面里点「开始游戏」。每人轮流当主角，轮完自动结束并发总结。

| 玩法 | 规则 |
| --- | --- |
| 禁词 | 主角看到一个词和 4 个禁用词，在语音里描述（也可以打字提示），不能说出这个词和禁用词。其他人在页面里打字猜，猜中一个，猜的人和主角各 +1；主角说漏了，谁都可以点「犯规」，主角 −1；打字提示里带了禁用词会自动判犯规。时间到这一轮结束（60/90/120 秒可选） |
| 别撞车 | 主角来猜。其他人都看得到这个词，每人写一个词当线索：写得一样的互相抵消，包含答案的自动去掉，意思太像的大家可以划掉。主角只看得到剩下的线索，猜一次：猜对 +2，留下来的线索每条 +1。没对上的近义词，房主可以点「算对」 |
| 设置 | 玩法（两种轮流 / 只玩禁词 / 只玩别撞车）、每人当几次主角（1–3）、禁词每轮多长时间。房主可以在群里的房间消息上改，也可以在游戏页面的大厅里直接点 |

谁能看到什么全由服务器决定：禁词只有主角看得到词；别撞车里主角在猜之前看不到词，也看不到被去掉的线索。词库 160 个词，中英双语，每个词带 4 个禁用词。

## 界面风格

界面里不用 emoji。Telegram 会把 emoji 换成各家手机自己的彩色图片，好不好看由手机决定，bot 改不了。所以：

- **图标**用单色符号（`src/ui/glyphs.ts`）：♛ 房主、✓ 过 / 完成、✗ 没过、●○ 尺度、↻ 换题、→、·。这些字符不是 emoji，会按文字颜色显示，深色、浅色主题下都会自动跟着变。
- **颜色**交给 Telegram 的彩色按钮：绿色是确认、通过；红色是大冒险、怂了、结束这类有分量的操作；蓝色是主要操作，以及设置里当前选中的那一项。
- 只有题目内容里可以出现 emoji（比如「发一个 ❤️」），那是玩法本身。
- `test/unit/style.test.ts` 会检查中英两套文案和一整局实际渲染出来的消息、按钮里有没有混进 emoji。

想换成真正的自定义图标（Telegram custom emoji）也可以，但 Telegram 规定 bot 的主人得有 Premium，bot 才能在群消息和按钮里用自定义表情。

游戏页面（Mini App）做成 Telegram 自己的样子：

- **颜色**全部取自用户当前的 Telegram 主题（`--tg-theme-*`），按 Telegram 分组列表的用法：页面底色是 `secondary_bg_color`，卡片是 `section_bg_color`。有的主题这两个颜色一样，卡片会自动加一层浅色，免得和背景糊在一起。
- **主要按钮**（开始游戏、开始、下一轮、检查好了……）用 Telegram 自己的底部按钮（MainButton / SecondaryButton），不是页面里画的。打字框出现的时候不显示底部按钮。在 Telegram 外面打开页面时，按钮会画在页面里。
- **字号和间距**照 [TelegramUI](https://github.com/telegram-mini-apps-dev/TelegramUI)（MIT）的数值；没有用它的 React 组件，页面仍然是不需要打包的原生 JS。
- 每种玩法一个点缀色：禁词橙色，别撞车紫色。绿色是对、确认，红色是犯规、猜错。

## 命令

| 命令 | 作用 |
| --- | --- |
| `/play` | 开一局真心话大冒险 |
| `/guess` | 开一局心照不宣（猜词，在 Mini App 里玩） |
| `/invite @用户名`（或回复某人的消息） | 房主邀请玩家，可以一次邀请多个 |
| `/kick @用户名`（或回复） | 房主把人请出房间 |
| `/end` | 结束本局（房主或群管理员） |
| `/log` | 本局（或上一局）完整记录 |
| `/stats` / 回复某人 `/stats` | 历史统计 / 个人战绩 |
| `/lang` / `/lang en` | 切换语言 |
| `/help` | 玩法说明 |

大部分操作点按钮就行，命令主要是备用。

## 部署（第一次大约 10 分钟）

1. **创建 bot**：在 Telegram 里找 [@BotFather](https://t.me/BotFather)，发 `/newbot`，拿到 token。
2. **安装依赖**：
   ```bash
   npm install
   ```
3. **设置密钥**（每条命令会提示你粘贴值）：
   ```bash
   npx wrangler secret put BOT_TOKEN          # BotFather 给的 token
   npx wrangler secret put WEBHOOK_SECRET     # 随机串，可以用：openssl rand -hex 32
   npx wrangler secret put ANTHROPIC_API_KEY  # 可选：Claude 出题
   npx wrangler secret put DEEPSEEK_API_KEY   # 可选：备用
   npx wrangler secret put GEMINI_API_KEY     # 可选：备用
   ```
   AI key 都不配也能玩，只是只能用题库。之后再补 key 不用重新部署，`secret put` 之后立刻生效。
4. **部署**：
   ```bash
   npm run deploy
   ```
   会输出一个 `https://my-game-bot.<你的子域>.workers.dev` 地址。
5. **注册 webhook 和命令菜单**：
   ```bash
   curl -X POST https://my-game-bot.<你的子域>.workers.dev/setup \
     -H "Authorization: Bearer <WEBHOOK_SECRET>"
   ```
   返回 `{"ok":true,"bot":"@你的bot",...}` 就说明成功了。
6. **建 Mini App**（心照不宣要用）：在 BotFather 里发 `/newapp`，选这个 bot，按提示填标题、简介、一张 640×360 的图，Web App URL 填 `https://my-game-bot.<你的子域>.workers.dev/app`，最后起一个短名（比如 `play`）。把短名填进 `wrangler.jsonc` 的 `MINIAPP_SHORT_NAME`，再 `npm run deploy`。不配也能玩真心话大冒险，只是 `/guess` 用不了。
7. **把 bot 拉进群**，发 `/play` 或 `/guess`。
8. **推荐的收尾设置**：
   - 把 bot 设成群管理员，只给「置顶消息」权限就够，它会自动置顶实时战报。
   - 在 BotFather 里 `/mybots → Bot Settings → Allow Groups? → Turn off`，这样别人就没法把它拉进别的群消耗你的 AI 额度。
   - 也可以在 `wrangler.jsonc` 里设 `ALLOWED_CHAT_IDS`，只允许指定的群。不在名单里的群会收到一条带群 ID 的提示，然后 bot 自动退群。

Privacy mode 保持默认开启即可：bot 只需要收命令和按钮点击，看不到群里的普通聊天。

运行日志可以用 `npx wrangler tail` 实时看，也可以去 Cloudflare 控制台的 Workers → Logs 查（已开启 observability）。

## 本地开发

```bash
cp .dev.vars.example .dev.vars   # 填一个**单独的开发用 bot** 的 token
npm run dev                      # 终端 1：本地 Worker + Durable Object
npm run dev:poll                 # 终端 2：从 Telegram 拉消息转发给本地 Worker
```

`dev:poll` 会删掉这个 bot 的 webhook，所以千万别填正式 bot 的 token。

```bash
npm test            # 单元测试（Node）+ Worker 集成测试（workerd）
npm run typecheck   # TypeScript 类型检查
npm run build:check # 不上传，只打包检查
```

## 架构

```
Telegram ──webhook──▶ Worker (src/index.ts) ◀──── 游戏页面 /app (public/)
                        │ 校验 secret header，   POST /app/api/session：校验 Telegram 签名的 initData，换会话令牌
                        │ 按 chat id 路由        GET  /app/ws：凭令牌连 WebSocket
                        ▼                        │
              ChatDurableObject (每个群一个) ◀───┘
                        │ 串行队列：Telegram 更新、定时器、页面操作一个一个处理
                        │ 页面连接用可休眠的 WebSocket，状态一变就给每个人推送他能看到的画面
                        ▼
                    ChatApp (src/core/app.ts)
         房间 · 邀请 / 申请 · 选人面板 · 设置 · 定时器 · /log /stats · Mini App 入口
                        │
                        ▼
                GameModule (src/games/*)
          真心话大冒险：src/games/tod（聊天按钮）
          心照不宣：src/games/guess（Mini App，GameModule.web）
```

| 位置 | 内容 |
| --- | --- |
| `src/core/` | 与具体游戏无关的部分：房间生命周期、成员、turn-log、定时器（DO 只有一个 alarm，所有计时器存在 `deadlines` 表里，alarm 总是指向最早到期的那个）、双语文案 |
| `src/games/tod/` | 真心话大冒险：状态机（`index.ts`）、渲染（`render.ts`）、抽题（`deck.ts`）、题库（`content/`）、AI 出题（`ai.ts`） |
| `src/ai/anthropic.ts` | Claude 出题：官方 `@anthropic-ai/sdk`，`output_config.effort` + JSON schema 结构化输出，`fallbacks: "default"` 服务端拒答兜底，拒答时抛错交给下一个来源 |
| `src/ai/llm.ts` | 按 `AI_PROVIDERS` 的顺序依次尝试；DeepSeek / Gemini 走 OpenAI 兼容接口（DeepSeek 关闭 thinking、用 JSON 模式；Gemini 用 `reasoning_effort: minimal` 和 JSON schema） |
| `src/telegram/` | Bot API 封装、更新解析、按钮数据编码 |
| `src/web/` | Mini App 的服务端：校验 initData（`init-data.ts`）、会话令牌（`session.ts`）、链接参数（`start-param.ts`）、页面和服务器之间的消息格式（`protocol.ts`） |
| `public/` | 游戏页面本身：`app.html` + `app/*.js`（原生 JS，用 JSDoc 写类型，`npm run typecheck` 会检查，不需要打包）+ `app/app.css`（颜色跟着 Telegram 的主题走） |
| `src/games/guess/` | 心照不宣：流程（`index.ts`）、每个人能看到什么（`view.ts`）、对词和查禁用词（`normalize.ts`）、群里的战报和统计（`render.ts`）、词库（`content/cards.ts`） |
| `turn_log` 表 | 每一轮一行 JSON，记录谁、选了什么、题目、换过的题、投票明细、惩罚题、得分和起止时间。实时战报、总结、`/log`、`/stats` 都从这里算出来 |

## 加一个新游戏

1. 在 `src/games/<id>/` 里实现 `GameModule`（接口见 `src/core/game.ts`），可以参照 `src/games/tod/index.ts`。
2. 把它加进 `src/games/index.ts` 的 `GAMES` 数组。之后用 `/play <id>` 开这个游戏。
3. 房间、邀请、申请、踢人、设置面板、实时战报的位置、结束总结、定时器、turn-log 都由框架提供。游戏本身只需要管自己的 `room.state` 和自己发的消息。

谁是卧底、狼人杀、Avalon 这类需要**私聊发身份**的游戏，框架已经准备好了：

- `game.dm(userId, html, keyboard)` 用来私聊玩家。如果对方从来没私聊过 bot，Telegram 不允许 bot 先发消息，这时会返回 `false`。
- `game.startLink()` 生成深链接按钮。玩家点一下就会打开和 bot 的私聊，并把「能私聊」这个状态记到本群名下。
- `game.dmCallback(...)` 生成私聊里用的按钮数据，玩家在私聊里点的按钮会路由回群里对应的房间（比如 Avalon 里秘密投成功/失败）。

Mini App 类的游戏（比如心照不宣）再加一个 `web` 字段：

- `web.view(game, userId)` 返回这个人在页面上能看到的东西。每次状态变化都会重算并推给每个连着的人，所以**只放他该看到的**。
- `web.onAction(game, userId, action)` 处理页面上的操作，返回给这个人的提示。
- 房间消息会自动多一个「打开游戏」按钮；登录、成员校验、断线重连、大厅（申请加入、房主同意、开始）都由框架和 `public/app/main.js` 处理。

## 可以调的地方

| 想改什么 | 位置 |
| --- | --- |
| 计分规则 | `src/games/tod/types.ts` → `POINTS` |
| 房间多久没人动自动关闭（等人时 1 小时 / 游戏中 3 小时） | `src/core/app.ts` → `LOBBY_IDLE_MS` / `PLAYING_IDLE_MS` |
| 跨档混抽比例、语音表演出现的频率 | `src/games/tod/deck.ts` |
| 题库 | `src/games/tod/content/*.ts`（每道题都有中英两版） |
| 心照不宣的计分、各阶段时长 | `src/games/guess/types.ts` → `POINTS` / `TIMING` |
| 心照不宣的词库 | `src/games/guess/content/cards.ts`（每个词都有中英两版和 4 个禁用词） |
| AI 模型、思考强度、尝试顺序 | `wrangler.jsonc` → `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` / `AI_PROVIDERS`（以及 `DEEPSEEK_MODEL` / `GEMINI_MODEL`） |

## 已知限制

- Telegram 不让 bot 读取完整的群成员名单。所以「邀请」面板里只列出 bot 见过的人；没见过的人用 `/invite @用户名`，或者让他们自己点「申请加入」。
- bot 进不了语音聊天，「做完没有」只能靠大家投票；禁词里说没说漏，也只能靠大家点「犯规」。
- Mini App 要从群里的「打开游戏」按钮进，页面会核对这个人还在不在群里。打开后 24 小时内有效，过期了回群里再点一次就行。
- 换了 Mini App 的短名（BotFather 里改不了，只能新建）要同步改 `MINIAPP_SHORT_NAME`，旧房间消息上的链接会失效。
- 普通群升级成超级群后 chat id 会变，旧群的成员、记录和统计会自动迁移到新群，但升级那一刻正在进行的那局会结束。
