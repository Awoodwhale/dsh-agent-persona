<div align="center">

# dsh-workspace-persona

**给每个工作区 / 每条会话一套 system prompt 人设**

一个人设一个「适用范围」，按工作目录与会话 ID 精确投递；<br />
多个独立人设、可排序的优先级、兜底与例外，全部在 Web 设置面板里完成。<br />
人设存在**工作区之外**，工作区里的对话无法成为自己身份的来源。

<a href="https://www.npmjs.com/package/dsh-workspace-persona"><img alt="npm version" src="https://img.shields.io/npm/v/dsh-workspace-persona" /></a>
<a href="https://www.npmjs.com/package/dsh-workspace-persona"><img alt="npm downloads" src="https://img.shields.io/npm/dm/dsh-workspace-persona" /></a>
<a href="https://github.com/awoodwhale/dsh-workspace-persona/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/awoodwhale/dsh-workspace-persona/actions/workflows/ci.yml/badge.svg" /></a>
<a href="https://github.com/awoodwhale/dsh-workspace-persona/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/awoodwhale/dsh-workspace-persona" /></a>
<a href="https://opensource.org/licenses/Apache-2.0"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/License-Apache--2.0-blue.svg" /></a>
<a href="https://www.npmjs.com/package/@deepseek-ai/dsh?activeTab=versions"><img alt="支持的 DSH 版本：0.1.5-rc.1+（已在 0.1.5-rc.2 上验证）" src="https://img.shields.io/badge/DSH-0.1.5--rc.1%2B_%28verified_rc.2%29-4d6bfe" /></a>
<a href="https://dshfind.com/zh/plugins/awoodwhale/dsh-workspace-persona"><img alt="dshfind" src="https://dshfind.com/api/badge/awoodwhale/dsh-workspace-persona?lang=zh" /></a><br /><br />
<img alt="多个人设" src="https://img.shields.io/badge/-多个人设-4d6bfe" /> <img alt="范围匹配" src="https://img.shields.io/badge/-范围匹配-4d6bfe" /> <img alt="顺序即优先级" src="https://img.shields.io/badge/-顺序即优先级-4d6bfe" /> <img alt="命中测试" src="https://img.shields.io/badge/-命中测试-4d6bfe" /> <img alt="Markdown 编辑" src="https://img.shields.io/badge/-Markdown%20编辑-4d6bfe" /> <img alt="AI 调优" src="https://img.shields.io/badge/-AI%20调优-4d6bfe" /> <img alt="零运行时依赖" src="https://img.shields.io/badge/-零运行时依赖-4d6bfe" />

<div>
  🌏 <a href="./README.md"><b>中文</b></a> · <a href="./README_EN.md">English</a>
</div>

<div>
  <img alt="工作区人设：折叠列表与优先级" src="./docs/images/settings-list.png" width="620" />
</div>

</div>

> **English TL;DR** — A DSH plugin that injects system-prompt personas per workspace/session. Create many
> personas; each declares its own scope (workspace path or session id, matched exactly / by prefix / regex /
> substring). Managed from a Web settings page with Markdown editing, live preview, a host-computed match
> test and AI tuning. Personas live outside any workspace, so a conversation inside a workspace cannot be the
> source of its own identity. [English README →](./README_EN.md)

## 📑 目录

