# 家庭看板（Family Kanban）

家庭内网共用的常驻信息面板。部署在家里的一台常开设备上，平板浏览器横屏打开 `http://<主机IP>:12333` 即为满屏看板，统一承载**日历、待办、成员分工与定时提醒**。

> 设计目标：一屏看完、触控友好、长期稳定运行、数据留在自己家里。

---

## 一、功能一览

| 区域 | 能力 |
| --- | --- |
| **左栏 · 日历** | 月视图、农历 / 节气 / 干支、法定节假日与调休「休·班」角标、当日进度（第 N 天 / 第 N 周）、**右上角秒级实时时钟**、放假安排速查、月/年快速跳转、返回今天 |
| **中栏 · 待办** | 四象限视图（重要紧急矩阵）与清单视图一键切换；点击事项前圆圈可「完成 / 编辑 / 删除」；**每天多次的重复任务勾选时显示 1/3 进度，做够次数才转已完成**；**多人事项各人分别勾选，全部完成整条才转已完成**；按日期 × 成员叠加筛选；常用语一键填入；提醒规则可视化预览；**一键导出 .ics 到手机 / 平板日历（1 天 / 3 天 / 7 天 / 1 个月 / 全部）** |
| **右栏 · 成员** | 「全部」+ 家庭成员头像（内置 6 个自绘卡通头像，支持上传照片）；显示未完成数量角标；点击即筛选该成员待办；底部**横竖屏切换 / 方向锁定 / 设置** |
| **提醒** | 每天 N 次、从几点开始、隔几小时一次、连续多少天；支持按天 / 每周星期几 / 工作日 / 非工作日重复；**纪念日按「每年一次」重复，可选公历或农历同月同日**；到点全屏浮层 + 提示音；支持「已完成 / 稍后提醒 / 跳过本次」 |
| **设置** | 成员管理（头像 / 名称 / 主页显隐 / 常用语 / 增删）、提醒默认值、完成率与连续打卡统计、备份导出导入、主题切换、**屏幕方向与缩放**、放假安排年度更新、**药箱 AI 识别配置**、**当前版本号** |
| **药箱** | 日历右上角时钟左侧的按钮进入；按有效期排序，过期 / 临期 / 缺货分色；**规格分「每盒规格 + 小包装规格」两栏**；剩余量分「整件 + 散装」（1 盒 + 5 片）；库存按批次管理，多盒可分别录有效期；支持手动 / 扫码 / 条码查询 / 拍照 AI 四种录入 |
| **吃药提醒** | 待办新增「吃药」类型，关联药箱药品并填每次用量；**长期服药**不设结束、每天自动顺延；勾完自动扣库存，撤回自动补回；库存不足两周（长期）或撑不到疗程结束（短期）时在药箱页预警 |
| **自适应** | 根字号按「可用宽 ÷ 设计宽、可用高 ÷ 设计高」取小值等比缩放，任何分辨率都不溢出、不错位；超宽屏封顶 28px、极小屏兜底 7.5px |

**明确不做**：公网访问、账号体系、多租户、移动端竖屏适配、第三方日历接入。

---

## 二、快速开始（本机运行，无需 Docker）

前置条件：Node.js 20 或更高版本（推荐 22）。

### 方式 A：双击脚本（Windows）

```
start.bat
```

首次运行会自动安装依赖并构建前端，随后启动服务。控制台会打印本机与局域网访问地址。

### 方式 B：命令行

```bash
npm run setup     # 安装 server 与 web 依赖
npm run serve     # 构建前端并启动服务（单端口 12333）
```

启动后：

- 本机：`http://localhost:12333`
- 平板：`http://<本机局域网IP>:12333`（服务启动时会在控制台打印该 IP）

### 开发模式（热更新）

```bash
npm run dev
```

- 后端 `http://localhost:12333`
- 前端 `http://localhost:5173`（Vite 开发服务器，自动代理 `/api`）
- Windows 也可直接双击 `dev.bat`

---

## 三、Docker 部署

> 适合部署在 NAS、小主机、树莓派等长期在线的设备上。**群晖 / 威联通的详细步骤见 [docs/NAS-deploy.md](docs/NAS-deploy.md)**。

