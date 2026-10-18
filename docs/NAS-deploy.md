# NAS 部署指南

把家庭看板做成一个 Docker 容器，跑在 NAS 上常年不关，平板打开 `http://<NAS的局域网IP>:12333` 就是一屏看板。

整个镜像**只有一个容器、一个端口**，前端产物由后端静态托管，不需要额外装 nginx。

---

## 〇、先确认三件事

| 项目 | 要求 | 怎么查 |
| --- | --- | --- |
| CPU 架构 | `x86_64`（amd64）或 `arm64` | NAS 系统信息页，或 SSH 执行 `uname -m` |
| Docker | 支持 `docker compose` | SSH 执行 `docker compose version` |
| 端口 | `12333` 未被占用 | 换个端口也行，见下文 `KANBAN_PORT` |

> 32 位 ARM（armv7）的老 NAS 大概率跑不起来：Node 22 官方镜像已不再提供 armv7。

---

## 一、方式 A：把源码放到 NAS 上构建（推荐）

NAS 自带 Docker，直接在它上面 `build`，不用在电脑上装 Docker。

### 1. 准备要上传的文件

项目根目录执行：

```bash
npm run pack
```

会生成 `release/family-kanban-nas.zip`（约 200 KB），里面只包含构建必需的文件，不含 `node_modules`、`data`、截图等。

### 2. 上传并解压

用 File Station / 文件管理器把 zip 传到 NAS 的共享目录，例如：

```
/volume1/docker/family-kanban
```

解压后该目录下应该能直接看到 `Dockerfile`、`docker-compose.yml`、`server/`、`web/`。

### 3. 构建并启动

**群晖 DSM 7.x（Container Manager）**

1. 打开 Container Manager → 左侧「项目」→ 新增
2. 项目名称 `family-kanban`，路径选 `/docker/family-kanban`
3. 来源选「使用现有的 docker-compose.yml」
4. 一路下一步，勾选「构建镜像后启动项目」

**威联通 QNAP（Container Station）**

1. Container Station → 应用程序 → 创建
2. 选「高级模式」，把 `docker-compose.yml` 内容粘进去
3. 项目路径指向解压后的目录，应用

**通用（SSH）**

```bash
cd /vol1/1000/Docker/family-kanban
sh scripts/preflight.sh          # 先自检：docker / 网络 / 数据目录 / 端口
docker compose up -d --build
```

`preflight.sh` 是只读检查，会把不通的项标红并说清原因。构建报错时先跑它，比看构建日志快。

首次构建 3～8 分钟（看 NAS 的 CPU），日志里出现下面这段就是成功了：

```
  家庭看板已启动
  数据库驱动：better-sqlite3
  局域网访问（平板用这个）：http://192.168.x.x:12333
```

### 4. 打开看板

平板浏览器访问 `http://<NAS的局域网IP>:12333`。

---

## 二、国内网络加速（构建卡住/失败时必看）

**症状**：日志停在 `FROM node:22-slim`，报 `failed to resolve source metadata` / `dial tcp: i/o timeout` /
`pull access denied`，或者输入法里显示"无法加载镜像"。

**原因**：Docker Hub 的仓库地址 `registry-1.docker.io` 在国内多数宽带下直接不通（2026-10 实测：直连超时，
而 npm 官方源正常）。所以不是你的配置错了，是根本连不上。

**解决**：给基础镜像套一层镜像站。`docker-compose.yml` 已经默认指向 `docker.m.daocloud.io`，
正常情况下不用改；如果这个站也不通，换一个：

| 镜像站 | 面板实测（2026-10-17） |
| --- | --- |
| `docker.m.daocloud.io/library/node:22-slim` | ✅ 可正常取到镜像清单（默认） |
| `docker.1ms.run/library/node:22-slim` | ✅ 可正常取到镜像清单 |
| `docker.xuanyuan.me` | ⚠️ 取 token 失败，暂不可用 |
| `dockerpull.org` / `hub.rat.dev` | ❌ 不可用 |

改法（项目目录下新建 `.env`，和 `docker-compose.yml` 同级）：

```ini
BASE_IMAGE=docker.1ms.run/library/node:22-slim

# npm 源（官方源通常能连，慢再换）
NPM_REGISTRY=https://registry.npmjs.org/

# better-sqlite3 预编译包镜像（省去现场编译，可选）
BETTER_SQLITE3_MIRROR=https://npmmirror.com/mirrors/better-sqlite3
```

然后重新构建（换基础镜像必须清缓存，否则仍用旧的失败层）：

```bash
docker compose build --no-cache
docker compose up -d
```

> 也可以在 NAS 的 Docker 设置里配 `registry-mirrors`（群晖：Container Manager → 注册表 → 设置），
> 但那只影响 `docker pull`，对 Dockerfile 里的 `FROM` 一样生效，前提是镜像站支持 `library/xxx` 这种官方镜像路径。
> 直接改 `BASE_IMAGE` 更可控。

---

## 三、方式 B：在电脑上构建后导出镜像

适合 NAS 性能太弱、或 NAS 连不上外网的情况。前提是**电脑上装了 Docker Desktop**。

```bash
# 在你自己的电脑上（注意平台要和 NAS 一致）
docker build -t family-kanban:latest .
docker save family-kanban:latest -o family-kanban.tar
```

把 `family-kanban.tar` 传到 NAS，然后：

```bash
docker load -i family-kanban.tar
cd /volume1/docker/family-kanban
docker compose up -d        # 已有镜像，不会再重新构建
```

> NAS 是 arm64 而电脑是 x86 时，要加 `--platform linux/arm64` 构建（需要 BuildKit）。

