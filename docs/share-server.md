# 分享服务（server，Next.js）合同与部署

链接分享在离线的 P2C1 分享码之上加了一层便利：上传码 → 拿到一个短链接 → 对方点开就是可读摘要 + 可复制的码。**串分享永远独立可用、永不过期；链接是附加工件，不是依赖。**

服务端是一个独立的 Next.js 应用（`server`），**一个部署同时提供 API 与 `/s/:id` 落地页**——落地页是服务端组件，直接查库渲染，没有客户端取数。存储走**可切换驱动**（`src/lib/store.ts` 接口 + `src/lib/drivers/` 实现），内置 `sqlite`（Node 自带 `node:sqlite`，零原生依赖）；统一接入宿主机已有的数据库时，加一个驱动文件 + 一行注册即可，API 与页面零改动。

## 现状（2026-09-25）

**已上线**：`https://cinaka.com/poe2/`（甲骨文 ARM 机器,nginx 反代 127.0.0.1:3000 + Certbot TLS,`SHARE_DB=mysql`——与 kids-english-server 同一个 MySQL 8,库名 `poe2coach_share`,凭证在服务器 `/opt/poe2coach-share/db.env`(0600)）。`desktop/src/shareLink.ts` 已回填 `SHARE_SERVER_PROD`,Tauri 白名单已加 `https://cinaka.com/*`。升级 = 服务器上重跑 from-git.sh 流程(见下)。

## HTTP 合同

所有 `/api/*` 响应带 `Access-Control-Allow-Origin: *` 与 OPTIONS 预检（桌面端走 Tauri 原生 HTTP 不需要 CORS，浏览器开发预览与测试需要）；错误统一 `{ok:false, error}`。

### `POST /api/share`

```json
{ "code": "P2C1.…", "summary": { "realm": "cn", "league": "…", "level": 90, "className": "Witch", "ascendClassName": null, "questPoints": 22, "passives": 108, "atlas": 76, "items": 9, "skills": 5 } }
```

- `code` 必须是合法 P2C1 码：服务端用 `P2C1.` 前缀 + zlib inflate + `v===1` 做卫生检查（**不是**信任边界——导入方照旧全量校验）。裸文本 body 也收（等价于只有 code），所以 curl 可直接调。
- `summary` 是展示用的衍生数据（分享面板已经在显示的同一份），服务端只做白名单和长度裁剪，不信任。
- 成功 `200 {ok:true, id, expiresAt}`；码非法 `400`；存储不可用 `500`。

### `GET /api/share/:id`

`200 {ok:true, code, summary, expiresAt}`；不存在或已过期 `404`。

读取会把 `expiresAt` 滑动续期一年——有人看的链接不会老死。当前版本不做自动 GC（单条 ~1KB，量级安全）；要做时按 `expires_at` 批删即可。

### `GET /api/healthz`

`200 {ok:true, now}`，部署验收用。

### `GET /s/:id`

落地页（服务端渲染）：摘要芯片、完整码 + 复制按钮、有效期、使用步骤。id 不存在走 Next 的 404 页。

## 存储与安全边界

- 驱动选择：环境变量 `SHARE_DB`（默认 `sqlite`）；`sqlite` 的数据文件 = `process.env.SHARE_DB_PATH ?? <cwd>/data/share.db`，表 `share`（`id` = 8 位 base62 短 id，主键冲突自动重试一次）。
- 新驱动（MySQL/PG/…）三步：实现 `ShareStore` 三方法 → `lib/db.ts` 注册 → 设 `SHARE_DB=<名字>`。三方法都是平凡 SQL，接口见 `src/lib/store.ts` 的注释。
- **码在格式层面不含凭证**（`ShareSnapshot` 没有这个字段，有单测守住），所以服务端无鉴权、无隐私包袱；落地页也照此口径声明。
- 服务端不回显任何请求头或运行环境变量。

## 客户端接线（部署后回填一处常量）

`desktop/src/shareLink.ts`：

```ts
export const SHARE_SERVER_PROD = ''   // ← 填服务端公网地址,如 https://share.example.com
```

同时把该域名追加进 `desktop/src-tauri/capabilities/default.json` 的 Tauri HTTP 白名单，重新打包桌面端。链接形状 = `<服务端>/s/<id>`，导入框两种都认（`/s/<id>` 与旧的 `/s/?i=`）。

开发/测试覆盖键：`localStorage['poe2coach.shareApiBase']`（设置页精简原则：诊断入口不进 UI）。

## 部署（甲骨文服务器）

**方式 A（推荐）：服务器直接拉 GitHub 代码**——在服务器上执行一条命令：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/chenhaolove89/poe2-build-coach/main/server/deploy/from-git.sh)
# 或先 clone 再跑: git clone https://github.com/chenhaolove89/poe2-build-coach && bash poe2-build-coach/server/deploy/from-git.sh
```

脚本幂等：重复执行即升级（拉最新 → 重构建 → 原子换位 → 重启），数据在 `/opt/poe2coach-share/data`，永不覆盖；上一版留在 `share-server.old` 作回滚。

**方式 B：本地打包上传**（服务器不方便构建时）：

```bash
node server/deploy/pack.mjs        # 构建并把 standalone 拍平打包 → server/deploy/dist/share-server.tar.gz
cp server/deploy/deploy.sh.example server/deploy/deploy.sh   # 填 HOST/USER/KEY
bash server/deploy/deploy.sh       # 上传 + 解包到 /opt/poe2coach-share + 装 systemd 单元 + 重启 + 验收
```

两种方式共同的收尾：

- `deploy.sh.example` 是可读的骨架：五步各自一行 ssh/scp，拿到的部署流程如果不同，照着改那五行即可。
- `poe2coach-share.service` 随包附带：WorkingDirectory、`SHARE_DB`、`SHARE_DB_PATH` 都在单元里改；Node 路径按服务器实际安装调（node:sqlite 需要 Node 22+）。
- 公网入口：反向代理（nginx/caddy）把 80/443 转到 127.0.0.1:3000 并终止 TLS；云安全组/iptables 放行对应端口。
- 上线验收：`curl https://<host>/api/healthz` → 回填 `SHARE_SERVER_PROD` + Tauri 白名单 → 重打包桌面端。
- 包内自检过的行为：healthz 200、垃圾码 400、无效 id 落地页 404。
- 备份 = 备份数据文件（sqlite 就是那个 .db）。

## 本地端到端（已验证的路径）

```bash
cd server && npm run dev        # 或 build + start,默认 3000
# 桌面端浏览器预览:localStorage['poe2coach.shareApiBase'] = 'http://127.0.0.1:3000'
```

全链路：生成链接 → 打开 `/s/<id>` 看到摘要与码 → 复制码粘回主页导入 → 链接直接粘进两处导入框均可还原。