### 方式一：直接用现成镜像（推荐）

镜像托管在 `ghcr.io`，公开可拉——NAS 上**不用登录、不用构建**，一条命令起服务。
把下面内容保存为 `docker-compose.yml`（放在任意目录，例如 `/vol1/1000/Docker/family-kanban/`）：

```yaml
services:
  kanban:
    # 锁定版本号，升级时只改这一行；也可用 sha-xxxxxx 固定到某次构建
    image: ghcr.io/huyhwb/family-kanban:1.0.0
    container_name: family-kanban
    restart: unless-stopped
    # 让 Node 正确接收 SIGTERM、回收子进程（官方镜像不带 init）
    init: true
    stop_grace_period: 15s

    ports:
      # 左边是宿主机端口，被占用就改这里，例如 "8080:12333"
      - "12333:12333"

    environment:
      # 必须固定时区：提醒时刻依赖它，宿主 TZ 古怪时别跟着变
      TZ: Asia/Shanghai
      PORT: "12333"
      DATA_DIR: /data

    volumes:
      # 数据库与头像，务必持久化。放别处就改成绝对路径，
      # 例如 /vol1/1000/Docker/family-kanban:/data
      - ./data:/data

    healthcheck:
      test:
        - CMD
        - node
        - -e
        - "fetch('http://127.0.0.1:12333/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
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

```bash
docker compose up -d          # 首次会拉取镜像，约 100~150 MB
docker compose ps             # 等 health 变成 healthy
```

访问 `http://<设备IP>:12333` 即可。

- **升级**：把 `image` 的版本号改成新值 → `docker compose pull && docker compose up -d`
- **回滚**：版本号改回旧值同理；`data/` 里的数据不受影响
- **核对版本**：看板「设置 → 服务信息」，或 `curl http://<IP>:12333/api/health`

> 数据库有向下兼容的自动迁移，升级不会丢数据；但**不建议降级到写过新字段的旧版本**，降级前先备份 `data/`。

### 方式二：本地构建（没有镜像仓库或要改代码时）

#### 构建上传包

```bash
npm run pack        # 产出 release/family-kanban-nas.zip（约 120KB，只含构建必需文件）
```

把 zip 传到 NAS 解压，在解压目录执行：

```bash
docker compose up -d --build
```

访问 `http://<设备IP>:12333`。首次构建 3～8 分钟（取决于设备 CPU）。

### 关键配置

| 项 | 默认 | 说明 |
| --- | --- | --- |
| 端口 | `12333` | 可在 `.env` 里用 `KANBAN_PORT` 改宿主侧端口 |
| 数据卷 | `./data:/data` | 数据库与头像，**必须持久化**；可用 `DATA_DIR_HOST` 指定宿主机路径 |
| 时区 | `Asia/Shanghai` | 保证提醒时刻计算正确，别乱改 |
| 重启策略 | `unless-stopped` | 断电恢复后自动拉起 |
| 健康检查 | `/api/health` | 每 30 秒探测一次 |
| init | 开启 | 让 Node 正确接收 SIGTERM、回收子进程 |

镜像为三阶段构建：前端产出 `dist` → 后端装生产依赖（native 模块编译工具只留在中间层）→ 运行阶段仅含运行所需文件，最终**单容器单端口**，不依赖 nginx。

### 国内网络（构建卡住时）

在项目目录新建 `.env`：

```ini
BASE_IMAGE=docker.m.daocloud.io/library/node:22-slim
NPM_REGISTRY=https://registry.npmmirror.com
BETTER_SQLITE3_MIRROR=https://npmmirror.com/mirrors/better-sqlite3
```

模板见 `deploy/nas.env.example`。`better-sqlite3` 是原生模块，正常情况下走 GitHub 预编译包；拉不到时镜像会自动安装编译工具就地编译，不需要手动干预。

### 常用命令

```bash
docker compose logs -f --tail=100   # 查看日志（含局域网访问地址）
docker compose ps                   # 看状态，health 应为 healthy
docker compose restart              # 重启
docker compose down                 # 停止（数据保留在 ./data）

docker compose pull && docker compose up -d   # 方式一：升级到新版本
docker compose up -d --build                  # 方式二：改代码后重新构建
```

