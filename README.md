# PoE2 Build Coach

跟着 Build 走,不再翻文档。粘贴 Path of Building(PoE2)分享码,即刻得到这份 Build 的天赋目标点法、装备词缀清单与宝石配置 —— 纯离线桌面工具。

> 定位:PoE2 Build 的"跟随式教练"。别人给你 Build,我给你"现在第一步干什么"。
> 不重造 PoB2 的计算引擎,做它没做的执行层。

## 功能(M0)

- **PoB 分享码解析**:粘贴分享码 → 职业 / 升华 / 等级 / 天赋节点 / 技能组 / 装备全量提取
- **天赋树可视化**:0.5 版全树 Canvas 渲染(4900+ 节点),目标节点金色高亮
- 滚轮缩放 · 拖拽平移 · 双击复位 · 节点悬停显示词缀
- 内置示例(从真实树生成,用于演示闭环)

## 服务器(设置页)

游戏分三个独立交易站,每个站的客户端只用自己那一种语言写物品文本,所以"粘贴的装备"必须和所在服的词缀模板对上才能查出价格:

| 选项 | 交易站 | 客户端语言 | 界面语言 | 匿名查询 |
| --- | --- | --- | --- | --- |
| 国际服 | `www.pathofexile.com/api/trade2` | English | 繁體 | 可以 |
| 国服 | `poe.game.qq.com/api/trade2` | 简体中文 | 简体 | **需登录** |
| 台服 | `pathofexile.tw/api/trade2` | 繁體中文 | 繁體 | 可以 |

**界面语言不单独设置,跟着服务器走。** 简体只在腾讯客户端存在;国际服客户端自带的是繁体而不是简体,所以国际服读繁体,而不是退回英文。这样只有一个开关,两者不会出现"用 A 服的模板匹配、界面上却显示 B 服字型"这种不一致。

- **国服**:数据接口(联赛、词缀模板、通货名)公开,但 `/search` 未登录会返回 401。在设置页点**关联登录**,会在一个独立窗口里打开腾讯官方登录页,用 QQ / 微信登录后自动取回会话 Cookie —— 和查价器常见的做法一致。账号密码只填在腾讯那一页,本工具不会接触;读到的只是登录后的 `POESESSID`,只存本机、只发给 `poe.game.qq.com`,仅用于只读查询。也可以手动粘贴(浏览器 F12 → Cookies)。不填也能做本地词缀匹配。
- **国服 / 台服是两套独立本地化**,不是简繁字型差异:同一件装备国服叫「引路石」、台服叫「換界石」,词缀语序也不同(`火焰抗性 #%` vs `#%火焰抗性`)。所以两套模板各自从本服接口抓取,而不是从国际服转换。

国际服为 Grinding Gear Games,国服为腾讯,台服为熱酷科技(接替 Garena 代理台港澳)。三者的交易站是各自独立的服务,联赛与物价互不相通。

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

### 天赋树美术

`packages/data/tree-art/` 里是节点图标、边框、连线、底部圆盘五张图集(约 1.4MB)以及两个派生索引,**取自 GGG 官方发布的 [poe2-skilltree-export](https://github.com/grindinggear/poe2-skilltree-export)**。官方开发者文档写明游戏内数据一概不提供、「唯一例外是天赋树」,所以这是第一方来源,不是逆向或第三方镜像。

**美术版权归 Grinding Gear Games 所有**,按 GGG 第三方工具政策在非商业粉丝工具中分发:本应用免费、不使用其素材制作其他游戏、不与游戏进程或游戏文件交互。界面上标注了版权,本仓库亦不主张对这些素材的任何权利。

`index.json` 把每个节点在树里的 `icon` 路径预先解析成图集矩形(图集是 0.5 倍存的,绘制尺寸由脚本换算好,升华节点另带底衬 Backing),`geometry.json` 是官方节点的绝对坐标与官方连线表 —— 渲染用的是这套坐标,因为它和美术同一坐标系,而 `packages/core` 里由 group+orbit 推算的坐标不是(同一个 group 在两边相差一个平移加缩放)。逻辑层不读坐标:`buildLevelingPlan` 只走连接图的 BFS,`resolveStartNode` 只读 `classesStart`。

**升华树在主树正中**:官方数据把 22 个升华簇摆在主树外约 17000 单位处,任何可用倍率下都在画面外;而主树是环形的、正中间空着(洞半径 1322),所以选中升华后被重投影到中心,并**等比缩放**到洞内 —— 22 个簇里有 13 个按原始尺寸放不进洞(最大的 Pathfinder 超 43%),等比缩放同时缩坐标与节点尺寸,保持簇内间距比例不变,因此不会互相压到。未选中的升华簇不绘制。

重新抓取(GGG 更新天赋树后):

```bash
node scripts/fetch-tree-assets.mjs --write
```

覆盖情况:显著天赋 1193/1193、核心天赋 33/33、升华 222/222、普通节点 3097/3466。未命中的 369 个是 `Mastery*` 占位图标,它们的专属美术在另一套 `mastery-effect` 图集里(约 640KB),本版本没有打包,所以这些节点画成空边框 —— 需要的话再加。

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
