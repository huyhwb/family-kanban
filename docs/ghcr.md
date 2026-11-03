# 用 GitHub Actions 构建镜像并发布到 ghcr.io

适合的场景：**手边没有装 Docker 的机器**，但 NAS 能拉 `ghcr.io` 的镜像。
整个构建发生在 GitHub 的服务器上，本地只需要把代码推上去。

> 实测（2026-10-18）：本网络 `ghcr.io` 可达（`/v2/` 返回 401，属正常），
> 而 `github.com` / `api.github.com` 直连超时。所以**推代码这一步需要开加速器**，
> 但 NAS 之后拉镜像是通的。

---

## 一、一次性准备

### 1. 仓库里已经有工作流

`.github/workflows/docker-publish.yml` 已就位，推送到 `main` 就会自动触发。
也可以到仓库的 **Actions → docker-publish → Run workflow** 手动跑一次。

### 2. 把代码推上 GitHub

```bash
cd "C:/Users/cqdjh/WorkBuddy/面板"
git init -b main
git add -A
git commit -m "init: 家庭看板"
git remote add origin https://github.com/<用户名>/<仓库名>.git
git push -u origin main
```

> `data/`、`node_modules/`、`release/`、`.shots/`、`.env` 都已在 `.gitignore` 里，不会被推上去。

### 3. 等 Actions 跑完

首次构建约 3～5 分钟（含 node 镜像拉取）。成功后仓库右上角 **Packages** 里会出现
`family-kanban`，地址形如：

```
ghcr.io/huyhwb/family-kanban:1.0.0
```

### 4. 让 NAS 能拉（二选一）

**A. 公开包（推荐，NAS 上不用登录）**

Packages → family-kanban → 右下 **Package settings** → Change visibility → Public。

> 公开等于把镜像内容（含 `server/src` 源码）一并公开，确认后再点。

**B. 保持私有**

在 NAS 上执行一次登录，之后 `docker pull` 会沿用凭据：

```bash
echo "<你的 PAT>" | docker login ghcr.io -u <用户名> --password-stdin
```

PAT 在 GitHub → Settings → Developer settings → Personal access tokens 生成，
勾选 `read:packages` 即可（只需读权限）。

---

## 二、NAS 上改用镜像

**完整可复制的 compose 文件见 [README 第三节「方式一：直接用现成镜像」](../README.md#三docker-部署)**。
核心区别只有一条：不要 `build:` 段，`image:` 指向 ghcr 的版本号标签。

```yaml
services:
  kanban:
    image: ghcr.io/huyhwb/family-kanban:1.0.0   # 升级时改版本号
    container_name: family-kanban
    restart: unless-stopped
    init: true
    stop_grace_period: 15s
    ports:
      - "12333:12333"
    environment:
      TZ: Asia/Shanghai
      PORT: "12333"
      DATA_DIR: /data
    volumes:
      - ./data:/data
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:12333/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"
```

然后：

```bash
docker compose pull
docker compose up -d
```

数据卷照旧挂载到 `./data`（或你在 compose 里写的绝对路径），升级不受影响。

---

## 三、更新流程

改了代码之后：

```bash
git add -A && git commit -m "fix: xxx" && git push
```

Actions 会读取根 `package.json` 的 `version`，自动打出 **版本号标签**（如 `1.0.0`）与 `sha-xxxx` 短哈希。
**不再发布 `latest`**，升级时改版本号即可，回滚也只需改回旧版本。NAS 上：

```bash
docker compose pull && docker compose up -d
```

版本号写在仓库根 `package.json` 的 `version` 字段：改完推送，Actions 就产出同名镜像。
想看当前跑的是哪个版本，打开看板「设置 → 数据 → 服务信息」，或直接 `curl http://<IP>:12333/api/health`。

---

## 四、常见问题

**Q：Actions 报 `permission denied` / 推不上去**
仓库 Settings → Actions → General → Workflow permissions，选 **Read and write permissions**。
工作流里已经声明了 `packages: write`，但仓库级开关也要放开。

**Q：构建很慢或卡在 `npm ci`**
`cache-from/to: type=gha` 已经开了构建缓存，第二次会快很多。
首次主要是拉 node 镜像 + 编译 `better-sqlite3`。

**Q：NAS 拉 ghcr.io 超时**
换个 DNS（`223.5.5.5`）再试；仍有问题就在 `docker-compose.yml` 里给 ghcr 配代理，
或改用国内仓库（阿里云 ACR，见 `push-to-dockerhub.md` 第三节）。

**Q：镜像名里带大写**
Docker 要求镜像名全小写。工作流用 `${{ github.repository_owner }}/family-kanban`，
用户名本身是全小写才不会有问题。
