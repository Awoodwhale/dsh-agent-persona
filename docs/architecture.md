# 架构

本文说明这个插件在 DSH 里到底做了什么、数据长什么样、一次提示词组装时发生了什么，以及它出现在哪几个界面上。
面向维护者。

## 1. 源码、构建产物与两个半边

| 半边 | 源码 | 构建产物 | 运行位置 | 职责 |
|---|---|---|---|---|
| host | `src/index.ts` | `lib/index.js` + `lib/index.d.ts` | DSH Node 进程 | 读写人设存储、解析匹配、注册 system-prompt section、对外提供 `agentPersona` 远程服务 |
| client | `src/client.ts` | `lib/client.js`（单文件 bundle） | 浏览器（Web app） | 设置页、对话页「人设」Tab、侧边栏卡片；挂载远程描述符后经 `ctx.get('remote.agentPersona')` 调宿主 |

源码是 **TypeScript**，`lib/` **不进 git**（`.gitignore` 里），由 `npm run build` 产出：

```
src/endpoints.ts ──(scripts/generate-remote.mjs)──▶ src/remote.ts + src/typert.ts
                                                          │
src/index.ts  ──tsc──▶  lib/index.js + lib/index.d.ts      │（前者被客户端 import 并被 esbuild 内联）
src/client.ts ──esbuild --bundle──▶ lib/client.js  ◀───────┘
```

- `src/endpoints.ts` 是**远程面的单一来源**（包名、通道名、服务名、12 个方法名、哪些方法收参数）。
- `src/remote.ts` / `src/typert.ts` 是**生成产物，不要手改**：改 `endpoints.ts` 后跑 `npm run generate:remote`；
  `npm test` 的最后一步会重新生成并比对，不一致就失败。
- host 是标准的 Cordis 插件（`export const name / inject / apply`），import Node 内置模块、
  `@deepseek-ai/schemastery`（配置 schema）与生成的 `./endpoints.js`。
- client 是 `window.__ModuleLoader__.load({ id, factory })` 模块，`require('react')` 与
  `require('@deepseek-ai/dsh-client-ui-primitives')` 由宿主提供；**它由 esbuild 打成单文件**（生成的描述符清单
  会被内联进去），所以浏览器侧没有裸 import。

挂载走的是包内声明的组合层（`package.json` 的 `dsh.bundle.patch`），`cordis.patch.yml` 只有一行：

```yaml
- insert:
    - id: agent-persona
      name: dsh-agent-persona
```

同一行也是浏览器 roster 行 —— 包在 `package.json` 里声明了 `dsh.client`，client-modules 会顺着这行解析到本包的
`exports["./client"]` 并在 `/plugins/…/client.js` 提供它。

## 2. 数据模型

```jsonc
// $DSH_HOME/dsh-agent-persona/personas.json（默认位置；可用 config.storePath 覆盖）
{
  "version": 1,
  "personas": [
    {
      "id": "psn_ab12cd34",          // 稳定 id，客户端与远程调用都用它
      "name": "前端项目助手",
      "enabled": true,
      "fallback": false,             // 显式默认人设：未命中任何位置时用它，同一时刻只允许一条
      "mode": "append",              // append（默认，接在 DSH 身份之后）| replace（去掉 DSH 身份句）
      "text": "…Markdown 人设正文…",
      "targets": [
        { "kind": "workspace", "match": "exact",  "value": "/Users/you/code/my-project" },
        { "kind": "sessionId", "match": "prefix", "value": "im-bot-" }
      ]
    }
  ],
  "prefs": { "autosave": false, "showTab": true, "showSidebar": true }
}
```

- **数组顺序即优先级**（`movePersona` / `reorderPersona` 上/下移就是在改这个顺序）。
- `kind`：`workspace`（比对 `agent.session.header.cwd`）或 `sessionId`（比对会话 id）。
- `match`：`exact` / `prefix` / `regex` / `contains`；只有 `exact` 会做路径归一化（`resolve()` 两侧），
  其余三种比对**原样字符串**。空值、非法正则、缺失对应字段 → 该规则不命中（不抛错）。
- `targets: []` = 不生效（草稿态）：一个位置都没加的人设不参与注入，**除非** `fallback === true`。
- `prefs` 是界面偏好（见 §6）。读取是宽容的：缺字段就补默认值，认不出的字段丢弃。

## 3. 一次组装里发生了什么