---

## 四、可调参数

在 `.env` 里改，改完 `docker compose up -d` 生效：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `KANBAN_PORT` | `12333` | NAS 上对外开放的端口，被占用时换成 12334 之类 |
| `DATA_DIR_HOST` | `./data` | 数据库与头像在**宿主机**上的路径，见第五节 |
| `BASE_IMAGE` | `docker.m.daocloud.io/library/node:22-slim` | 基础镜像，默认走镜像站；有代理时设 `node:22-slim` |
| `NPM_REGISTRY` | 官方源 | npm 源 |
| `BETTER_SQLITE3_MIRROR` | 空 | better-sqlite3 预编译包镜像 |

> 时区固定为 `Asia/Shanghai`，写在 `docker-compose.yml` 里，不提供开关。改成变量反而容易踩坑：宿主环境若有 `TZ=GMT-8` 之类的值，会让所有提醒时刻整体偏移 8 小时。

---

## 五、数据在哪、怎么备份

容器内的 `/data` 映射到宿主机，由 `DATA_DIR_HOST` 决定：

```ini
# .env
DATA_DIR_HOST=/vol1/1000/Docker/family-kanban
```

**飞牛 / fnOS**：系统分区在 `/` 上，重装或升级有风险，把数据放到数据卷更稳妥，推荐就是上面这行。
不设这个变量时退回 `./data`（项目目录下的 `data/`），适合群晖那种把项目直接放在存储空间里的用法。

两种写法落盘内容一样：

```
/vol1/1000/Docker/family-kanban/          # DATA_DIR_HOST 指向这里
├── kanban.db        # SQLite 数据库（待办、成员、提醒、完成记录）
├── kanban.db-wal    # WAL 日志
├── kanban.db-shm
└── uploads/         # 上传的头像
```

> 路径不存在也可以，Docker 会自动创建；但前提是该目录可写（容器以 root 运行）。
> 换路径前记得先把旧数据拷过去，否则新路径会是一个空库（会重新写入 6 位默认成员）。

备份就两招：

1. **网页里导出**：设置 → 数据 → 导出备份 JSON
2. **直接拷目录**：停容器后，把整个 `data/` 复制走

```bash
docker compose down
cp -r "${DATA_DIR_HOST:-./data}" /vol1/1000/backup/family-kanban-20261017
docker compose up -d
```

> 不要在容器运行时直接拷 `kanban.db`（WAL 模式下可能拿到不一致的快照），要么停容器，要么用网页导出。

---

## 六、日常运维

```bash
docker compose logs -f --tail=100     # 看日志
docker compose restart                # 重启
docker compose down                   # 停止并删除容器（数据保留在 ./data）
docker compose up -d --build          # 更新代码后重新构建
docker compose ps                     # 看状态（health 应为 healthy）
```

容器设了 `restart: unless-stopped`，NAS 重启、断电恢复后会自动拉起。

---

## 七、常见问题

**Q：报 `Get "https://registry-1.docker.io/v2/": net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)`**
连不上 Docker Hub，**不是配置写错**。分两种情况：

- 出现在 `docker compose build` → 基础镜像还在走 Docker Hub。检查 `.env` 里的 `BASE_IMAGE` 是否被写成 `node:22-slim`（删掉这行就会用 compose 默认的 DaoCloud 镜像站），然后 `docker compose build --no-cache`。
- 出现在 `docker login` / `docker push` → 推 Docker Hub 这条路在你这网络下走不通，改用阿里云 ACR 等国内仓库，见 `push-to-dockerhub.md` 第三节。自家用直接本地构建即可，不必推。

**Q：构建卡在 `FROM node:22-slim` 很久不动**
同上。按第二节配 `BASE_IMAGE` 镜像站，或用方式 B 在别的机器上构建后导入。

**Q：构建报 `better-sqlite3` 编译失败 / `node-gyp` 相关错误**
说明预编译包没下到、现场编译也失败了。先配 `BETTER_SQLITE3_MIRROR` 让它走预编译包；如果 NAS 是 armv7 或小众架构，基本无解，建议换 x86 的机器跑。

**Q：容器起来了但网页打不开，日志里没有"前端尚未构建"**
1. 确认端口映射：`docker compose ps` 看 `0.0.0.0:12333->12333/tcp`
2. 确认 NAS 防火墙放行了 12333
3. 平板和 NAS 要在同一局域网；不要在 NAS 上开"仅 HTTPS"

**Q：`/api/health` 返回 `driver: node:sqlite`**
说明容器里的 better-sqlite3 没装成功，退化到了 Node 内置实现。功能一样能用，但建议重装一遍 （`docker compose build --no-cache`）拿到正式驱动。

**Q：容器反复重启**
先看日志 `docker compose logs --tail=50`。多半是 `./data` 目录权限问题——容器以 root 运行，宿主目录被设成只读或属于其他账户时会写不进去。

**Q：改了代码怎么更新**
把新代码覆盖到 NAS 上的项目目录（保留 `data/`），然后：

```bash
docker compose up -d --build
```

**Q：提醒时间差了 8 小时**
镜像里已固定 `TZ=Asia/Shanghai`。若仍对不上，检查平板/手机的系统时区是否被设成了别的时区——浮层上的时间取的是服务端时刻，但「今天」的判定会受客户端影响。

**Q：想让外网也能访问**
不建议直接开端口映射。要开就套一层 NAS 自带的反向代理 + HTTPS，并加访问控制；本项目本身没有登录体系，暴露到公网等于把家里数据公开。