---

## 四、平板端使用建议

1. **横屏 + 常亮**：这是常驻看板，建议在平板系统设置里关闭自动锁屏。
2. **固定入口**：把 `http://<主机IP>:12333` 添加到主屏幕，或设置为浏览器启动页。
3. **提示音解锁**：浏览器要求页面先有一次用户交互才允许自动播放。首次使用请在「设置 → 提醒 → 测试提示音」点一次即可永久解锁。
4. **分辨率**：自动适配，从 800×480 到 2560×1440 都能等比缩放铺满，无需手动设置。
5. **域名/IP 变化**：建议在路由器上给主机分配固定 IP，否则平板书签会失效。

### 自动缩放与横竖屏

看板全部以 `rem` 排版，根字号由前端实时计算：

```
根字号 = min(可用宽 / 设计宽, 可用高 / 设计高)   // 横屏 80×48rem，竖屏 48×80rem
        并限制在 7.5px ~ 28px 之间
```

因此换分辨率、换平板、浏览器缩放都不会错位，也不用改任何配置。

成员栏底部有两个按钮（设置页「数据 → 屏幕与方向」里也有同样选项）：

| 按钮 | 作用 |
| --- | --- |
| **横屏 / 竖屏** | 点一下切到另一个方向。切换后自动变为「锁定」状态 |
| **锁定 / 跟随** | 「锁定」= 停在当前方向，系统怎么转都不动；「跟随」= 回到跟随设备自动旋转 |

方向选择存在浏览器本地（`localStorage`），只影响当前这台设备，不会同步给别的平板。

**关于旋转**：如果设备当前是竖的、却选择了横屏（或反之），整块面板会连同弹窗一起旋转 90° 铺满屏幕——这样宽屏布局才能用上屏幕的长边，而不是被压成一条。
如果发现转的方向不合手（比如壁挂方向特殊），到「设置 → 数据 → 屏幕与方向 → 旋转方向」切成顺时针 / 逆时针即可。

---

## 五、目录结构

```
面板/
├── start.bat / dev.bat           # Windows 本机运行脚本
├── docker-compose.yml            # Docker 编排
├── Dockerfile                    # 三阶段构建
├── deploy/nas.env.example        # NAS 部署可调参数模板
├── scripts/pack-nas.mjs          # 生成 NAS 上传包（npm run pack）
├── .github/workflows/            # GitHub Actions：构建并推送 ghcr 镜像
├── .shots/                       # 调试工具（gitignore）：CDP 截图 / 造数据
├── docs/
│   ├── 策划方案.md                # 需求与设计文档
│   ├── NAS-deploy.md             # 群晖 / 威联通 / SSH 部署步骤
│   ├── ghcr.md                   # 用 Actions 出镜像、NAS 拉取
│   └── push-to-dockerhub.md      # 推送镜像到 Docker Hub
├── release/                      # 打包产物（gitignore）
├── data/                         # 运行时数据（自动创建，已 gitignore）
│   ├── kanban.db                 # SQLite 数据库
│   └── uploads/                  # 上传的头像
├── server/                       # 后端 Express
│   └── src/
│       ├── index.js              # 入口、静态托管、/api/bootstrap
│       ├── db/                   # 建表迁移、种子数据、驱动适配
│       ├── routes/               # members / todos / phrases / reminders / stats / settings / calendar / backup / export / medicines / ai
│       ├── services/             # reminderScheduler（规则展开、实例生成）
│       └── static/holidays/      # 法定节假日数据（2024–2026）
└── web/                          # 前端 Vue 3
    └── src/
        ├── views/                # MedicinePage 药箱（整页切换）
        ├── components/           # CalendarPanel / TodoPanel / MemberRail / SettingsDialog / TodoEditor / ReminderOverlay / MedicineEditor / MedicineScanner
        ├── stores/               # board 待办与筛选 / reminder 轮询 / display 缩放与横竖屏 / medicine 药箱
        ├── lib/                  # lunar 农历、avatars 自绘头像、sound 提示音、image 头像压缩
        └── styles/main.css       # 主题变量与基础样式（body 即可旋转的「舞台」）
```

