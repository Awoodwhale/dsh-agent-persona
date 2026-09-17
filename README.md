# dsh-agent-persona

给不同的**工作区**、不同的**会话**，用不同的 system prompt 人设。

一个 DSH 部署里常常同时跑着好几摊活：写前端、写文档、盯告警、做代码审查。它们需要不同的身份、口径和约束。
把人设按工作区或会话分发出去，比在每个工作区里各放一份文件省事得多：

- 人设存在**工作区之外**（`~/.dsh/dsh-agent-persona/`）：工作区里的对话改不到它，也不会被
  `git checkout` 或一次清理带走。
- 注入的是 **system prompt 的一段**，不是一条提示消息 —— 优先级在工作区 `AGENTS.md` 之上。
- 配置全在 Web 设置页里：新建人设、从下拉框里选工作区或会话、写正文、让 AI 用当前模型改一版。
- 改完**下一条消息**就生效，不用重启。

[![npm](https://img.shields.io/npm/v/dsh-agent-persona)](https://www.npmjs.com/package/dsh-agent-persona)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![ci](https://github.com/awoodwhale/dsh-agent-persona/actions/workflows/ci.yml/badge.svg)](https://github.com/awoodwhale/dsh-agent-persona/actions/workflows/ci.yml)

[English](./README_EN.md)

## 为什么它压得住 AGENTS.md

DSH 会把工作区指令（`AGENTS.md` 之类）变成一条 **user 角色**的消息，那条消息自己的导语就写着
*"They do not override system, developer, or direct user instructions."* 而这个插件写的是
**system prompt 的一个 section**（order 1，紧跟在身份行之后）。

这个先后关系是框架定的，不是插件自己声明的 —— 也正因为如此，工作区里怎么改文件都动不了这层人设。

## 装

```bash
dsh plugin --profile web add dsh-agent-persona
```

装完**重启一次 `dsh web`**：profile 的 bundles 只在启动时读取，插件行是从那里挂进去的。

重启后能看到：

- 侧边栏 **设置 → Agent人设**；
- `cat ~/.dsh/dsh-agent-persona/state.json` —— 插件的加载心跳，写明了它加载了哪个文件、人设存哪。

仓库里也有安装脚本：`bash scripts/install.sh`（Windows 是 `scripts/install.ps1`）。

## 怎么用

![人设列表](./docs/images/settings-list.png)

点 **新建人设** → 在「用在哪些地方」里选工作区或会话 → 打开开关 → 保存。

- **新建出来的人设默认停用**，所以多一条人设不会影响任何现有会话，配好了再开。
- **用在哪些地方**是一行一行加的。每行先选类型（**工作区** 或 **某个会话**），再从下拉框里挑具体是谁。
  两种类型互斥：把一行从「工作区」切成「某个会话」，这一行原来选的值会被清掉，重新选。
- 下拉框里的工作区来自 DSH 的工作区列表（带会话数），会话来自 DSH 的全部会话，按时间倒序，
  带标题、工作目录和「几分钟前」—— 不记得 session id 是什么没关系，认标题就行。
- 想用前缀、正则这类高级匹配，选 **自己输入…** 就会变成输入框。
- **顺序就是优先级**：顺序在卡片的 `⋯` 菜单里调（上移/下移），自上而下第一个匹配到的生效。
- **一行都不加的人设是默认人设**，会用在所有没被前面人设覆盖的会话上，放列表最后。
- 反过来，如果某个地方**就是不要人设**：给它加一行、正文留空。正文为空的人设一旦匹配上，就不注入任何人设。

展开一张卡是这样：

![展开编辑](./docs/images/settings-editor.png)

## 一个人设管一个地方

一个工作区、一条会话，**只能属于一条人设**。把某个位置配给一条新人设时，原来占着它的那条会自动失去这个位置，
保存后会告诉你从谁那里转过来的（`⋯` → 上移/下移的另一半就是这件事的兜底：万一是前缀/正则这类重叠，
仍然按列表顺序取第一条）。

在下拉框里也能直接看到占用情况：已经被别人占着的工作区/会话，后面会写着「已被「X」使用」。

选中一条会话之后，旁边那个按钮可以**看一眼这条会话聊过什么**（最近几条消息），
方便判断这个位置到底该不该套人设。

## 注入方式：追加还是替换

每条人设可以选它和 DSH 自带身份提示的关系：

| 方式 | 效果 |
|---|---|
| **追加**（默认） | 保留 DSH 自带的那句身份提示，这条人设接在它后面 |
| **替换** | 去掉 DSH 自带的身份那句话，只用这条人设 |

「替换」只动**部署自己写的**那句 persona；如果某个 Agent 预设在自己作用域里写了 persona（把这一段遮蔽了），
插件不会去覆盖它 —— 别人的身份提示优先。

## 匹配是怎么算的

宿主在每次组装 system prompt 时按这个顺序过一遍：

1. 人设停用了 → 跳过；
2. 按列表顺序，只要该人设的**任意一行**匹配到，它就是赢家；
3. 一行都没加的人设是默认人设，收下剩下所有会话；
4. 赢家的正文是空的 → 不注入任何人设；
5. 全都没匹配到 → 这段渲染为空、被丢掉，会话用它原本的 DSH system prompt。

四种匹配方式里只有 `完全一致` 会把路径归一化（`/a/project/` 和 `/a/project` 算同一个）；
`开头是`、`包含`、`正则匹配` 都是拿你写的字符串直接比。值空着、正则写错、或者会话没有那个字段，
都算「不匹配」，不会报错。

## 文件放在哪

```
~/.dsh/dsh-agent-persona/
├── personas.json   # 人设数据，权限 600，原子写入
└── state.json      # 加载心跳，每次加载时重写
```

正文里可以写 `{{model}}` 和 `{{cwd}}`，渲染时替换成当前的值；其他 `{{...}}` 会被去掉（未注册的变量会让
整个组装抛错，所以这里做了保护）。

数据文件按 mtime 在**每次组装时**重读，改完下一条消息生效。

## AI 改一版用哪个模型

默认就用 **DSH 当前设置的模型**（宿主的 `agentDefaultModel`），设置页里的下拉框会把它预选好。
想给某个部署固定另一个模型，在 profile 的用户补丁层覆盖这一行（**不要**再 insert 一次）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: agent-persona
  config:
    tuneProvider: your-provider
    tuneModel: your-model-id
```

同一行里还能用 `storePath` 换人设文件的存放位置。AI 只产出建议稿，点「采用」或「追加」才会进编辑框，
再点保存才落盘。

## 几句实话

- **人设是行为约束，不是安全边界**。它约束模型怎么说，不阻止模型用工具。
- `personas.json` 就是个**普通文件**，任何有文件工具权限的会话都写得动它 —— 这个插件**没有**注册
  `tools.guard`。真要「工作区里的会话改不动人设」，得在本机层面做：`chmod 400` + 换个属主，
  或者把 DSH 跑在受限沙箱里。
- 多处同时匹配时**只取第一条**，不拼接。（拼接考虑过，不好预测也不好排查，放弃了。）
- 规则是线性扫的，几十条没问题，几百条就该重新设计了。
- 一个 profile 里只装一次。同一个进程挂两个同 id 的行会让组合起不来。

## 开发

```
lib/index.js      host 半边：存储、匹配、section、远程服务（就是源码，没有构建产物）
lib/client.js     client 半边：设置页，手写的 __ModuleLoader__ 模块
test/             76 条断言，只用 Node 内置模块
docs/             架构、开发笔记、设计决策
scripts/          安装脚本
```

```bash
npm test        # 跑断言
npm run check   # 两个半边的语法检查
dsh --profile web --dump-config | grep -c 'id: agent-persona'   # 组合自检，应该输出 1
```

改代码之后怎么生效，有几个坑值得先看一眼：

- `lib/client.js` 改**内容**：客户端产物会重算，刷新页面就行。但别改文件名 —— 换个名字它不会重算。
- `lib/index.js` 改**内容**：**不会**重新加载，ESM 按 URL 缓存模块。想免重启试新代码，就把补丁里的行
  指向一个新文件名；否则重启 `dsh web`。
- `package.json` 里的 `dsh.bundle.patch` 或 profile 的 `bundles` 有改动：必须重启。

细节在 [docs/development.md](./docs/development.md)，内部结构在 [docs/architecture.md](./docs/architecture.md)。

## 许可

Apache-2.0，见 [LICENSE](./LICENSE)。
