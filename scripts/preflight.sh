#!/bin/sh
# 家庭看板 —— NAS 部署前置检查
# 用法：sh scripts/preflight.sh
# 只读检查，不会改动任何东西。

set -u
ok=0
bad=0

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; ok=$((ok + 1)); }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; bad=$((bad + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

echo ""
echo "===== 1. 运行环境 ====="
if command -v docker >/dev/null 2>&1; then
  pass "docker $(docker --version 2>/dev/null | awk '{print $3}' | tr -d ',')"
else
  fail "找不到 docker 命令"
fi

if docker compose version >/dev/null 2>&1; then
  pass "docker compose $(docker compose version --short 2>/dev/null)"
else
  fail "docker compose 不可用（旧版是 docker-compose）"
fi

arch=$(uname -m)
case "$arch" in
  x86_64 | aarch64) pass "架构 $arch" ;;
  *) warn "架构 $arch —— Node 22 官方镜像可能不支持，构建会失败" ;;
esac

echo ""
echo "===== 2. 网络连通性 ====="
check_url() {
  if curl -m 8 -sI "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi
}
check_url "DaoCloud 镜像站（构建基础镜像用）" "https://docker.m.daocloud.io/v2/"
check_url "1ms 镜像站（备用）" "https://docker.1ms.run/v2/"
check_url "npm 官方源" "https://registry.npmjs.org/"
if curl -m 8 -sI "https://registry-1.docker.io/v2/" >/dev/null 2>&1; then
  pass "Docker Hub（可推可拉）"
else
  warn "Docker Hub 连不上 —— 推 Docker Hub 会失败，属正常；构建不受影响"
fi

echo ""
echo "===== 3. 配置 ====="
if [ -f .env ]; then
  pass ".env 存在"
  base=$(grep -E '^[[:space:]]*BASE_IMAGE=' .env | tail -1 | cut -d= -f2-)
  case "$base" in
    "") pass "BASE_IMAGE 未覆盖 → 使用 compose 默认（DaoCloud 镜像站）" ;;
    *daocloud* | *1ms.run*) pass "BASE_IMAGE=$base" ;;
    node:*) fail "BASE_IMAGE=$base —— 走 Docker Hub 会超时，改成镜像站地址" ;;
    *) warn "BASE_IMAGE=$base —— 确认这个地址能访问" ;;
  esac
  data_dir=$(grep -E '^[[:space:]]*DATA_DIR_HOST=' .env | tail -1 | cut -d= -f2-)
  [ -n "${data_dir:-}" ] && echo "  数据目录：$data_dir"
else
  warn "没有 .env，将使用默认值（数据落在 ./data）"
fi

[ -f Dockerfile ] && [ -f docker-compose.yml ] || fail "当前目录不像项目根目录（缺 Dockerfile 或 docker-compose.yml）"

echo ""
echo "===== 4. 数据目录可写 ====="
target=${data_dir:-./data}
if mkdir -p "$target" 2>/dev/null && [ -w "$target" ]; then
  pass "$target 可写"
else
  fail "$target 不可写 —— 容器里写不进数据库"
fi

echo ""
echo "===== 5. 端口 ====="
port=$(grep -E '^[[:space:]]*KANBAN_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2-)
port=${port:-12333}
if command -v ss >/dev/null 2>&1; then
  if ss -ltn 2>/dev/null | grep -q ":$port "; then
    fail "端口 $port 已被占用"
  else
    pass "端口 $port 空闲"
  fi
else
  warn "无法检测端口占用（缺 ss 命令），确认 $port 未被其他服务使用"
fi

echo ""
echo "===== 6. 现有部署 ====="
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx family-kanban; then
  warn "已存在容器 family-kanban：$(docker ps -a --filter name=family-kanban --format '{{.Status}}')"
else
  pass "无同名容器"
fi

echo ""
echo "----------------------------"
echo " 通过 $ok 项，失败 $bad 项"
if [ "$bad" -gt 0 ]; then
  echo " 先修掉标 ✗ 的项，再执行： docker compose up -d --build"
  exit 1
fi
echo " 可以继续： docker compose up -d --build"
echo ""