- [✨ 功能一览](#-功能一览)
- [🚀 安装](#-安装)
- [🖼️ 特性巡礼](#️-特性巡礼)
- [🧭 匹配规则](#-匹配规则)
- [🗄️ 存储与注入](#️-存储与注入)
- [⚙️ 行配置](#️-行配置)
- [🔌 服务化扩展](#-服务化扩展)
- [🛠️ 开发](#️-开发)
- [🔐 安全](#-安全) · [⚠️ 已知限制](#️-已知限制) · [🖥️ 平台支持](#️-平台支持)
- [🆕 最近更新](#-最近更新) · [🤝 参与贡献](#-参与贡献) · [⭐ Star History](#-star-history)

## ✨ 功能一览

- **👥 多个人设**：不是"一个工作区一个人设"，而是任意多个人设，各自独立启用 / 停用、重命名、复制、排序。
- **🎯 精确投递**：每个人设自带一组匹配规则 —— `工作区目录` 或 `会话 ID`，四种匹配方式
  （精确 / 前缀 / 正则 / 包含），同一人设内多条规则是「或」。
- **↕️ 顺序即优先级**：列表自上而下第一个命中的生效；卡片上的 `↑ ↓` 就是调优先级。
- **🪄 兜底与例外**：不填规则的人设是**兜底**；正文留空的人设一旦命中就表示"这里不要人设"，
  可以给兜底开例外。
- **📝 设置面板内完成**：折叠卡列表 → 展开内联编辑 → 适用范围规则编辑器 → Markdown 编辑 / 预览 →
  AI 调优 → 保存。`⌘/Ctrl+S` 保存。
- **🔍 命中测试**：填一个 `cwd` 和 / 或会话 ID，由**宿主**用同一套解析器算一遍 —— 命中谁、由哪条规则
  命中、是否因正文为空而静默、跳过了几个停用人设。页面永远不会与真实注入漂移。
- **🤖 AI 调优**：润色 / 补充细节 / 精简 / 按描述生成；模型只产出**建议稿**，点「采用 / 追加 / 放弃」，
  **不会自动保存**。模型来源优先取界面选择，其次本行配置，最后宿主的 `agentDefaultModel`。
- **🧱 system-prompt 级**：注入为 system prompt 的 section（order 1），**优先级高于工作区 `AGENTS.md`**。
- **🗂️ 工作区之外**：人设存 `$DSH_HOME/workspace-personas.json`，改完**下一个请求**生效，无需重启。
- **📦 零运行时依赖 / 无构建**：host 是普通 ESM 插件，client 是手写的 `__ModuleLoader__` 模块，
  仓库里 `lib/` 就是源码；单测只用 Node 内置模块。

## 🚀 安装

```bash
# 装进 web profile（CLI 会自动把本包接进 profile 的 bundles 层）
dsh plugin --profile web add dsh-workspace-persona

# 重启 dsh web —— profile 的 bundles 只在启动时读取
```

也可以直接用仓库里的脚本：

```bash
bash scripts/install.sh              # 默认 profile: web
pwsh -File scripts/install.ps1       # Windows
```

**重启后确认**：

1. 侧边栏 **设置 → 左栏出现「工作区人设」**；
2. `cat "$DSH_HOME/workspace-persona.state.json"` —— 本插件 host 半边的加载心跳（含实际加载的文件路径）。

## 🖼️ 特性巡礼

<table>
<tr>
<td width="50%">

**人设列表**：序号 / 状态点 / 名称 / 状态徽标 / 适用范围 chips / 字数，
`↑ ↓` 调优先级，`复制`、`编辑`、删除（两次确认）。顶部 `新建人设` 建出来**默认停用** —— 新增动作
永远不改变任何会话当前拿到的人设。

</td>
<td width="50%">

**展开编辑**：名称 + 启用开关、适用范围规则编辑器、Markdown 正文（编辑 / 预览）、
AI 调优折叠、底部 `字符数 · ⌘S`、`复制 / 删除 / 收起 / 保存`。

</td>
</tr>
<tr>
<td><img alt="人设列表" src="./docs/images/settings-list.png" /></td>
<td><img alt="展开编辑" src="./docs/images/settings-editor.png" /></td>
</tr>
</table>

## 🧭 匹配规则

一条规则是 `{ kind, match, value }`：

- `kind` — `workspace`（比对会话的工作目录 `cwd`）或 `sessionId`（比对会话 ID）
- `match` — `exact` 精确 / `prefix` 前缀 / `regex` 正则 / `contains` 包含
- 只有 `exact` 会做路径归一化（`…/project/` 与 `…/project` 等价）；`prefix` / `contains` / `regex`
  比对**你原样输入的字符串**（这才让 `contains "my-project"` 这种写法可用）。

**解析顺序**（宿主在每次组装 system prompt 时执行）：

1. 人设**停用** → 整个跳过；
2. 按**列表顺序**逐个看：该人设的**任一条**规则命中 → 它就是赢家；
3. 人设**没有任何规则** → 兜底，命中所有未被前面命中的会话（放在列表底部）；
4. 赢家正文**为空** → 不注入任何人设（显式静默，可给兜底开例外）；
5. 谁都没命中 → 该 section 渲染为空并被丢弃 → 会话保持 **DSH 原生 system prompt**。

## 🗄️ 存储与注入

| 项目 | 值 |
|---|---|
| 人设数据 | `$DSH_HOME/workspace-personas.json`（默认 `~/.dsh/workspace-personas.json`，原子写入，权限 600） |
| 加载心跳 | `$DSH_HOME/workspace-persona.state.json` |
| 注入位置 | system prompt section `workspace-persona`，order = `DEPLOYMENT_PERSONA_PREFIX + 1` = **1** |
| 模板变量 | `{{model}}`、`{{cwd}}`（其他 `{{…}}` 会被去掉，避免组装失败） |
| 生效时机 | 数据文件按 `mtimeNs:size` 戳在**每次组装**时重读 → 改完**下一个请求**生效 |

**为什么优先级高于 `AGENTS.md`**：工作区指令由 `dsh-agent-instructions` 变成一条 **user 角色**的消息，
它自带的导语写着 *"They do not override system, developer, or direct user instructions."*；
而本插件写进的是 **system prompt 的 section**。这是框架的结构性保证。

## ⚙️ 行配置

给部署固定 AI 调优用的模型（在 profile 的用户补丁层覆盖这一行，**不要**重新 insert 它）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: workspace-persona
  config:
    tuneProvider: your-provider
    tuneModel: your-model-id
```

## 🔌 服务化扩展

host 半边对外提供 `workspacePersona` 远程命名空间（typert source-mode，**不需要 codegen**），
设置页用的就是同一套接口：

| 方法 | 说明 |
|---|---|
| `listPersonas` | 完整视图（存储路径、section 信息、常量表、计数、人设数组） |
| `savePersona` / `deletePersona` | 新建（无 `id`）/ 更新 / 删除 |
| `movePersona` / `duplicatePersona` | 调优先级 / 复制（副本默认停用） |
| `previewMatch` | 给定 `cwd` / `sessionId` 解析出赢家与命中原因 |
| `tunePersona` / `listModels` | AI 调优与可选模型 |

契约细节、信封约定与踩坑见 [docs/architecture.md](./docs/architecture.md)。

## 🛠️ 开发

```bash
npm test        # 40 项断言：匹配引擎、v1→v2 迁移、注入、心跳
npm run check   # 两个半边的语法检查
dsh --profile web --dump-config | grep -c 'id: workspace-persona'   # 组合自检，期望 1
```

**改代码怎么生效**（DSH 的插件重载语义：`patchReload: live` 只 watch patch 文件）：

- `lib/client.js` 改**内容** → 客户端产物重算，刷新页面即可（别改文件名，换了名字不会重算）；
- `lib/index.js`（host）改**内容** → **不会**重新 import（ESM 按 URL 缓存）；免重启迭代要么换一个
  新文件名并在 patch 里指向它，要么重启 `dsh web`；
- `package.json` 的 `dsh.bundle.patch` 或 `profile.bundles` → 需要重启。

详见 [docs/development.md](./docs/development.md)，设计决策见 [docs/plans/](./docs/plans/)。

## 🔐 安全

- 人设是**行为约束**，不是安全边界：它约束模型，但不阻止模型执行工具。
- `$DSH_HOME/workspace-personas.json` 是**普通文件**：任何拥有文件工具权限的会话都能写它
  （本插件目前不注册 `tools.guard`）。若需要"工作区里的会话改不动人设"，请在本机层加固，例如
  `chmod 400` + 由独立用户持有，或把 DSH 跑在受限沙箱里。
- 仓库与 npm 包内**不含任何凭据**；人设内容由使用者自己维护。

## ⚠️ 已知限制

- AI 调优需要一个可用模型：界面选择 → 行配置 → 宿主 `agentDefaultModel`，都没有时会明确报错。
- 规则匹配是**线性扫描**（几十条量级），没有索引；人设数量极大时需要重新设计。
- 多条命中时**不拼接**，只有第一条生效（拼接方案见 `docs/plans/` 里被否掉的替代方案）。
- 一个进程内只挂载一个 `workspace-persona` section；同一个 profile 不要重复引入本插件。

## 🖥️ 平台支持

宿主半边只用 Node 内置模块；客户端半边是浏览器模块。macOS / Linux / Windows 均可，
`scripts/` 下两个安装脚本分别覆盖 Bash 与 PowerShell。不依赖终端 / PTY 等平台相关能力。

## 🆕 最近更新

见 [CHANGELOG.md](./CHANGELOG.md)。`0.1.0` 为首次发布：多个人设 + 适用范围 + 命中测试 + AI 调优，
并带 v1 → v2 自动迁移。

## 🤝 参与贡献

- 提 issue 请附上：DSH 版本（`dsh --version`）、`$DSH_HOME/workspace-persona.state.json`、以及
  host 日志里带 `[workspace-persona]` 前缀的那几行。
- 改代码请跑 `npm run check && npm test`；新增行为请补充 `test/personas.test.mjs` 的断言。
- 提交信息用 conventional commits（`feat:` / `fix:` / `docs:` …）。

## ⭐ Star History

<a href="https://star-history.com/#awoodwhale/dsh-workspace-persona&Date">
  <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=awoodwhale/dsh-workspace-persona&type=Date" />
</a>

## 📄 许可

[Apache-2.0](./LICENSE) © 2026 awoodwhale
