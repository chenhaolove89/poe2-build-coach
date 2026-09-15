# PoE2 Build Coach

跟着 Build 走,不再翻文档。粘贴 Path of Building(PoE2)分享码,即刻得到这份 Build 的天赋目标点法、装备词缀清单与宝石配置 —— 纯离线桌面工具。

> 定位:PoE2 Build 的"跟随式教练"。别人给你 Build,我给你"现在第一步干什么"。
> 不重造 PoB2 的计算引擎,做它没做的执行层。

## 功能(M0)

- **PoB 分享码解析**:粘贴分享码 → 职业 / 升华 / 等级 / 天赋节点 / 技能组 / 装备全量提取
- **天赋树可视化**:0.5 版全树 Canvas 渲染(4900+ 节点),目标节点金色高亮
- 滚轮缩放 · 拖拽平移 · 双击复位 · 节点悬停显示词缀
- 内置示例(从真实树生成,用于演示闭环)

## 服务器与语言(设置页)

游戏分三个独立交易站,每个站的客户端只用自己那一种语言写物品文本,所以"粘贴的装备"必须和所在服的词缀模板对上才能查出价格:

| 选项 | 交易站 | 客户端语言 | 匿名查询 |
| --- | --- | --- | --- |
| 国际服 | `www.pathofexile.com/api/trade2` | English | 可以 |
| 国服 | `poe.game.qq.com/api/trade2` | 简体中文 | **需登录** |
| 台服 | `pathofexile.tw/api/trade2` | 繁體中文 | 可以 |

- **国服**:数据接口(联赛、词缀模板、通货名)公开,但 `/search` 未登录会返回 401。在设置页点**关联登录**,会在一个独立窗口里打开腾讯官方登录页,用 QQ / 微信登录后自动取回会话 Cookie —— 和查价器常见的做法一致。账号密码只填在腾讯那一页,本工具不会接触;读到的只是登录后的 `POESESSID`,只存本机、只发给 `poe.game.qq.com`,仅用于只读查询。也可以手动粘贴(浏览器 F12 → Cookies)。不填也能做本地词缀匹配。
- **语言**:界面语言(简体/繁体)与服务器互相独立 —— 国服玩家可以读繁体,台服玩家可以读简体。简体↔繁体是**字符转换**,不是重新本地化:国服叫「引路石」、台服叫「換界石」,这类用词差异来自各服自己的数据。

台服与国服都由当地代理商运营(国服腾讯,台服熱酷科技),国际服为 Grinding Gear Games。三者的交易站是各自独立的服务,联赛与物价互不相通。

## 架构

```
packages/core    纯 TS 业务核心(零环境依赖):PoB 码编解码/解析、天赋树几何、物品解析、查价查询构造、简繁转换
packages/data    版本锁定的游戏数据包(tree.json 来自 PoB2 MIT;三服词缀模板、通货名、简繁对照表由 scripts 生成)
apps/desktop     Tauri 2 + Vue 3 桌面端
apps/website     GitHub Pages 下载页(纯静态)
```

核心纪律:**业务逻辑只进 core,两端复用**;未来网页版就是 core + Vue 视图。

## 开发

```bash
npm install
npm test                # core 单测(vitest)
npm run dev             # 桌面前端 vite dev(浏览器可直接调 UI)
npm run build           # core 类型检查 + 前端构建
```

桌面壳(Rust 未装时跳过,装好后即可运行):

```bash
# 安装 Rust:https://rustup.rs (需要 MSVC Build Tools)
cd apps/desktop
npm run tauri dev       # 开发运行
npm run tauri build     # 产出安装包(src-tauri/target/release/bundle/)
```

本地打包推荐用 `scripts\build-tauri.bat`,它在 `npm run tauri build` 外面套好了两件必须做的事:

- **构建前强制关掉正在运行的旧版本**。运行中的 `poe2-build-coach.exe` 会锁住 `target\release` 里的同名文件,cargo 链接时会直接失败(`failed to remove file ...: 拒绝访问 (os error 5)`)。脚本会等文件真的能删掉再继续,删不掉就报明确的错,而不是让 cargo 抛出难懂的 access denied。
- **构建成功后自动启动新版本**;只要安装包不启动,加 `--no-start`。

```bash
scripts\build-tauri.bat             # 关闭旧的 → 构建 → 启动新的
scripts\build-tauri.bat --no-start  # 只出安装包
```

CI 里不要用这个脚本(那里没有桌面、也没有实例要关);release 工作流直接调 `npx tauri build`。

## 发布流程

1. **下载页**:推送到 `main` 后 GitHub Actions 自动把 `apps/website` 部署到 Pages(仓库 Settings → Pages → Source 选 GitHub Actions)。
2. **安装包**:打 tag 推送即自动构建并上传到 Release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

下载页的"下载 Windows 版"按钮固定指向 Releases latest。

## 数据来源与更新

- 天赋树:`packages/data/trees/0_5/tree.json`,取自 [PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)(MIT License)。
- 版本升级(如 12 月 1.0):下载新版 `TreeData/<ver>/tree.json` 放入 `packages/data/trees/<ver>/`,`apps/desktop/src/treeData.ts` 指向新版本即可。

三个服的词缀模板与通货名重新抓取(联赛更新后跑一次):

```bash
node scripts/fetch-trade-data.mjs --write          # 全部三个服
node scripts/fetch-trade-data.mjs --realm cn --write   # 只更新国服
```

简繁对照表重新生成(需要网络拉取 OpenCC 词典,结果缓存于 `.tmp/opencc/`):

```bash
node scripts/build-zh-variant.mjs --write
```

两个脚本都会把语料里用不到的条目裁掉(词缀模板只留 explicit/implicit/fractured/crafted/enchant/rune/desecrated;简繁词组表只留本工具会显示的词),输出都是确定性的 —— 重跑不会产生无意义的 diff。

## 红线

不读内存、不注入、不发按键、不碰封包。只做离线规划与对照;官方接口只读(交易站搜索/取回挂单),不登录游戏账号、不进行任何交易或上架操作。国服关联登录在独立窗口里加载运营商自己的登录页,本工具不接触账号密码,只读取登录后的会话 Cookie,且只发给该服。国服数据来源为腾讯;国际服为 Grinding Gear Games,台服为熱酷科技。

## 免责声明

本工具为社区粉丝作品,与 Grinding Gear Games 无关。Path of Exile 及相关标识是 Grinding Gear Games 的商标。
