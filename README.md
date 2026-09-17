# dsh-workspace-persona

给 [DeepSeek Harness](https://www.deepseek.com/harness/)（DSH）用的**工作区人设插件**：可以创建**多个人设**，
每个人设自己声明适用范围（工作区目录 / 会话 ID × 精确 / 前缀 / 正则 / 包含），在 Web 的「设置」面板里
用 Markdown 编辑、预览，并可用当前模型做 AI 调优。

> **English TL;DR** — A DSH plugin that injects system-prompt personas per workspace/session. Create many
> personas; each declares its own scope (cwd or session id, matched exactly / by prefix / regex / substring).
> Managed from a Web settings page with Markdown editing, live preview, a match-test tool and AI tuning.
> Personas live outside any workspace, so a conversation inside a workspace cannot be the source of its own
> identity. Requires DeepSeek Harness; install with `dsh plugin --profile web add dsh-workspace-persona`.

---

## 特性

- **多个人设**：不是"一个工作区一个人设"，而是一个插件里放任意多个人设，各自独立启用/停用。
- **精确投递**：每个人设自带一组匹配规则 —— `工作区目录` 或 `会话 ID`，四种匹配方式（精确 / 前缀 / 正则 / 包含）。
- **可解释的优先级**：列表顺序即优先级，自上而下第一个命中的生效；规则为空的人设是兜底。
- **设置面板内完成**：设置 → **工作区人设** —— 折叠卡列表、内联展开编辑、Markdown 预览、AI 调优、
  **命中测试**（由宿主真实解析一遍，告诉你这条会话会拿到哪个人设、由哪条规则命中）。
- **system-prompt 级**：注入为 system prompt 的 section（order 1），**优先级高于工作区 `AGENTS.md`**。
- **工作区之外的数据**：人设存在 `$DSH_HOME/workspace-personas.json`，不落在任何工作区里，改完下一个请求生效。
- **零运行时依赖**：只用 Node 内置模块 + DSH 宿主提供的服务；客户端半边是手写的
  `__ModuleLoader__` 模块，**不需要打包/构建**。

## 它解决什么问题

`AGENTS.md` 是**工作区里的一个普通文件**：任何能在该工作区里读写文件的会话都可以改它，而且它是按目录生效的，
没法区分"从如流来的会话"和"从 Web 来的会话"。

本插件把"身份"提到 **system prompt** 层：人设正文放在工作区之外，按 `cwd` / 会话 ID 精确投递给符合条件的那条会话。
DSH 自身也给了结构性保证 —— 工作区指令（`AGENTS.md`）是由 `dsh-agent-instructions` 变成一条 **user 角色的消息**，
它自带的导语就写着 *"They do not override system, developer, or direct user instructions."*。

## 安装

```bash
# 装进 web profile（CLI 会把本包接入 profile 的 bundles 层）
dsh plugin --profile web add dsh-workspace-persona

# 重启 dsh web —— profile 的 bundles 只在启动时读取
```

重启后确认：

1. 侧边栏 **设置 → 左栏出现「工作区人设」**；
2. `cat "$DSH_HOME/workspace-persona.state.json"` 出现（本插件 host 半边的加载心跳，含实际加载的文件路径）。

> 从本地目录开发安装：`dsh plugin --profile web add /path/to/dsh-workspace-persona`
> （CLI 会把相对路径按你当前目录锚定后再交给 pnpm）。

## 使用

**设置 → 工作区人设**：

| 操作 | 说明 |
|---|---|
| **新建人设** | 新建的人设**默认停用** —— 新增永远不会改变任何会话当前拿到的人设。配好范围再打开开关。 |
| **适用范围** | 每行 `[工作区目录 \| 会话 ID] [精确 \| 前缀 \| 正则 \| 包含] [匹配值]`，可加多行；**同一人设内多条规则是「或」**。 |
| **优先级** | 卡片右侧 `↑ ↓` 调整顺序 —— **列表越靠上优先级越高**，第一条命中的生效。 |
| **正文** | Markdown，可切「编辑 / 预览」；`⌘/Ctrl+S` 保存。**正文留空 = 这个人设命中后不使用任何人设**（用来给兜底开例外）。 |
| **命中测试** | 填一个 `cwd` 和/或会话 ID，由**宿主**用同一套解析器算一遍：命中谁、由哪条规则命中、是否因正文为空而静默、跳过了几个停用人设。 |
| **AI 调优** | 选模式（润色 / 补充细节 / 精简 / 按描述生成）+ 可选要求 → 模型只产出**建议稿**，点「采用 / 追加 / 放弃」，**不会自动保存**。 |
| **复制 / 删除** | 复制出的副本**默认停用**；删除需要点两次确认。 |

## 匹配规则

一条规则是 `{ kind, match, value }`：

- `kind` — `workspace`（比对会话的工作目录 `cwd`）或 `sessionId`（比对会话 ID）
- `match` — `exact` 精确 / `prefix` 前缀 / `regex` 正则 / `contains` 包含
- 只有 `exact` 会把路径做归一化（所以 `…/project/` 与 `…/project` 等价）；`prefix` / `contains` / `regex`
  一律比对**你原样输入的字符串**（这才让 `contains "my-project"` 这种写法可用）。

**解析顺序**（宿主每次组装 system prompt 时执行）：

1. 人设**停用** → 整个跳过；
2. 按**列表顺序**逐个看：该人设的**任一条**规则命中 → 它就是赢家；
3. 人设**没有任何规则** → 兜底，命中所有尚未被前面命中的会话（放在列表底部）；
4. 赢家的正文**为空** → 不注入任何人设（显式静默，可给兜底开例外）；
5. 谁都没命中 → 该 section 渲染为空并被丢弃 → 会话保持 **DSH 原生 system prompt**。

## 存储与注入

| 项目 | 值 |
|---|---|
| 人设数据 | `$DSH_HOME/workspace-personas.json`（默认 `~/.dsh/workspace-personas.json`，权限 600） |
| 加载心跳 | `$DSH_HOME/workspace-persona.state.json` |
| 注入位置 | system prompt section `workspace-persona`，order = `DEPLOYMENT_PERSONA_PREFIX + 1` = **1** |
| 模板变量 | `{{model}}`、`{{cwd}}`（其他 `{{…}}` 会被去掉，避免组装失败） |
| 生效时机 | 数据文件按 `mtimeNs:size` 戳在**每次组装**时重读 → 改完**下一个请求**生效，无需重启 |

### 行配置（可选）

想让某个部署固定用某个模型做 AI 调优，在 profile 的用户补丁层里覆盖这一行即可：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: workspace-persona
  config:
    tuneProvider: your-provider
    tuneModel: your-model-id
```

不配置时，调优按钮使用宿主自己的默认模型选择（`agentDefaultModel` 服务）；两者都拿不到时，界面会明确提示"没有可用模型"。

## 安全边界（请读一下）

- 人设是**行为约束**，不是安全边界：它约束模型，但不阻止模型执行工具。
- `$DSH_HOME/workspace-personas.json` 是一个**普通文件**：任何拥有文件工具权限的会话都能写它（本插件目前
  不注册 `tools.guard`）。如果你需要"工作区里的会话改不动人设"，请在本机层加固，例如
  `chmod 400` + 独立用户持有，或把 DSH 跑在受限沙箱里。

## 开发

```
.
├── cordis.patch.yml      # bundle patch：插入 id=workspace-persona 的 loader 行
├── lib/
│   ├── index.js          # host 半边：存储、匹配引擎、system-prompt section、workspacePersona 远程服务
│   └── client.js         # client 半边：设置页（手写 __ModuleLoader__ 模块，无构建步骤）
├── test/personas.test.mjs# 匹配引擎 + v1→v2 迁移 + section 注入的离线单测（只用 node 内置模块）
└── package.json          # main / exports["./client"] / dsh.bundle.patch / dsh.client
```

```bash
npm test        # 40 项断言
npm run check   # 两个半边的语法检查
```

### 修改代码后如何让它生效（DSH 的插件重载语义，踩过的坑）

- **profile 的 `bundles` 只在启动时读取**：改了 `package.json` 的 `dsh.bundle.patch` 或 `bundles` 列表，需要重启 `dsh web`。
- **host 半边改了文件名**：`patchReload: live` 会重新应用补丁层，但**同一个模块路径不会重新 import**（ESM 缓存）。
  要免重启地试新代码，就改一个**新文件名**并在 profile 里指向它（或重启）。
- **client 半边**：`lib/client.js` 的**内容**变化会触发客户端产物重算（刷新页面即可）；
  但**换文件名/改 `exports['./client']` 不会**触发重算 —— 保持这个稳定文件名、只改内容。
- **本地开发接线**：如果你在 profile 的用户补丁层手写 `insert` 指向本插件的某个文件路径，
  就**不要**同时让本包声明 `dsh.bundle.patch` —— 那样同一个 id 会被插两次，组合无法启动
  （`duplicate loader entry id`）。
- 组合自检（不启动服务器）：`dsh --profile web --dump-config | grep -c 'id: workspace-persona'` → 应为 `1`。

## 兼容性

在 `@deepseek-ai/dsh` **0.1.5-rc.1** / `dsh-web-app` **0.1.5-rc.2** 上开发并实测（Node v25）。
`package.json` 的 `dsh.compatibility.dshReleases` 会在不同 DSH 版本上更新。

## 许可

[Apache-2.0](./LICENSE) © 2026 awoodwhale
