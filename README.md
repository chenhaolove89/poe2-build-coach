# PoE2 Build Coach

跟着 Build 走,不再翻文档。粘贴 Path of Building(PoE2)分享码,即刻得到这份 Build 的天赋目标点法、装备词缀清单与宝石配置 —— 纯离线桌面工具。

> 定位:PoE2 Build 的"跟随式教练"。别人给你 Build,我给你"现在第一步干什么"。
> 不重造 PoB2 的计算引擎,做它没做的执行层。

## 功能(M0)

- **PoB 分享码解析**:粘贴分享码 → 职业 / 升华 / 等级 / 天赋节点 / 技能组 / 装备全量提取
- **天赋树可视化**:0.5 版全树 Canvas 渲染(4900+ 节点),目标节点金色高亮
- 滚轮缩放 · 拖拽平移 · 双击复位 · 节点悬停显示词缀
- 内置示例(从真实树生成,用于演示闭环)

## 架构

```
packages/core    纯 TS 业务核心(零环境依赖):PoB 码编解码/解析、天赋树几何、(后续)diff 引擎
packages/data    版本锁定的游戏数据包(tree.json,来自 PoB2,MIT)
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

## 红线

不读内存、不注入、不发按键、不碰封包。只做离线规划与对照;官方接口(未来角色导入)仅走 OAuth 只读。

## 免责声明

本工具为社区粉丝作品,与 Grinding Gear Games 无关。Path of Exile 及相关标识是 Grinding Gear Games 的商标。
