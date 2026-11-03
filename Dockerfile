# 家庭看板 —— 单容器单端口镜像（前端构建 → 后端运行时）
#
# 目标架构无关：amd64 / arm64 的 NAS 都能直接构建。
# better-sqlite3 是原生模块，正常情况下走 GitHub 预编译包（几秒）；
# 拉不到时（内网 / 少见架构）会自动安装编译工具就地编译，不需要手动干预。
#
# 可选 build-arg：
#   NPM_REGISTRY             npm 源，国内可传 https://registry.npmmirror.com
#   BETTER_SQLITE3_MIRROR    预编译包镜像，国内可传 https://npmmirror.com/mirrors/better-sqlite3
#   BASE_IMAGE               基础镜像，Docker Hub 拉不动时换镜像站

ARG BASE_IMAGE=node:22-slim


# ============================================================
# 阶段 1：构建前端（Vue + Vite）
# ============================================================
FROM ${BASE_IMAGE} AS webbuild

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV npm_config_registry=${NPM_REGISTRY} \
    npm_config_audit=false \
    npm_config_fund=false

WORKDIR /app/web
# 先只拷依赖清单，命中缓存
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build


# ============================================================
# 阶段 2：安装后端生产依赖（含原生模块 better-sqlite3）
# ============================================================
FROM ${BASE_IMAGE} AS deps

ARG NPM_REGISTRY=https://registry.npmjs.org/
ARG BETTER_SQLITE3_MIRROR=

ENV npm_config_registry=${NPM_REGISTRY} \
    npm_config_better_sqlite3_binary_host_mirror=${BETTER_SQLITE3_MIRROR} \
    npm_config_audit=false \
    npm_config_fund=false

WORKDIR /app
COPY server/package.json server/package-lock.json ./server/

# 先用预编译包；失败再装编译工具重来一遍（编译工具只留在本阶段，不进最终镜像）
RUN if npm --prefix server ci --omit=dev; then \
        echo "依赖安装完成（预编译模块）"; \
    else \
        echo "【提示】预编译包获取失败，改为源码编译 better-sqlite3…"; \
        apt-get update \
        && apt-get install -y --no-install-recommends python3 make g++ \
        && rm -rf /var/lib/apt/lists/*; \
        npm --prefix server ci --omit=dev --build-from-source; \
    fi \
    && npm cache clean --force


# ============================================================
# 阶段 3：运行时
# ============================================================
FROM ${BASE_IMAGE}

LABEL org.opencontainers.image.title="family-kanban" \
      org.opencontainers.image.description="家庭看板：日历 / 待办 / 成员 / 定时提醒"

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=12333 \
    DATA_DIR=/data

RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 版本号来源（服务端启动时读取，用于接口与设置页展示）
COPY package.json ./package.json

# 生产依赖（含已编译好的 better-sqlite3）
COPY --from=deps /app/server/node_modules ./server/node_modules
# 后端源码（.dockerignore 已排除 node_modules，不会覆盖容器内的依赖）
COPY server/ ./server/
# 前端产物
COPY --from=webbuild /app/web/dist ./web/dist

# 数据库与头像的挂载点
RUN mkdir -p /data/uploads
VOLUME ["/data"]

EXPOSE 12333

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:12333/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