---

## 六、数据与备份

- 所有数据存在 SQLite 单文件 `data/kanban.db`，头像存在 `data/uploads/`。
- 备份有两种方式：
  1. **一键导出**：设置 → 数据 → 导出备份 JSON（含成员、待办、提醒规则、完成记录、设置）。
  2. **直接拷贝**：停服后复制整个 `data/` 目录。
- 导入会**清空并覆盖**现有数据，导入前请先导出一份。

### 数据库驱动说明

优先使用 `better-sqlite3`；若某台机器上装不上原生模块，会自动回退到 Node 22 内置的 `node:sqlite`，功能等价。可用 `GET /api/health` 查看当前使用的驱动。

---

## 七、放假安排更新

内置 2024 / 2025 / 2026 年数据（依据国务院办公厅通知）。国务院通常在上一年 11 月公布次年安排，届时按以下步骤更新：

1. 打开「设置 → 数据 → 放假安排」；
2. 输入年份（如 2027），点「读取」得到 JSON 骨架；
3. 按官方通知填入：

```json
{
  "off": { "2027-01-01": "元旦", "2027-01-02": null },
  "work": ["2027-01-04"]
}
```

4. 点「保存」。数据存入数据库而非镜像文件，容器重建不会丢失。

---

## 八、接口速查

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（含驱动、时区、服务端时间） |
| GET | `/api/bootstrap` | 首屏聚合：成员 + 设置 + 当天待办 + 当月角标 |
| GET/POST/PATCH/DELETE | `/api/todos` | 待办增删改查，支持 `?date=&memberId=&status=&quadrant=` |
| POST | `/api/todos/:id/complete` \| `skip` \| `restore` | 状态流转；多人事项传 `{ "memberId": "..." }` 只记该成员 |
| GET | `/api/todos/daily-counts` | 日历角标：按日聚合数量 |
| GET | `/api/reminders/due?window=60` | 前端轮询：当前应展示的提醒（含各成员完成状态） |
| POST | `/api/reminders/instances/:id/handle` | `done` / `skip` / `snooze`，可带 `memberId` |
| GET | `/api/export/ics?scope=1d\|3d\|7d\|1m\|all&memberId=a,b` | 导出 iCalendar，可按成员过滤 |
| GET/POST/PATCH/DELETE | `/api/medicines` | 药箱增删改查，支持 `?q=&filter=all\|soon\|expired\|empty` |
| GET | `/api/medicines/stats` | 品种数、临期、过期、缺货 |
| POST | `/api/medicines/:id/adjust` | 取用 / 补货：`{packDelta, looseDelta}` 精确加减，或 `{delta:-1}` 先扣散装再扣整件 |
| POST | `/api/medicines/:id/stock-in` | 入库，body `{ "batches": [{ "packCount": 2, "expiryDate": "2027-12-31" }] }` |
| GET | `/api/medicines/lookup?barcode=` | 条码查药品，默认 OpenFoodFacts，可在设置里换自定义接口 |
| GET | `/api/medicines/alerts` | 用药预警（长期不足两周 / 短期撑不到疗程） |
| POST | `/api/ai/medicine` | 图片识别药品，body `{ "image": "data:image/jpeg;base64,…" }` |
| POST | `/api/ai/ping` | 测试 AI 接口连通性 |
| GET | `/api/stats?range=7d` | 完成率、连续打卡、按成员统计 |
| GET | `/api/calendar/holidays?year=2026` | 节假日与调休 |
| GET/POST | `/api/backup/export` \| `import` | 备份导出与导入 |

---

## 九、常见问题

**Q：提醒会不会因为平板刷新页面而丢失？**
不会。提醒实例由服务端按规则预生成并写入 `reminder_instance` 表，前端每 10 秒轮询展示。刷新页面、重启平板、甚至重启容器，未处理的提醒都还在。

**Q：平板黑屏后还能收到提醒吗？**
面板本身无法在浏览器后台弹窗。请让平板保持常亮（或使用 kiosk 模式）。若需要更强的触达，可在后续版本叠加系统通知或微信推送。

