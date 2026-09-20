# 开发

面向想改这个插件的人。核心是**搞清楚"改了代码怎么让它生效"**——DSH 的插件重载语义有几处必须记住的坑。

## 仓库结构

```
.
├── src/
│   ├── index.ts            # host 半边源码（Cordis 插件）
│   ├── client.ts           # client 半边源码（被打成单文件 bundle）
│   ├── endpoints.ts        # 远程面的单一来源（方法名 / 包名 / 服务名）
│   ├── remote.ts           # ⚙ 生成物：客户端 $mount 的描述符清单，勿手改
│   └── typert.ts           # ⚙ 生成物：同一份面的清单对象，勿手改
├── lib/                    # ⚙ 构建产物，不进 git（.gitignore），由 npm run build 产出
├── test/personas.test.mjs      # 宿主：196 项断言（纯函数 + 源码审计 + 用真实 ctx 驱动的 apply）
├── test/client-helpers.test.mjs # 客户端：116 项断言（源码审计）+ 生成产物漂移校验
├── scripts/generate-remote.mjs # 生成器：endpoints.ts → remote.ts / typert.ts
├── scripts/install.sh|.ps1     # 安装到某个 profile
├── docs/                   # 架构 / 开发 / 设计决策
├── cordis.patch.yml        # bundle patch：插入 loader 行
├── tsconfig.json           # host（tsc → lib/）
├── tsconfig.client.json    # client（只做类型检查，产出交给 esbuild）
└── package.json            # main / exports / dsh.bundle.patch / dsh.client
```

```bash
npm install
npm run build         # generate:remote → tsc → esbuild（产出 lib/）
npm run typecheck     # 两个 tsconfig 都不报错
npm test              # 196 + 116 条断言，最后一步校验生成产物没有漂移
npm run generate:remote   # 只重新生成 src/remote.ts 与 src/typert.ts
```

**容器里千万不要手改生成产物**：改 `src/endpoints.ts`（加一个方法就加一个名字）后跑 `npm run generate:remote`；
`npm test` 会重新生成并比对，不一致直接失败。同理，`lib/` 里的任何文件都不是源码。

## 本地开发接线（免重启迭代）

官方接线（包自带 `dsh.bundle.patch`）在安装时是**一次到位**的，但 `dsh.profile.bundles` 只在
**启动时**读取——所以用官方接线调试时，改代码＝重启。想免重启迭代，用**用户补丁层手写一行**：

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: agent-persona
      name: './dsh-agent-persona/lib/index.js'   # 相对路径，指向本仓库的构建产物
```

`patchReload: live` 会监听这个文件：**改这个 patch 文件的内容**会立即重放。

> ⚠️ **两者只能选一个**：手写 `insert` 的同时，包又声明 `dsh.bundle.patch`，一旦有任何 `dsh plugin`
> 操作把包加进 `bundles`，同一个 id 就会被插两次 → 组合无法启动：
> `duplicate loader entry id "agent-persona" (2 rows)`。
> 用开发接线时，把 `package.json` 里的 `dsh.bundle` 去掉（发布时再加回来）。

## 重载语义（实测）

| 你改了什么 | 结果 |
|---|---|
| profile 的 `cordis.patch.yml` **内容** | ✅ 立即重放（`patchReload: live` 只 watch patch 文件） |
| **`src/**` 源码** | ⚠️ 先 `npm run build`，否则改动根本没进 `lib/` |
| `lib/index.js`（host 产物）的**内容** | ❌ **不会**重新 import —— ESM 模块按 URL 缓存，需要**重启** `dsh web` |
| host 换一个**新文件名** + patch 指向它 | ✅ 新 URL 会重新 import |
| `lib/client.js`（client 产物）的**内容** | ✅ 客户端产物会重算（刷新页面即可） |
| `exports['./client']` 指向**新文件** / 换文件名 | ❌ client-modules 的 compose 缓存按**它已解析的产物路径**取 stamp，不会重算 |
| `package.json` 的 `dsh.bundle.patch` 或 `bundles` | 需要**重启** `dsh web` |
| 打开 dsh-base 的 `id: hmr` 行（`root` 指到本目录） | ❌ 这里实测**没有**生效（改文件后模块未重载），所以本项目不依赖它 |

判断"到底哪份代码在跑"：看加载心跳 `$DSH_HOME/dsh-agent-persona/state.json` 的 `loadedModule` 与 `loadedAt`
（`loadedModule` 会写全路径，所以能看出加载的是开发目录还是 npm 装下来的那份）。

## 组合自检（不启动服务器）

```bash
dsh --profile web --dump-config | grep -c 'id: agent-persona'   # 期望 1
```

`--dump-config` 只打印组合后的树，**它不做重复 id 校验**，所以重复问题要用静态扫描发现：
把 `dsh.profile.bundles` 里每个包的 `dsh.bundle.patch` 与用户层一起数 `insert` 的 id，看有没有重复。
（扫 YAML 时给 pyyaml 注册 `tag:yaml.org,2002:js` 的宽容构造器——生态里有插件用 `!!js`。）

## 调试

- **host 半边**：日志走宿主 logger，前缀 `[agent-persona]`（在启动 `dsh web` 的终端里看）。
  加载成功会打印 section 注册与远程命名空间注册两行。
- **client 半边**：浏览器 devtools。页面组件抛错会被 slot 的错误边界**永久退位**（格子变成
  `data-slot-error`），只在 console 里留一行 `slot entry crashed in 'settings.section':`。
  所以 `render()` 里包了一层 try/catch 把异常渲染成可见文案，而不是让它冒泡。
  排查时给组件挂 `window.*` 诊断变量是最快的办法（本项目历史上就这么定位到"props 是 undefined"与
  "remote 未挂载"两类问题）。
- **远程调用**：返回值是信封。页面里可以直接 `ctx.get('remote.agentPersona').listPersonas()`；
  或在 devtools 里看 `{ ok: false, error: { code: 'gateway/internal' } }`——`gateway/internal` 表示
  host 方法抛了异常，真实原因要看 host 日志或让方法把错误当数据返回。
- **`$mount` 相关**：描述符清单的 `service` / `namespace` 必须是宿主注册的服务名 `agentPersona`
  （不是包名），每条描述符要带 `id`，入参 codec 必须是 `mode: 'strict'`。填错的表现很隐蔽：
  **页面照常渲染，但每一次读取都永远挂起、且不报任何错**。`test/client-helpers.test.mjs` 有一条断言
  把这三个字段钉在 `src/endpoints.ts` 与 `src/index.ts` 上。

## 提交前

```bash
npm run typecheck && npm run build && npm test
git status --porcelain      # 应为空
```

如果要改 `package.json` 的依赖/导出，记得同步 `docs/architecture.md` 里的契约表；
如果远程面有增减，记得同步 `README.md` / `README_EN.md` 的功能清单（README 里不允许出现代码里没有的功能，
也不允许代码里有而 README 没写的功能——`npm test` 的断言覆盖了其中一部分）。
