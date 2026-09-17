# 架构

本文说明这个插件在 DSH 里到底做了什么、数据长什么样、以及一次提示词组装时发生了什么。
面向维护者。

## 1. 两个半边

| 半边 | 文件 | 运行位置 | 职责 |
|---|---|---|---|
| host | `lib/index.js` | DSH Node 进程 | 读写人设存储、解析匹配、注册 system-prompt section、对外提供 `workspacePersona` 远程服务 |
| client | `lib/client.js` | 浏览器（Web app） | 设置页 UI；自己 `$mount` 远程描述符后通过 `ctx.get('remote.workspacePersona')` 调宿主 |

两者都是**普通 ESM / 普通模块**：

- host 是标准的 Cordis 插件（`export const name / inject / apply`），只 import Node 内置模块与
  `@deepseek-ai/dsh-typert-protocol`；
- client 是手写的 `window.__ModuleLoader__.load({ id, factory })` 模块，`require('react')` /
  `require('@deepseek-ai/dsh-client-ui-primitives')` 由宿主提供，**没有打包步骤**。

`cordis.patch.yml` 把 host 半边挂成一行 loader entry：

```yaml
- insert:
    - id: workspace-persona
      name: dsh-workspace-persona
```

同一行也是浏览器 roster 行 —— 包在 `package.json` 里声明了 `dsh.client`，client-modules 会顺着这行
解析到本包的 `exports["./client"]` 并在 `/plugins/…/client.js` 提供它。

## 2. 数据模型

```jsonc
// $DSH_HOME/workspace-personas.json
{
  "version": 2,
  "personas": [
    {
      "id": "psn_ab12cd34",          // 稳定 id，客户端与远程调用都用它
      "name": "如流助手",
      "enabled": true,
      "text": "…Markdown 人设正文…",
      "targets": [
        { "kind": "workspace", "match": "exact",  "value": "/Users/you/code/my-project" },
        { "kind": "sessionId", "match": "prefix", "value": "im-bot-" }
      ]
    }
  ]
}
```

- **数组顺序即优先级**（`movePersona` 上/下移就是在改这个顺序）。
- `kind`：`workspace`（比对 `agent.session.header.cwd`）或 `sessionId`（比对会话 id）。
- `match`：`exact` / `prefix` / `regex` / `contains`；只有 `exact` 会做路径归一化（`resolve()` 两侧），
  其余三种比对**原样字符串**。空值、非法正则、缺失对应字段 → 该规则不命中（不抛错）。
- `targets: []` = 兜底人设。

## 3. 一次组装里发生了什么

```
模型请求
  └─ dsh-system-prompt 组装 system prompt
       ├─ section -1000  harness identity
       ├─ section 0      deployment:persona-prefix（preset 的 persona 行）
       ├─ section 1      workspace-persona   ← 本插件
       ├─ section 500+   工具引导 …
       └─ section 10200  deployment:persona-suffix
            ▲
            └─ provider 每次组装时求值：
                 store = 读磁盘（mtimeNs:size 戳变了才重读）
                 picked = resolvePersona(store.personas, { cwd, sessionId })
                 return picked ? sanitize(picked.text) : ''
```

`renderPrompt()` 会丢弃渲染为空的 section，所以"没有命中"就等于"完全不注入"，
其它渠道的提示词逐字节不变。

**解析顺序**（`resolvePersona`）：

1. `enabled === false` → 跳过；
2. 按数组顺序：该人设的**任意**一条 `targets` 命中 → 中选；
3. `targets` 为空 → 兜底，中选（应放在列表底部）；
4. 中选者 `text.trim() === ''` → 返回空串（显式静默，用来给兜底开例外）；
5. 全都不中 → 空串 → 原生 system prompt。

**为什么优先级高于 `AGENTS.md`**：`AGENTS.md` 由 `dsh-agent-instructions` 变成一条 **user 角色**的持久消息，
它自带的导语写着 *"They do not override system, developer, or direct user instructions."*；
而本插件写进的是 **system prompt 的 section**。这是框架的结构性保证，不是文案约定。

**变量**：正文里的 `{{model}}` / `{{cwd}}` 由提示词注册表在渲染时解析；其它 `{{…}}` 会在注入前被去括号
（未注册的变量会让整个组装**抛错**，所以必须在插件侧消毒，见 `sanitizePersona`）。

## 4. 远程服务契约

host 侧 `WorkspacePersonaService extends TypertRemoteService`，方法用 `@Remote` 标记
（本包用无装饰器语法的等价写法，在构造函数里跑 marker initializer）。
Gateway 的 **source-mode 发现**会直接把这些方法挂上 `/api/workspacePersona/<method>`，
因此**不需要 codegen、不需要生成的 manifest**。

| 方法 | 入参 | 返回 |
|---|---|---|
| `listPersonas` | — | 视图：`storePath` / `sectionName` / `sectionOrder` / `allowedVariables` / `targetKinds` / `targetMatches` / `tuneModes` / `counts` / `personas[]`（含 `chars`、`catchAll`、每个 target 的 `invalid` 标记） |
| `savePersona` | `{ id?, name, enabled, text, targets }` | 视图（无 `id` = 新建，追加到末尾 = 最低优先级） |
| `deletePersona` | `{ id }` | 视图 |
| `movePersona` | `{ id, delta: -1 \| 1 }` | 视图 |
| `duplicatePersona` | `{ id }` | 视图（副本**默认停用**） |
| `previewMatch` | `{ cwd?, sessionId? }` | `{ subject, personaId, name, reason, silenced, chars, matchedBy[], skipped[] }` |
| `tunePersona` | `{ mode, instruction, text, provider?, model? }` | `{ text, mode, provider, model, source }` |
| `listModels` | — | `{ models[], hostDefault, configured }` |

约定（踩出来的）：

- 客户端 `remote.$mount` 的 codec **只接受 `mode: 'strict'`**，但 schema 只需要有 `parse()`；浏览器侧没有
  `zod` 可 require，所以用极小的手写校验器（`lib/client.js` 顶部的 `codec()`）。
- 远程调用返回**信封** `{ ok: true, value } | { ok: false, error }`；host 抛出的异常到不了浏览器细节，
  所以每个方法内部 try/catch，把失败当**数据**返回（`{ error: '…' }`），UI 才能显示真实原因。
- 方法名不能与 cordis `Service` 的成员冲突（`remove`、`name`、`ctx`…），所以是 `deletePersona` 而不是 `remove`。

## 5. 模型解析（AI 调优）

调优不写死任何厂商，按顺序取：

1. 客户端传来的 `provider`/`model`（UI 下拉，来自 `listModels`）；
2. 本行配置 `config.tuneProvider` / `config.tuneModel`（部署方 pin 死）；
3. 宿主服务 `agentDefaultModel.currentSelection()`（DSH 给新 Agent 的默认选择）；
4. 都没有 → 抛明确错误，UI 提示"没有可用模型"。

## 6. 存储与并发

- 写入是**原子替换**：写 `<file>.tmp-<pid>` 再 `rename`，权限 `600`。
- 读取按 `mtimeNs:size` 戳缓存：戳不变就用内存副本，戳变了重读。因此"另一台进程改了文件"也能被发现，
  且运行中的插件实例在文件被替换后**下一个请求**就生效。
- 迁移：读到 `version !== 2` 的文档时按 v1 语义转换（每个"有内容/启用/有前缀"的工作区条目 → 一个人设；
  v1 的 `default` → 一个无范围的兜底人设），"停用且正文为空"的条目被丢弃并在告警里点名。
  模块导出了 `migrateStore` 供单测直接覆盖。
