#!/usr/bin/env bash
# 在甲骨文服务器上执行的一键部署：拉 GitHub 代码 → 构建 → 安装 → 重启 → 验收。
#
#   bash from-git.sh                       # 默认仓库与 /opt/poe2coach
#   bash from-git.sh <repo> <安装根目录>    # 都可改
#
# 前置：git + Node 22+（node:sqlite 硬要求）；写 /opt 需 sudo（Oracle Ubuntu 默认免密 sudo）。
# 幂等：重复执行就是升级——数据在 /opt/poe2coach-share/data，永不覆盖。
set -euo pipefail

REPO="${1:-https://github.com/chenhaolove89/poe2-build-coach.git}"
ROOT="${2:-/opt/poe2coach}"
SRC="$ROOT/repo"
APP="/opt/poe2coach-share"
SERVICE="poe2coach-share"
BRANCH="main"

echo "== 0/5 环境 =="
command -v git >/dev/null || { echo "缺 git"; exit 1; }
command -v node >/dev/null || { echo "缺 node —— 安装 Node 22+ 后重跑（node:sqlite 硬要求）"; exit 1; }
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 22 ] || { echo "Node $(node --version) 太旧，node:sqlite 需要 22+"; exit 1; }
node --version

echo "== 1/5 拉代码 =="
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch origin "$BRANCH"
  git -C "$SRC" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$SRC"
fi

echo "== 2/5 安装依赖 + 构建（npm workspaces 全仓；小内存机型构建慢属正常）=="
cd "$SRC"
npm ci --no-audit --no-fund
node server/deploy/pack.mjs

echo "== 3/5 安装到 $APP（数据目录独立在外，升级不碰数据）=="
sudo mkdir -p "$APP"
sudo rm -rf "$APP/share-server.new"
sudo cp -r "$SRC/server/deploy/dist/share-server" "$APP/share-server.new"
sudo chown -R "$(id -un):" "$APP/share-server.new"
if [ -d "$APP/share-server" ]; then
  sudo rm -rf "$APP/share-server.old"
  sudo mv "$APP/share-server" "$APP/share-server.old"   # 保留一份作回滚
fi
sudo mv "$APP/share-server.new" "$APP/share-server"
mkdir -p "$APP/data"

echo "== 4/5 systemd =="
sudo cp "$APP/share-server/poe2coach-share.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE"
sudo systemctl restart "$SERVICE"

echo "== 5/5 验收 =="
sleep 2
curl -s "http://127.0.0.1:3000/api/healthz"
echo
sudo systemctl --no-pager -l status "$SERVICE" | head -5
echo
echo "完成。剩余一步（服务器上已有 nginx 的话照抄一段）："
echo "  反向代理把 80/443 的路径或子域转发到 127.0.0.1:3000，并放行云安全组端口。"
echo "  回滚：sudo mv $APP/share-server $APP/share-server.broken && sudo mv $APP/share-server.old $APP/share-server && sudo systemctl restart $SERVICE"