**Q：忘记密码了？**
没有密码。本设计按家庭内网免密直连，不做账号体系。

**Q：换设备后数据还在吗？**
在。数据在服务端，任何设备访问同一地址看到的是同一份数据。

**Q：为什么点了「竖屏」画面整个转了 90°，字也是侧着的？**
因为你强制了一个和设备物理朝向不同的方向，面板只能旋转 90° 才能用上屏幕长边。设备本身转不转由你决定：想让它正过来，把平板转 90° 即可；壁挂装反了，就到「设置 → 数据 → 屏幕与方向 → 旋转方向」切换顺/逆时针。点「跟随」则立刻回到随设备自动旋转。

**Q：小屏（如 1024×600）上字变小了，正常吗？**
正常。整块看板按比例整体缩放，所以字号与**屏幕物理尺寸**成正比，小屏上必然更小——换来的是元素不会互相压盖、不会跑出屏幕。顺带一提：因为缩放基准是"铺满屏幕"，浏览器缩放（Ctrl +/-）并不会改变实际观感，想看得更清楚只能换更大的屏。

**Q：Docker 构建时 `better-sqlite3` 编译报错？**
本项目使用 `node:22-slim`（glibc）基础镜像以命中官方预编译包。若改到 Alpine（musl）需要额外安装 `python3 make g++`。

---

## 十、技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | Vue 3 + Vite + Pinia，原生 CSS 变量主题，日历自研 + `lunar-javascript` |
| 后端 | Node 22 + Express 5 + SQLite（WAL）+ node-cron |
| 部署 | Docker 多阶段构建，单容器单端口 12333 |

---

## 十一、更新日志

| 日期 | 内容 |
| --- | --- |
| 2026-11-05 | **规格两栏 / 批次库存 / 条码查询 / 吃药待办**；待办点击改为「主体完成、圆点编辑」；导出支持选成员；节假日每月自动更新 |
| 2026-11-03 | **家庭药箱**：库存 / 效期 / 条码，手动、扫码、拍照 AI 识别三种录入；**版本号机制**：设置页显示版本，镜像按版本号打标签；README 补标准 compose 文件 |
| 2026-10-21 | 清理调试产物；补充更新日志与维护约定 |
| 2026-10-20 | **纪念日**（公历 / 农历、每年一次、不限时长、不进四象限）；**导出 .ics 到手机日历**；**多人事项按人完成** |
| 2026-10-18 | 重复任务计次（1/3）；重复规则展开为逐日待办；ghcr 镜像自动构建 |
| 2026-10-17 | 首版：日历 / 四象限待办 / 成员栏 / 提醒浮层 / 平板自适应 / Docker 部署 |

---

## 十二、维护约定

- 每次功能变更后同步更新本文件（功能一览、接口速查、更新日志三处）。
- 变更前顺手清理调试产物：`.shots/` 下的截图与临时浏览器目录（`prof*`）、`release/` 旧包。
- 数据库迁移只增不改，版本号写在 `server/src/db/schema.js` 的 `migrations` 数组里，启动时按 `user_version` 自动执行。

### 版本号规则

版本号写在根 `package.json` 的 `version`，三段式 `主.次.修`，按改动性质只升对应一段：

| 段位 | 触发条件 | 示例 |
| --- | --- | --- |
| **第一位**（主） | 大版本更新：架构调整、数据模型重做、不兼容变更 | `1.4.2` → `2.0.0` |
| **第二位**（次） | 新功能、新页面、现有能力增强（向后兼容） | `1.4.2` → `1.5.0` |
| **第三位**（修） | 仅修 BUG、文案、样式细节 | `1.4.2` → `1.4.3` |

- 升高位时低位归零：`1.4.2` 加个大功能 → `2.0.0`，不是 `2.4.2`
- 纯文档改动（README / docs）**不升版本**，也不触发镜像构建
- 改完推送，Actions 自动产出同名镜像标签（如 `ghcr.io/huyhwb/family-kanban:2.0.0`）
- 主分支构建会同时把 `latest` 指向该版本，`latest` 永远等于最新发布的那一版
