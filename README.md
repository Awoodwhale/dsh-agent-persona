# dsh-workspace-persona

给 [DSH](https://www.deepseek.com/harness/) 加一层"人设"：每个工作区、甚至每条会话，都能有自己的一套
system prompt。人设文件放在工作区外面，工作区里的对话改不到它。

[![npm](https://img.shields.io/npm/v/dsh-workspace-persona)](https://www.npmjs.com/package/dsh-workspace-persona)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![ci](https://github.com/awoodwhale/dsh-workspace-persona/actions/workflows/ci.yml/badge.svg)](https://github.com/awoodwhale/dsh-workspace-persona/actions/workflows/ci.yml)

[English](./README_EN.md)

## 为什么写这个

一开始只是想把如流里的机器人接到 DSH 上，让它有个固定人设。

最直接的做法是往工作区的 `AGENTS.md` 里写。试了之后发现两个问题：`AGENTS.md` 就是工作区里的一个普通文件，
任何能读这个目录的会话都能顺手改掉它；而且它只按目录生效，区不出"这条会话是从如流来的"还是"从 Web 来的"。

所以换了个位置放：人设存在工作区外面，按会话的工作目录和会话 ID 投递，写进 **system prompt**。
DSH 在这件事上是帮你的——工作区指令（`AGENTS.md`）会被 `dsh-agent-instructions` 变成一条 **user 角色**的消息，
它自己带的导语就写着 *"They do not override system, developer, or direct user instructions."*。
而这里注入的是 system prompt 的一个 section（order 1，紧跟在身份行后面）。这个先后关系是框架定的，
不是插件自己声明的。

## 装

```bash
dsh plugin --profile web add dsh-workspace-persona
```

装完要**重启一次 `dsh web`**：DSH 的 profile bundles 只在启动时读取，插件行是从那里挂进去的。

重启后能看到：

- 侧边栏 **设置 → 工作区人设**；
- `cat ~/.dsh/dsh-workspace-persona/state.json`，这是插件的加载心跳（写明了实际加载的是哪个文件）。

仓库里也有个脚本，图省事可以用：`bash scripts/install.sh`（Windows 是 `scripts/install.ps1`）。

## 怎么用

设置页大概长这样：

![人设列表](./docs/images/settings-list.png)

点 **新建人设**，给它填适用范围，然后打开「启用」，保存。

- **新建出来的人设默认是停用的**。多一份人设不会影响任何现有会话，配好了再开。
- **适用范围**可以写多条，每条是 `[工作区目录 | 会话 ID]` + `[精确 | 前缀 | 正则 | 包含]` + 值。
  同一条人设里的多条规则是「或」。
- **顺序就是优先级**：卡片右边的 `↑ ↓` 调顺序，自上而下第一个命中的生效。
- **没填规则的人设是兜底**，放在列表最后最合适。反过来，如果你想让某个地方"就是不要人设"，
  写一条命中它的规则、正文留空就行——留空的人设一旦命中，表示这里不注入任何人设。
- **命中测试**在页面底部：填一个 cwd 和/或会话 ID，由宿主真的算一遍，告诉你命中谁、是哪条规则命中的、
  有没有因为正文为空被静默、跳过了几个人设。省得靠猜。
- **AI 调优**只出建议稿，点「采用」或「追加」才会进编辑框，再点保存才落盘。它不会自己保存。

展开一张卡之后是这样：

![展开编辑](./docs/images/settings-editor.png)

## 匹配是怎么算的

宿主在每次组装 system prompt 的时候按这个顺序试：

1. 人设停用了 → 跳过；
2. 按列表顺序看，只要该人设的**任意一条**规则命中，它就是赢家；
3. 没写规则的人设是兜底，命中所有还没被认领的会话；
4. 赢家正文是空的 → 什么都不注入；
5. 全都没命中 → 这个 section 渲染为空，被丢掉，会话用它原本的 DSH system prompt。

四种匹配方式里，只有 `exact` 会把路径归一化（所以 `/a/project/` 和 `/a/project` 算同一个）；
`prefix`、`contains`、`regex` 都是拿你写的字符串直接比——不然 `contains "my-project"` 这种写法就没法用了。
匹配值空着、正则写错了、或者会话没有那个字段，都当成"不命中"，不会报错。

## 文件放在哪

都在这一个目录里：

```
~/.dsh/dsh-workspace-persona/
├── personas.json   # 人设数据，权限 600，原子写入
└── state.json      # 加载心跳，每次加载时重写
```

人设正文里可以写 `{{model}}` 和 `{{cwd}}`，会在渲染时替换成当前的值。其他 `{{...}}` 会被去掉——
未注册的变量会让整个组装抛错，所以这里做了一层保护。

数据文件是**每次组装时按 mtime 重读**的，所以改完下一个请求就生效，不用重启。

> 更早的开发版本里这两个文件散在 `~/.dsh/` 根下（`workspace-personas.json`、`workspace-persona.state.json`）。
> 新版本第一次加载时会把数据搬进上面的目录，旧文件改名成 `personas.legacy.bak.json` 留个底。

## 想固定调优用哪个模型

默认会去问宿主的 `agentDefaultModel`。如果你想让这个部署固定用某个模型，在 profile 的用户补丁层覆盖这一行
（**不要**再 insert 一次）：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- id: workspace-persona
  config:
    tuneProvider: your-provider
    tuneModel: your-model-id
```

同一行里还能用 `storePath` 换人设文件的存放位置。

## 几句实话

- **人设是行为约束，不是安全边界**。它约束模型怎么说，不阻止模型用工具。
- `personas.json` 就是个**普通文件**，任何有文件工具权限的会话都写得动它。这个插件**没有**注册
  `tools.guard`，所以如果你真的需要"工作区里的会话改不动人设"，得在本机层面想办法：
  `chmod 400` + 换个属主，或者干脆把 DSH 跑在受限沙箱里。
- AI 调优得有个能用的模型，找不到会明确报错，不会静默失败。
- 规则是线性扫的，几十条没问题，多到几百条就该重新设计了。
- 多条规则同时命中时**只取第一条**，不拼接。（拼接方案当初考虑过，因为不好预测、不好调，放弃了；
  记在 [docs/plans](./docs/plans/2026-09-17-v2-multi-persona.md) 里。）
- 一个 profile 里只装一次。同一个进程挂两个同 id 的行会让组合起不来。

## 开发

```
lib/index.js      host 半边：存储、匹配、section、远程服务（就是源码，没有构建产物）
lib/client.js     client 半边：设置页，手写的 __ModuleLoader__ 模块
test/             48 条断言，只用 Node 内置模块
docs/             架构、开发笔记、设计决策
scripts/          安装脚本
```

```bash
npm test        # 跑断言
npm run check   # 两个半边的语法检查
dsh --profile web --dump-config | grep -c 'id: workspace-persona'   # 组合自检，应该输出 1
```

改代码之后怎么让它生效，有几个坑值得先看一眼：

- `lib/client.js` 改**内容**：客户端产物会重算，刷新页面就行。但别改文件名——换个名字它不会重算。
- `lib/index.js` 改**内容**：**不会**重新加载，ESM 按 URL 缓存模块。想免重启试新代码，就把 patch 的行
  指向一个新文件名；否则重启 `dsh web`。
- `package.json` 里的 `dsh.bundle.patch` 或 profile 的 `bundles` 有改动：必须重启。

细节写在 [docs/development.md](./docs/development.md)，内部结构在 [docs/architecture.md](./docs/architecture.md)。

## 许可

Apache-2.0，见 [LICENSE](./LICENSE)。
