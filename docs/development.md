# 开发

面向想改这个插件的人。核心是**搞清楚"改了代码怎么让它生效"**——DSH 的插件重载语义有几处必须记住的坑。

## 仓库结构

```
.
├── lib/
│   ├── index.js            # host 半边（就是源码，没有构建产物）
│   └── client.js           # client 半边（手写 __ModuleLoader__ 模块）
├── test/personas.test.mjs  # 40 项断言，只用 node 内置模块
├── scripts/install.sh      # 安装到某个 profile（Bash）
├── scripts/install.ps1     # 同上（PowerShell）
├── docs/                   # 架构 / 开发 / 设计决策
├── cordis.patch.yml        # bundle patch：插入 loader 行
└── package.json            # main / exports / dsh.bundle.patch / dsh.client
```

```bash
npm test        # node test/personas.test.mjs —— 匹配引擎、迁移、注入、心跳
npm run check   # 两个半边的 node --check
```

## 本地开发接线（免重启迭代）

官方接线（包自带 `dsh.bundle.patch`）在安装时是**一次到位**的，但 `dsh.profile.bundles` 只在
**启动时**读取——所以用官方接线调试时，改代码＝重启。想免重启迭代，用**用户补丁层手写一行**：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: workspace-persona
      name: './dsh-workspace-persona/lib/index.js'   # 相对路径，指向本仓库的文件
```

`patchReload: live` 会监听这个文件：**改这个 patch 文件的内容**会立即重放。

> ⚠️ **两者只能选一个**：手写 `insert` 的同时，包又声明 `dsh.bundle.patch`，一旦有任何 `dsh plugin`
> 操作把包加进 `bundles`，同一个 id 就会被插两次 → 组合无法启动：
> `duplicate loader entry id "workspace-persona" (2 rows)`。
> 用开发接线时，把 `package.json` 里的 `dsh.bundle` 去掉（发布时再加回来）。

## 重载语义（实测）

| 你改了什么 | 结果 |
|---|---|
| profile 的 `cordis.patch.yml` **内容** | ✅ 立即重放（`patchReload: live` 只 watch patch 文件） |
| `lib/index.js`（host）的**内容** | ❌ **不会**重新 import —— ESM 模块按 URL 缓存 |
| host 换一个**新文件名** + patch 指向它 | ✅ 新 URL 会重新 import |
| `lib/client.js` 的**内容** | ✅ 客户端产物会重算（刷新页面即可） |
| `exports['./client']` 指向**新文件** / 换文件名 | ❌ client-modules 的 compose 缓存按**它已解析的产物路径**取 stamp，不会重算 |
| `package.json` 的 `dsh.bundle.patch` 或 `bundles` | 需要**重启** `dsh web` |
| 打开 dsh-base 的 `id: hmr` 行（`root` 指到本目录） | ❌ 这里实测**没有**生效（改文件后模块未重载），所以本项目不依赖它 |

判断"到底哪份代码在跑"：看加载心跳 `$DSH_HOME/workspace-persona.state.json` 的 `module` 与 `loadedAt`。

## 组合自检（不启动服务器）

```bash
dsh --profile web --dump-config | grep -c 'id: workspace-persona'   # 期望 1
```

`--dump-config` 只打印组合后的树，**它不做重复 id 校验**，所以重复问题要用静态扫描发现：
把 `dsh.profile.bundles` 里每个包的 `dsh.bundle.patch` 与用户层一起数 `insert` 的 id，看有没有重复。
（扫 YAML 时给 pyyaml 注册 `tag:yaml.org,2002:js` 的宽容构造器——生态里有插件用 `!!js`。）

## 调试

- **host 半边**：日志走宿主 logger，前缀 `[workspace-persona]`（在启动 `dsh web` 的终端里看）。
  加载成功会打印 section 注册与远程命名空间注册两行。
- **client 半边**：浏览器 devtools。页面组件抛错会被 slot 的错误边界**永久退位**（格子变成
  `data-slot-error`），只在 console 里留一行 `slot entry crashed in 'settings.section':`。
  所以 `render()` 里包了一层 try/catch 把异常渲染成可见文案，而不是让它冒泡。
  排查时给组件挂 `window.*` 诊断变量是最快的办法（本项目历史上就这么定位到"props 是 undefined"和
  "remote 未挂载"两类问题）。
- **远程调用**：返回值是信封。页面里可以直接 `ctx.get('remote.workspacePersona').listPersonas()`；
  或在 devtools 里看 `{ ok: false, error: { code: 'gateway/internal' } }`——`gateway/internal` 表示
  host 方法抛了异常，真实原因要看 host 日志或让方法把错误当数据返回。

## 提交前

```bash
npm run check && npm test
git status --porcelain      # 应为空
```

如果要改 `package.json` 的依赖/导出，记得同步 `docs/architecture.md` 里的契约表。
