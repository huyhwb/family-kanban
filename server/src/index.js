'use strict'

const path = require('path')
const fs = require('fs')
const os = require('os')
const express = require('express')
const cors = require('cors')
const dayjs = require('dayjs')

// 统一时区：容器内 TZ=Asia/Shanghai 由部署侧保证，这里做一次自检提示
if (!process.env.TZ) {
  process.env.TZ = 'Asia/Shanghai'
}

const { getDb, getSettings, getDriverName } = require('./db')
const { projectRoot, UPLOAD_DIR, ensureDirs } = require('./lib/util')
const scheduler = require('./services/reminderScheduler')

const app = express()
const PORT = Number(process.env.PORT) || 12333
const HOST = process.env.HOST || '0.0.0.0'

ensureDirs()
getDb()

app.disable('x-powered-by')
app.use(cors())
app.use(express.json({ limit: '20mb' }))

// 头像等上传文件
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }))

// ---------- API ----------
const { router: membersRouter } = require('./routes/members')
const { router: phrasesRouter } = require('./routes/phrases')
const { router: todosRouter, shapeTodo } = require('./routes/todos')
const { router: remindersRouter } = require('./routes/reminders')
const { router: statsRouter } = require('./routes/stats')
const { router: settingsRouter } = require('./routes/settings')
const { router: calendarRouter } = require('./routes/calendar')
const { router: backupRouter } = require('./routes/backup')
const { router: exportRouter } = require('./routes/export')

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    app: 'family-kanban',
    driver: getDriverName(),
    tz: process.env.TZ,
    serverTime: dayjs().format('YYYY-MM-DDTHH:mm:ss'),
    serverTimestamp: Date.now(),
    uptimeSeconds: Math.round(process.uptime())
  })
})

/** 首屏聚合接口：一次返回成员、设置、当天待办与当月角标 */
app.get('/api/bootstrap', (req, res) => {
  const db = getDb()
  const today = dayjs().format('YYYY-MM-DD')
  const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
  const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD')

  const members = db
    .prepare('SELECT * FROM member ORDER BY sort_order ASC, created_at ASC;')
    .all()
    .map((m) => ({
      id: m.id,
      roleKey: m.role_key,
      name: m.name,
      avatarPreset: m.avatar_preset,
      avatarFile: m.avatar_file,
      avatarUrl: m.avatar_file ? `/uploads/${m.avatar_file}` : null,
      sortOrder: m.sort_order,
      visibleOnHome: !!m.visible_on_home
    }))

  const todoRows = db
    .prepare(
      `SELECT t.* FROM todo t
       WHERE t.due_date = ?
       ORDER BY CASE t.status WHEN 'pending' THEN 0 ELSE 1 END,
                CASE WHEN t.due_time IS NULL THEN 1 ELSE 0 END,
                t.due_time ASC, t.sort_order ASC;`
    )
    .all(today)

  const todos = todoRows.map((row) => shapeTodo(db, row))

  const counts = db
    .prepare(
      `SELECT due_date AS date, COUNT(*) AS total,
              SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM todo WHERE due_date BETWEEN ? AND ?
       GROUP BY due_date;`
    )
    .all(monthStart, monthEnd)

  res.json({
    today,
    monthStart,
    monthEnd,
    serverTime: dayjs().format('YYYY-MM-DDTHH:mm:ss'),
    serverTimestamp: Date.now(),
    settings: getSettings(),
    members,
    todos,
    memberCounts: (() => {
      const rows = db
        .prepare(
          `SELECT tm.member_id AS mid, COUNT(DISTINCT t.id) AS total,
                  COUNT(DISTINCT CASE WHEN t.status = 'pending' THEN t.id END) AS pending
           FROM todo t JOIN todo_member tm ON tm.todo_id = t.id
           WHERE t.due_date = ? GROUP BY tm.member_id;`
        )
        .all(today)
      const byMember = {}
      for (const r of rows) byMember[r.mid] = Number(r.pending || 0)
      const un = db
        .prepare(
          `SELECT COUNT(*) AS n FROM todo t
           WHERE t.due_date = ? AND t.status = 'pending'
             AND NOT EXISTS (SELECT 1 FROM todo_member tm WHERE tm.todo_id = t.id);`
        )
        .get(today)
      return { byMember, unassigned: Number((un && un.n) || 0) }
    })(),
    dailyCounts: counts.map((c) => ({
      date: c.date,
      total: Number(c.total),
      pending: Number(c.pending || 0)
    })),
    upcomingReminders: scheduler.findUpcomingToday()
  })
})

app.use('/api/members', membersRouter)
app.use('/api/phrases', phrasesRouter)
app.use('/api/todos', todosRouter)
app.use('/api/reminders', remindersRouter)
app.use('/api/stats', statsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/calendar', calendarRouter)
app.use('/api/backup', backupRouter)
app.use('/api/export', exportRouter)

app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' })
})

// ---------- 前端静态资源 ----------
const distDir = path.join(projectRoot, 'web', 'dist')
const hasDist = fs.existsSync(path.join(distDir, 'index.html'))

function isReserved(p) {
  return p.startsWith('/api') || p.startsWith('/uploads')
}

if (hasDist) {
  app.use(express.static(distDir, { index: false }))
  // Express 5 不再支持 '*' 路径，改用无路径中间件做 SPA 兜底
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (isReserved(req.path)) return next()
    res.sendFile(path.join(distDir, 'index.html'))
  })
} else {
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (isReserved(req.path)) return next()
    res
      .status(503)
      .type('html')
      .send(
        `<!doctype html><meta charset="utf-8"><title>家庭看板</title>
         <body style="font-family:system-ui;padding:48px;line-height:1.8;color:#1f2937">
         <h2>前端尚未构建</h2>
         <p>请先在项目根目录执行：</p>
         <pre style="background:#f3f4f6;padding:12px;border-radius:8px">npm run build</pre>
         <p>或使用开发模式：<code>npm run dev</code>（前端 5173 端口）</p>
         <p>接口健康检查：<a href="/api/health">/api/health</a></p>
         </body>`
      )
  })
}

// ---------- 统一错误处理 ----------
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '图片超过 2MB 限制' })
  }
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: '请求体 JSON 解析失败' })
  }
  const status = err.status || 500
  if (status >= 500) console.error('[error]', err)
  res.status(status).json({ error: err.message || '服务器内部错误' })
})

// ---------- 启动 ----------
function lanAddresses() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const list of Object.values(ifaces)) {
    for (const item of list || []) {
      if (item.family === 'IPv4' && !item.internal) out.push(item.address)
    }
  }
  return out
}

const server = app.listen(PORT, HOST, () => {
  scheduler.startScheduler()
  console.log('')
  console.log('  家庭看板已启动')
  console.log(`  数据库驱动：${getDriverName()}`)
  console.log(`  本机访问：http://localhost:${PORT}`)
  for (const ip of lanAddresses()) {
    console.log(`  局域网访问（平板用这个）：http://${ip}:${PORT}`)
  }
  if (!hasDist) {
    console.log('  提示：前端尚未构建，当前仅提供 API。执行 npm run build 后即可单端口访问。')
  }
  console.log('')
})

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭…`)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