```
模型请求
  └─ dsh-system-prompt 组装 system prompt
       ├─ section -1000  harness identity
       ├─ section 0      deployment:persona-prefix（preset 的 persona 行）
       ├─ section 1      agent-persona   ← 本插件
       ├─ section 500+   工具引导 …
       └─ section 10200  deployment:persona-suffix
            ▲
            └─ provider 每次组装时求值：
                 store = 读磁盘（mtimeNs:size 戳变了才重读）
                 picked = resolvePersona(store.personas, { cwd, sessionId })
                 text = picked ? sanitize(picked.text) : ''
                 mode === 'replace' → 再清掉 DSH 自带的身份句（仅当该段文本仍等于部署原文）
```

`renderPrompt()` 会丢弃渲染为空的 section，所以"没有命中"就等于"完全不注入"，
其它渠道的提示词逐字节不变。

**解析顺序**（`resolvePersona`）：

1. `enabled === false` → 跳过；
2. 每条命中的规则按**具体度**打分（`sessionId` > `workspace`，`exact` > `prefix` > `contains`/`regex`，见
   `targetSpecificity`），取各人设的**最高分**比较，分高者中选；同分才按数组顺序取靠前的；
3. `targets` 为空 → 跳过（草稿态，不参与注入）；
4. 一条都没命中 → 看有没有 `fallback === true` 且启用的人设，有就用它；没有就空串；
5. 中选者 `text.trim() === ''` → 返回空串（显式静默：命中位置但正文为空，等于在该位置不要人设）。

**为什么优先级高于 `AGENTS.md`**：`AGENTS.md` 由 `dsh-agent-instructions` 变成一条 **user 角色**的持久消息，
它自带的导语写着 *"They do not override system, developer, or direct user instructions."*；
而本插件写进的是 **system prompt 的 section**。这是框架的结构性保证，不是文案约定。

**变量**：正文里的 `{{model}}` / `{{cwd}}` 由提示词注册表在渲染时解析；其它 `{{…}}` 会在注入前被去括号
（未注册的变量会让整个组装**抛错**，所以必须在插件侧消毒，见 `sanitizePersona`）。

## 4. 远程服务契约

host 侧 `WorkspacePersonaService extends TypertRemoteService`，构造时 `super(ctx, 'agentPersona')` ——
**服务名与服务命名空间都是 `agentPersona`**（不是包名；填错会让客户端永远取不到）。

暴露面由 `src/endpoints.ts` 决定，生成器产出两份产物：

- `src/remote.ts` 的 `RPC_REMOTE`：**客户端 `$mount` 的那份描述符清单**（每条带 `id`、`service`、`namespace`、
  严格模式 codec、无参方法 `parameters: []`）；
- `src/typert.ts` 的 `TYPERT`：同一份面的清单对象（`face: 'host'` + `model.services` / `model.invocations`）。

| 方法 | 入参 | 返回 |
|---|---|---|
| `listPersonas` | — | 视图：`storePath` / `sectionName` / `sectionOrder` / `allowedVariables` / `targetKinds` / `targetMatches` / `tuneModes` / `counts` / **`prefs`** / **`pluginVersion`** / **`installOrigin`** / `personas[]`（含 `chars`、`noTargets`、`fallback`、每个 target 的 `invalid` 标记） |
| `savePersona` | `{ id?, name, enabled, fallback?, mode?, text, targets }` | 视图（无 `id` = 新建，追加到末尾 = 最低优先级；`fallback` 未提及则保留原值） |
| `deletePersona` | `{ id }` | 视图 |
| `movePersona` | `{ id, delta: -1 \| 1 }` | 视图 |
| `reorderPersona` | `{ id, toIndex }` | 视图 |
| `duplicatePersona` | `{ id }` | 视图（副本**默认停用**） |
| `listTargets` | — | `{ workspaces: [{ path, title, sessionCount }], sessions: [{ id, title?, cwd, createdAt }] }`（设置页的下拉框数据，按时间倒序，最多 200 条） |
| `sessionHistory` | `{ id, offset?, events?, maxChars? }` | 该会话的消息（供「看这条会话」弹窗与单条 `展开全文`） |
| `sessionPrompt` | `{ id }` | `{ available, cwd, reason, matchedBy, persona, prompt }` —— 对话页「人设 / 提示词」两个面板的数据 |
| `tunePersona` | `{ mode, instruction, text, provider?, model? }` | `{ text, mode, provider, model, source }` |
| `listModels` | — | `{ models[], hostDefault, configured }` |
| `savePrefs` | `{ autosave?, showTab?, showSidebar? }` | 视图（部分合并，未提及的字段保留） |

