# 把镜像上传到镜像仓库

> 前提：执行命令的机器上**有可用的 Docker**（`docker version` 能看到 Server 段）。  
> 没有 Docker 守护进程时，任何方式都造不出镜像——这一步绕不过去。

---

## 〇、先认这条报错

```
Error response from daemon: Get "https://registry-1.docker.io/v2/":
net/http: request canceled while waiting for connection (Client.Timeout exceeded while awaiting headers)
```

**这不是配置错误**，是 TCP 连不上 Docker Hub 的仓库地址（`registry-1.docker.io` 在国内多数宽带下被墙）。  
`docker login`、`docker push`、以及从 `docker.io` 拉基础镜像都会撞上它。

先确认是哪一步：

```bash
curl -m 8 -sI https://registry-1.docker.io/v2/ >/dev/null && echo "能连" || echo "连不上"
```

| 报错发生在                                   | 处理                                                                         |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `docker compose build` 拉 `node:22-slim` | 基础镜像换成镜像站，见 `NAS-deploy.md` 第二节（本项目已默认走 DaoCloud）                          |
| `docker login` / `docker push`          | **推 Docker Hub 这条路走不通**，改用国内的阿里云 ACR / 腾讯云 TCR（第三节），或直接 `docker save`（第五节） |

---

## 一、先想清楚：真的需要传仓库吗

| 场景              | 建议                                                       |
| --------------- | -------------------------------------------------------- |
| 只是想让 NAS 跑起来    | **不需要**。直接在 NAS 上 `docker compose up -d --build`，镜像留在本地。 |
| 想在多台机器复用 / 备份镜像 | 传国内仓库（第三节）或 `docker save`（第五节）                           |
| 想给别人用           | 传国内仓库并设为公开，或 GitHub Container Registry                   |

> 结论：Docker Hub 在你的网络下基本不可用，别在它上面耗时间。



---

## 二、一步到位（能连 Docker Hub 的情况下）

`.env` 里已经设好 `IMAGE=huyhdk/family-kanban:latest`，所以 compose 构建出来的镜像直接就是  
`huyhdk/family-kanban:latest`，不用再手动 `docker tag`。

```bash
# 1. 登录（密码填 Access Token，不要用账号密码）
docker login -u huyhdk

# 2. 构建
docker compose build

# 3. 推送（compose 会按 image: 里写的名字推）
docker compose push
```

要留一个日期版本方便回滚，就补两条：

```bash
docker tag  huyhdk/family-kanban:latest huyhdk/family-kanban:20261017
docker push huyhdk/family-kanban:20261017
```

如果机器上没装 compose，等价的原生命令：

```bash
docker build -t huyhdk/family-kanban:latest .
docker push huyhdk/family-kanban:latest
```

**Access Token 怎么拿**：Docker Hub → 右上角头像 → Account settings → Security →  
New Access Token（权限选 Read & Write）。

> 仓库不用提前建：首次 push 会自动创建该仓库。**默认是 private**，要公开得在 Docker Hub 上手动改。  
> 公开前想清楚——镜像里含完整的前端产物和 `server/src` 源码。

---

## 三、改用国内仓库（Docker Hub 连不上时的正解）

阿里云容器镜像服务 ACR 个人版免费，国内直连，推拉都是 MB/s 级。地址形如  
`registry.cn-hangzhou.aliyuncs.com/<命名空间>/family-kanban`。

**开通**（一次性）

1. 登录阿里云 → 搜索「容器镜像服务」→ 开通（个人版免费）
2. 左侧「命名空间」→ 创建一个，例如 `huyhdk`
3. 左侧「镜像仓库」→ 创建镜像仓库 → 命名空间选 `huyhdk`、仓库名 `family-kanban`、私有

**改动**（改 `.env` 一行）

```ini
IMAGE=registry.cn-hangzhou.aliyuncs.com/huyhdk/family-kanban:latest
```

**推上去**

```bash
docker login --username=<阿里云账号邮箱> registry.cn-hangzhou.aliyuncs.com
docker compose build
docker compose push
```

> 登录密码是「容器镜像服务 → 访问凭证」里设的**固定密码**，不是阿里云登录密码。

**拉取端**把 `image:` 换成同一个地址、删掉 `build:`，然后 `docker compose pull && docker compose up -d`。

腾讯云 TCR、华为云 SWR 同理，地址分别是  
`ccr.ccs.tencentyun.com/<命名空间>/family-kanban`、`swr.cn-north-4.myhuaweicloud.com/<组织>/family-kanban`。

---

## 四、在 NAS 上构建并推送

如果 NAS 已经能成功构建（先按 `NAS-deploy.md` 第二节解决基础镜像问题），且目标仓库是国内的：

```bash
cd /vol1/1000/Docker/family-kanban
docker login --username=<阿里云账号邮箱> registry.cn-hangzhou.aliyuncs.com
docker compose build
docker compose push
```

> 仓库是 Docker Hub 的话这一步必然失败（就是开头那条报错），不必尝试。

---

## 五、替代方案：不经过任何仓库

只在一台机器上用、或者要给镜像做离线备份，`docker save` / `docker load` 最省事且不受网络影响：

```bash
# 构建机
docker save huyhdk/family-kanban:latest -o family-kanban.tar
# 传到 NAS 后
docker load -i family-kanban.tar
```

tar 里已经含全部层，NAS 不需要联网拉任何东西。

---

## 六、拉取端怎么写

推上去之后，NAS 上其实是同一个 compose 文件，只需要在那台机器上**把 `build:` 整段删掉**，  
`image:` 保持 `huyhdk/family-kanban:latest`（`.env` 里的 `IMAGE` 就是它）：

```yaml
services:
  kanban:
    image: huyhdk/family-kanban:latest
    # build: 段删掉，避免每次都重新构建
```

然后：

```bash
docker compose pull
docker compose up -d
```

> 如果只是自家这一台 NAS 用，其实不必走这一步——本地构建的镜像一直在，`up -d` 不会重新构建。  
> 上面的写法适用于"在别的机器构建、NAS 只负责跑"的场景。

拉取端同样会受 Docker Hub 网络影响；拉不动就还是用第四节的 tar。

---

## 七、注意事项

1. **别把 `data/` 打进镜像**：`.dockerignore` 已排除，但要确认本地没有把数据库复制进 `server/` 之类的位置。
2. **镜像里不含任何用户数据**：第一次启动会在 `/data` 重新建库并写入 6 位默认成员。
3. **架构要匹配**：x86 NAS 用 `linux/amd64`，ARM NAS 用 `linux/arm64`。  
   不确定就 `docker buildx build --platform linux/amd64,linux/arm64`（需要 BuildKit + 先 `--push`）。
4. **公开仓库等于公开代码**：这个镜像里含完整的 `server/src` 和前端产物，别把密钥写进代码。
