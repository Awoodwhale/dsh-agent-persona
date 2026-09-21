# dsh-agent-persona

给不同的**工作区**、不同的**会话**，用不同的 system prompt 人设。

[![npm](https://img.shields.io/npm/v/dsh-agent-persona)](https://www.npmjs.com/package/dsh-agent-persona)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![ci](https://github.com/Awoodwhale/dsh-agent-persona/actions/workflows/ci.yml/badge.svg)](https://github.com/Awoodwhale/dsh-agent-persona/actions/workflows/ci.yml)

[English](./README_EN.md)

## 它能做什么

一个 DSH 部署里常常同时跑着好几摊活：写前端、写文档、盯告警、做代码审查。它们需要不同的身份、口径和约束。
这个插件把人设按**工作区**或**会话**分发出去，每一份都是 system prompt 里的一段：

- **多个人设，各自声明适用范围**：一条人设可以同时用于若干个工作区目录和若干个会话；匹配方式有
  完全一致、开头是、包含、正则匹配四种。
- **越具体越优先**：会话 ID 的规则优先于工作区，精确优先于前缀/正则；只有具体度相同时才按列表顺序决定。
- **显式默认人设**：可以把某一条标成「默认人设」，它会收下所有没被位置命中的会话 —— 同一时刻只允许一条。
  不标就没有兜底，那些会话继续用 DSH 自带的 system prompt。
- **一个位置只能属于一条人设**：把某个工作区/会话配给新人设时，原来占着它的那条会自动失去它，并告诉你从谁那里转来的。
- **追加或替换**：保留 DSH 自带的身份提示、把人设接在后面，或者去掉那句身份提示只用人设。
- **正文为空 = 这里不要人设**：给某个位置加一行、正文留空，就显式地在那里关掉人设。
- **改完下一条消息生效**，不用重启（正文按文件时间戳在每次组装时重读）。
- **工具改不动人设文件**：人设会被注入 system prompt，所以宿主注册了一个全局 `tools.guard`，拒绝一切指向人设
  存储的写入（`write` / `edit` 各类文件工具，以及含写入特征的 shell 命令），只读命令照旧放行。
- **存储读不出来时不会悄悄丢**：文件存在但读不出来（内容坏了、不是人设存储）时，页面会说明原因，并且**在第一次
  保存之前**先把原文件复制成 `personas.json.bak-<时间戳>`；备份失败就不会写入。
- **导入 / 导出**：导出为一份 JSON 文件（同时复制到剪贴板）；导入可以选文件或粘贴，**边输入边预览**每条人设的
  字数与规则数，再以「一律新建、一律停用」的方式写进去，默认人设不会被替换。

三处界面，各管一件事：

| 界面 | 位置 | 用途 |
|---|---|---|
| **设置页** | 设置 → Agent 人设 | 新建/编辑/删除/复制/排序人设；写正文、Markdown 预览、让 AI 改一版。标题旁另有 **GitHub / npm 链接**与**当前安装的版本号**（悬浮会说明这一份是 npm 装来的还是本地开发目录加载的） |
| **会话视图** | 对话页顶部的 **人设** 标签 | 看这条会话命中了哪条人设、**实际发出去的 system prompt**（渲染/源码两视图），以及就地管理全部人设 |
| **侧边栏卡片** | dsh-better-sidebar 的右侧栏 | 把上面那个「人设」页面挂进右侧栏（需要装了该插件） |

四个偏好开关（`编辑后自动保存` / `在对话页显示「人设」标签` / `注册到 dsh-better-sidebar` / `禁止模型改写人设文件`）
都在**设置 → Agent 人设**页里，并且这个页面**不受这些开关影响** —— 关掉「对话页显示」或「注册到 dsh-better-sidebar」后，
回到这里就能重新打开。本插件不在**设置 → 通用设置**里添加任何条目；鼠标停在开关上会给出每个开关的完整说明。

## 为什么它压得住 AGENTS.md

DSH 会把工作区指令（`AGENTS.md` 之类）变成一条 **user 角色**的消息，那条消息自己的导语就写着
*"They do not override system, developer, or direct user instructions."* 而这个插件写的是
**system prompt 的一个 section**（section 名 `agent-persona`，order 1，紧跟在身份行之后）。

这个先后关系是框架定的，不是插件自己声明的 —— 也正因为如此，工作区里怎么改文件都动不了这层人设。

## 装

**实测过的 DSH 版本：`0.1.5-rc.1`（作者的开发环境）与 `0.1.5-rc.2`。** `package.json` 的 `dsh.compatibility`
声明的就是这两项 —— 含义是"我们在这些版本上跑过"，**不是**对更早或更新版本做过兼容工作的承诺；
其它版本请自行验证。

侧边栏卡片还需要 **`dsh-better-sidebar`**：没装它时，「注册到 dsh-better-sidebar」这个开关不会出现
（没有可注册的地方），插件其余功能照常。

```bash
dsh plugin --profile web add dsh-agent-persona
```

装完**重启一次 `dsh web`**：profile 的 bundles 只在启动时读取，插件行是从那里挂进去的。

重启后能看到：

- 设置左栏的 **Agent 人设**；
- `cat ~/.dsh/dsh-agent-persona/state.json` —— 插件的加载心跳，写明了它加载了哪个文件、人设存哪、几条人设。

仓库里也有本地安装脚本：`bash scripts/install.sh`（Windows 是 `scripts/install.ps1`）。

升级与卸载（`dsh plugin …` 就是在 profile 目录里代跑包管理器）：

```bash
dsh plugin --profile web update dsh-agent-persona            # 升级（按依赖的版本范围取最新）
dsh plugin --profile web add dsh-agent-persona@latest        # 想跨大版本升到最新
dsh plugin --profile web remove dsh-agent-persona            # 卸载
```

升级或卸载后**重启一次 `dsh web`**。人设文件不会被删、也不会被覆盖：卸载是人设只留在文件里的操作。

## 用起来

![人设列表](https://raw.githubusercontent.com/Awoodwhale/dsh-agent-persona/main/docs/images/settings-list.png)

点 **新建人设** → 在「适用范围」里加行，选工作区或会话 → 写正文 → 打开启用开关 → 保存。

- **新建出来的人设默认停用**，所以多一条人设不会影响任何现有会话，配好了再开。
- **适用范围**是一行一行加的。每行先选类型（**工作区目录** 或 **某个会话**），再从下拉框里挑具体是谁。
  两种类型互斥：把一行从「工作区」切成「某个会话」，这一行原来选的值会被清掉，重新选。
- 下拉框里的工作区来自 DSH 的工作区列表（带会话数），会话来自 DSH 的全部会话，按时间倒序，
  带**标题**、工作目录和「几分钟前」—— 不记得 session id 是什么没关系，认标题就行。
- 想用前缀、正则这类高级匹配，选 **自己输入…** 就会变成输入框。
- 折叠状态下，卡片第二行分开列出这条人设用在了哪些**工作区**、哪些**会话**；**一个位置都没加**时写着
  「未设置位置：不生效，该会话仍用 DSH 自带的 prompt」——那是停在草稿状态的人设，不是兜底。
- 想让它兜底，就打开卡片里的 **默认人设** 开关；列表行上会出现绿色的「默认」标记。

展开一张卡是这样：

![展开编辑](https://raw.githubusercontent.com/Awoodwhale/dsh-agent-persona/main/docs/images/settings-editor.png)

### 看这条会话聊了什么

下拉框旁边那个按钮会打开一个**只读**弹窗：左右气泡式对话（你的输入在右、Agent 的回复在左）。

- **只显示你真正敲进去的内容**：工作区指令（`AGENTS.md`）、运行时上下文快照、skill 目录说明这类
  **插件注入**的"看起来像用户消息"的东西一律不展示，弹窗顶部只写「已隐藏 N 条插件注入内容」，
  不占位置，也不会让你困惑"这条我没说过"。
- 消息过长会被截断，就地提供 **展开全文**（只重读这一条，换掉这一个气泡）与 **收起全文**。
- **跳到最新** 只显示最后一个用户输入及之后的回复。

### 对话页的「人设」标签

![会话视图](https://raw.githubusercontent.com/Awoodwhale/dsh-agent-persona/main/docs/images/view-persona.png)

选中一条会话后，对话页顶部有 **人设 / 提示词 / 管理** 三个面板：

- **人设**：这条会话命中了哪条人设、**依据是哪几条规则**（命中依据）、正文（Markdown 渲染），
  以及它自己的状态标记（在用 / 已停用、是否默认人设、注入方式）；下面是一个就地编辑器
  （名称、默认人设开关、注入方式、正文），改动后卡片头会出现「未保存 · 点击保存」。
- **提示词**：这条会话**实际发出去的** system prompt，可以切换「渲染 / 源码」、复制、刷新。
  没有命中任何人设时，这里显示的就是 DSH 原生注入的 prompt —— 不做任何特殊处理。
- **管理**：与设置页同一套卡片（新建、启用/停用、编辑、排序、复制、删除），就地管理。

### 四个偏好

| 开关 | 默认 | 含义 | 生效时机 |
|---|---|---|---|
| 编辑后自动保存 | 关 | 停手约 1 秒自动保存编辑区内容 | 立即；切换到人设规则行（工作区/会话）时**不**自动保存，避免存下半截选择 |
| 在对话页显示「人设」标签 | 开 | 是否注册对话页那个视图 | 立即（运行时注册/注销） |
| 注册到 dsh-better-sidebar | 开 | 是否把「人设」页面注册进 dsh-better-sidebar 的右侧栏 | 立即；**没装该插件时这个开关不显示** |
| 禁止模型改写人设文件 | 开 | 拒绝模型的文件与命令工具写入或删除人设存储（读取不受影响）；关掉后模型可以直接改它 | 立即；对**下一次工具调用**生效 |

偏好存在人设文件的 `prefs` 字段里（不是浏览器），所以它和数据的可见范围一致；浏览器里只留一份镜像，
供"加载时决定要不要注册视图"用。

## 注入方式：追加还是替换

| 方式 | 效果 |
|---|---|
| **追加**（默认） | 保留 DSH 自带的那句身份提示，这条人设接在它后面 |
| **替换** | 去掉 DSH 自带的身份句（以及部署自己写的 persona 段），只用这条人设 |

「替换」只动**部署自己写的**那句 persona；如果某个 Agent 预设在自己作用域里写了 persona（把这一段遮蔽了），
插件不会去覆盖它 —— 别人的身份提示优先。

## 匹配是怎么算的

宿主在每次组装 system prompt 时按这个顺序过一遍：

1. 人设停用了 → 跳过；
2. 一条人设的**任意一行**匹配上，它就是候选，按"具体度"比较（会话 ID 3 分 > 工作区 1 分；精确 > 前缀/包含/正则）；
3. 具体度相同 → 取列表里靠上的那条（顺序在卡片的 `⋯` 菜单里调）；
4. **一个位置都没加的人设不参与匹配**（草稿态），除非它被标成「默认人设」；
5. 谁都没命中 → 看有没有「默认人设」，有就用它，没有就不注入；
6. 赢家的正文是空的 → 不注入任何人设（这是"这里明确不要人设"的表达方式）。

四种匹配方式里只有 `完全一致` 会把路径归一化（`/a/project/` 和 `/a/project` 算同一个）；
`开头是`、`包含`、`正则匹配` 都是拿你写的字符串直接比。值空着、正则写错、或者会话没有那个字段，
都算「不匹配」，不会报错。

## 文件与配置

```
~/.dsh/dsh-agent-persona/
├── personas.json   # 人设数据 + 偏好，权限 600，原子写入
└── state.json      # 加载心跳，每次加载时重写
```

正文里可以写 `{{model}}` 和 `{{cwd}}`，渲染时替换成当前的值；其他 `{{...}}` 会被去掉（未注册的变量会让
整个组装抛错，所以这里做了保护）。

配置项（Schemastery schema，加载时校验，写错类型会**加载失败**而不是被忽略）：

| 配置 | 默认 | 说明 |
|---|---|---|
| `storePath` | `''` | 人设文件位置；留空即 `$DSH_HOME/dsh-agent-persona/personas.json` |
| `tuneProvider` | `''` | AI 调优用哪个 provider；留空即 DSH 当前设置的模型 |
| `tuneModel` | `''` | 同上，模型 id |

### 多个 profile 各用自己的人设文件（可选）

人设数据默认是**全局一份**（`$DSH_HOME/dsh-agent-persona/personas.json`，与其它插件的状态目录同一约定），
所以同一台机器上的多个 profile 共用同一份人设。要让某个 profile 独立，在**该 profile** 的
`cordis.patch.yml` 里覆盖它自己的路径（是覆盖字段，**不要**再 insert 一行）：

```yaml
# ~/.dsh/profiles/<该 profile>/cordis.patch.yml
- id: agent-persona
  config:
    storePath: /Users/you/.dsh/profiles/<该 profile>/personas.json
```

也可以用 `DSH_HOME` 环境变量把整个 `~/.dsh` 指向别的目录（那样连会话记录、其它插件状态一起隔离）。
当前生效的文件路径始终显示在「Agent 人设」页面的 meta 行上（`保存在 …`），不会出现"改了半天不知道改的是哪一份"。

## AI 改一版用哪个模型

默认用 **DSH 当前设置的模型**，设置页里的下拉框会把它预选好；想固定别的模型就用上面的 `tuneProvider`/`tuneModel`。
AI 只产出建议稿，点「采用」或「追加」才会进编辑框，再点保存才落盘。

## 几句实话

- **人设是行为约束，不是安全边界**。它约束模型怎么说，不阻止模型用工具。
- `personas.json` 的防篡改是**行为层面**的：插件注册了全局 `tools.guard`，拒绝指向该文件的写入（文件工具看参数里
  的路径，shell 命令看"是否提到该路径或文件名"且"是否带写入特征"）。本机是 `danger-full-access` 时仍然可以绕过：
  改插件代码、改 profile 的补丁文件，或者构造一条不带写入特征的载荷。要更结实就得在本机层面做：
  `chflags uchg <人设文件>`（自己改之前先 `chflags nouchg`），或者把 DSH 跑在受限沙箱里、让人设文件属于别的用户。
- 那条 shell 判定**按整条命令**生效：把 `md5 <人设文件>` 和 `chmod <人设文件>` 写在同一行，整条都会被拒（设计如此）。
- 多处同时匹配时**只取第一条**，不拼接；规则是线性扫的，几十条没问题，几百条就该重新设计了。
- 一个 profile 里只装一次。同一个进程挂两个同 id 的行会让组合起不来。
- **测试的边界**：仓库里的测试是**单元测试 + 源码审计**（200 条宿主断言 + 165 条客户端断言 + 生成产物漂移校验；
  这个数字由测试自己统计，不会随文件改动而失真），
  它们保证逻辑与代码形状，**不驱动浏览器** —— 界面行为（视图渲染、开关、侧边栏卡片）目前靠人工核对。

## 开发

源码是 TypeScript，`lib/` 是构建产物（不进 git，`npm publish` 前由 `prepare` 构建）：

```
src/index.ts       host 半边：存储、匹配、system-prompt section、远程服务
src/client.ts      client 半边：设置页 + 会话视图 + 侧边栏卡片（打包成单文件 lib/client.js）
src/endpoints.ts   远程方法的单一来源（生成 src/remote.ts 与 src/typert.ts）
scripts/           生成器 + 安装脚本
test/              单元测试与源码审计
docs/              架构、开发笔记、设计决策
```

```bash
npm install
npm run build        # generate:remote → tsc → esbuild（产出 lib/）
npm run typecheck    # 两个 tsconfig 都不报错
npm test             # 200 + 165 条断言 + 生成产物漂移校验
dsh --profile web --dump-config | grep -c 'id: agent-persona'   # 组合自检，应输出 1
```

改代码之后怎么生效：

- `src/**` 改完必须 **`npm run build`**（`lib/` 是产物）。
- 客户端产物（`lib/client.js`）改**内容**：客户端会按内容重算，**刷新页面**即可；别改文件名。
- 宿主产物（`lib/index.js`）改**内容**：ESM 按 URL 缓存模块，**不会**自动重载 —— 重启 `dsh web`。
- `package.json` 的 `dsh.bundle.patch` 或 profile 的 `bundles` 有改动：必须重启。
- 生成产物（`src/remote.ts`、`src/typert.ts`）**不要手改**：改 `src/endpoints.ts` 后跑
  `npm run generate:remote`，`npm test` 会校验它们是否与来源一致。

细节在 [docs/development.md](./docs/development.md)，内部结构在 [docs/architecture.md](./docs/architecture.md)。

## 许可

Apache-2.0，见 [LICENSE](./LICENSE)。