约定（踩出来的）：

- 客户端 `ctx.remote.$mount(RPC_REMOTE)` 的 codec **只接受 `mode: 'strict'`**，但 schema 只需要有 `parse()`。
- 远程调用返回**信封** `{ ok: true, value } | { ok: false, error }`；host 抛出的异常到不了浏览器细节，
  所以每个方法内部 try/catch，把失败当**数据**返回（`{ error: '…' }`），UI 才能显示真实原因。
- 方法名不能与 cordis `Service` 的成员冲突（`remove`、`name`、`ctx`…），所以是 `deletePersona` 而不是 `remove`。

## 5. 界面上出现在哪

| 座位 / 方式 | 位置 | 说明 |
|---|---|---|
| `settings.section`（order 22） | 设置 → Agent 人设 | 完整管理页：**三个偏好开关**、列表、规则编辑器、正文编辑/预览、AI 调优 —— 它不受这三个开关影响，所以是它们的回头路。标题旁是项目链接（GitHub / npm，simple-icons 的品牌图形内联，`currentColor` 跟随主题）与**当前安装版本的胶囊**（数据来自宿主的 `PLUGIN_INFO`，见 §4 的 `pluginVersion` / `installOrigin`） |
| `conversation.view`（order 30） | 对话页顶部「人设」 | 人设 / 提示词 / 管理 三个面板；由 `showTab` 决定是否注册 |
| `betterSidebar.registerTab` | dsh-better-sidebar 的右侧栏 | 同一套页面挂进侧边栏；由 `showSidebar` 决定注册还是注销，未装该插件时**不注册也不显示开关** |

对话页与侧边栏两处都在**运行时**注册/注销（切换开关立即生效），而决策来自 §6 的镜像。
本插件**不往 `settings.general.item` 注册任何条目** —— 偏好开关只出现在设置页里（上表第一行），
`test/client-helpers.test.mjs` 有一条断言守着这一点。

## 6. 界面偏好

三个偏好（`autosave` / `showTab` / `showSidebar`）**存在人设文件的 `prefs` 里**，与数据同域，经 `savePrefs` 写入；
每个 `listPersonas` / `sessionPrompt` 的返回都带上它们。

浏览器侧另有一份 **localStorage 镜像**，只做一件事："加载时决定要不要注册视图" —— 那个决定发生在任何宿主调用
能返回之前，必须同步可得。每次收到视图都会刷新镜像，所以下一次加载与文件一致；**文件是唯一真相**。

## 7. 模型解析（AI 调优）

默认就用 **DSH 自己设置的模型**，不写死任何厂商。按顺序取：

1. 客户端传来的 `provider`/`model`（界面下拉，来自 `listModels`，默认预选下面第 3 条）；
2. 本行配置 `config.tuneProvider` / `config.tuneModel`（部署方指定自己的 LLM）；
3. 宿主服务 `agentDefaultModel.currentSelection()` —— 就是 DSH 当前给新 Agent 用的模型；
4. 都没有 → 抛明确错误，页面提示没有可用模型。

配置本身是 Schemastery schema（`storePath` / `tuneProvider` / `tuneModel`）：默认值写在 schema 里，
类型写错会在**加载时失败**而不是被忽略。

## 8. 存储与并发

- 写入是**原子替换**：写 `<file>.tmp-<pid>` 再 `rename`，权限 `600`。
- 读取按 `mtimeNs:size` 戳缓存：戳不变就用内存副本，戳变了重读。因此"另一个进程改了文件"也能被发现，
  且运行中的插件实例在文件被替换后**下一个请求**就生效。
- 读取是**宽容**的：只要求文档里有 `personas` 数组，每个条目都过一遍 `normalizePersona`（丢弃不认识的
  字段、补全缺失的字段）；不是人设文档就退回空存储并告警，不抛错。
- **默认位置是全局一份**（`$DSH_HOME/dsh-agent-persona/personas.json`，与其它插件状态目录同一约定）；
  要让某个 profile 独立，在**该 profile** 的 `cordis.patch.yml` 里覆盖 `config.storePath`。
- `collectTargets(ctx, warn)` 负责收集设置页下拉框的候选：工作区走 `workspaceRegistry.list()`（取
  `path` / `title` / `sessionIds`），会话走 `sessionPersistence.list()`（按 `createdAt` 倒序，取标题经
  `sessionTitle.get(session)`）。任何一个服务缺席都只是告警 + 空列表，页面会退回"自己输入…"。
