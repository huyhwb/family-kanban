'use strict'

const dayjs = require('dayjs')
const cron = require('node-cron')
const { getDb, withTx } = require('../db')
const { uid, nowIso } = require('../lib/util')

/** 未处理的提醒超过该分钟数后标记为 expired，避免长期堆积 */
const EXPIRE_MINUTES = 120
/** 单条规则一次最多生成多少个实例，防止参数填错时把库撑爆 */
const MAX_INSTANCES_PER_RULE = 4000

/** 重复方式 */
const PATTERNS = ['daily', 'weekly', 'workdays', 'restdays']

const FMT = 'YYYY-MM-DDTHH:mm:ss'
const DAY = 'YYYY-MM-DD'

/* ------------------------------------------------------------------ */
/* 重复规则解析                                                       */
/* ------------------------------------------------------------------ */

/** 把 '1,3,5' / [1,3,5] / null 统一成去重后的 ISO 星期数组（1=周一 … 7=周日） */
function parseWeekdays(raw) {
  if (raw == null) return []
  const list = Array.isArray(raw) ? raw : String(raw).split(',')
  const out = []
  for (const item of list) {
    const n = Number(String(item).trim())
    if (Number.isInteger(n) && n >= 1 && n <= 7 && !out.includes(n)) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

/** 6=周日，其余与 ISO 星期一致 */
function isoWeekday(d) {
  const w = d.day() // dayjs: 0=周日
  return w === 0 ? 7 : w
}

/**
 * 判断某一天是否命中规则的重复方式。
 * 说明：工作日/非工作日按「工作制」推算，不叠加法定调休（调休只影响日历角标）。
 */
function dayMatches(dateStr, rule) {
  const pattern = rule.pattern || 'daily'
  if (pattern === 'daily') return true

  const d = dayjs(dateStr)
  if (!d.isValid()) return false
  const iso = isoWeekday(d)

  if (pattern === 'weekly') {
    const days = parseWeekdays(rule.weekdays_array || rule.weekdays)
    if (!days.length) return true // 没选星期时不限制，退化为每天
    return days.includes(iso)
  }

  const workWeek = Number(rule.work_week) === 6 ? 6 : 5
  if (pattern === 'workdays') return iso <= workWeek
  if (pattern === 'restdays') return iso === 7 || iso > workWeek
  return true
}

/**
 * 计算某条规则产生的全部触发时刻。
 * 先在 [start_date, start_date + duration_days) 窗口内筛出命中的日期，
 * 再在命中日按 start_time + j × interval_hours 生成时刻。
 */
function computeFireTimes(rule) {
  const times = []
  const start = dayjs(`${rule.start_date} ${rule.start_time}`)
  if (!start.isValid()) return times

  const perDay = Math.max(1, Number(rule.times_per_day) || 1)
  const interval = Number(rule.interval_hours) || 0
  const days = Math.max(1, Number(rule.duration_days) || 1)

  for (let i = 0; i < days; i++) {
    const dayStart = start.add(i, 'day')
    if (!dayMatches(dayStart.format(DAY), rule)) continue
    for (let j = 0; j < perDay; j++) {
      times.push(dayStart.add(Math.round(j * interval * 60), 'minute').format(FMT))
      if (times.length >= MAX_INSTANCES_PER_RULE) return times
    }
  }
  return times
}

/** 只算数量，供前端预览文案使用 */
function countFireTimes(rule) {
  return computeFireTimes(rule).length
}

/** 生成一句人话描述，前后端共用同一套口径 */
function describePattern(rule) {
  const pattern = rule.pattern || 'daily'
  if (pattern === 'weekly') {
    const days = parseWeekdays(rule.weekdays_array || rule.weekdays)
    if (!days.length) return '每天'
    const NAMES = ['一', '二', '三', '四', '五', '六', '日']
    return `每周${days.map((d) => NAMES[d - 1]).join('、')}`
  }
  if (pattern === 'workdays') return Number(rule.work_week) === 6 ? '六天工作制' : '五天工作制'
  if (pattern === 'restdays') return Number(rule.work_week) === 6 ? '每周日' : '周末'
  return '每天'
}

/* ------------------------------------------------------------------ */
/* 实例生成                                                           */
/* ------------------------------------------------------------------ */

/**
 * 为单条规则补齐实例（幂等，增量）。
 * 已过期的时刻不再补，避免重启时把历史全刷一遍。
 */
/**
 * 把「每天 / 每周 / 工作日…」的重复提醒展开成逐日待办。
 *
 * 背景：待办本身是"某一天的一行"，而提醒规则可以跨很多天。若不展开，
 * 第二天列表里就没有这条任务，只有到点弹窗、却无从勾选。
 *
 * 做法：规则挂在系列根（第一天那行，series_id 为空）上，
 * 其余每一天各生成一行副本，series_id 指向根；每天各自独立完成与计次。
 */
function materializeSeries(db, rule) {
  const owner = db.prepare('SELECT * FROM todo WHERE id = ?;').get(rule.todo_id)
  if (!owner) return { created: 0, pruned: 0 }

  const rootId = owner.series_id || owner.id
  const root = rootId === owner.id
    ? owner
    : db.prepare('SELECT * FROM todo WHERE id = ?;').get(rootId)
  if (!root) return { created: 0, pruned: 0 }

  const dates = [...new Set(computeFireTimes(rule).map((f) => f.slice(0, 10)))]
  if (!dates.length) return { created: 0, pruned: 0 }

  const members = db
    .prepare('SELECT member_id FROM todo_member WHERE todo_id = ?;')
    .all(rootId)
    .map((r) => r.member_id)

  const findRow = db.prepare(
    'SELECT * FROM todo WHERE series_id = ? AND due_date = ? LIMIT 1;'
  )
  const insertRow = db.prepare(
    `INSERT INTO todo
      (id, title, note, due_date, due_time, end_time, quadrant, member_id, status,
       sort_order, done_at, done_count, target_count, series_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, 0, ?, ?, ?, ?);`
  )
  const insertMember = db.prepare(
    'INSERT OR IGNORE INTO todo_member (todo_id, member_id) VALUES (?, ?);'
  )
  const syncRow = db.prepare(
    `UPDATE todo
     SET title = ?, note = ?, due_time = ?, end_time = ?, quadrant = ?,
         member_id = ?, target_count = ?, updated_at = ?
     WHERE id = ?;`
  )

  let created = 0
  const dayMap = new Map()
  for (const date of dates) {
    const row = findRow.get(rootId, date)
    if (!row) {
      if (date === root.due_date) {
        dayMap.set(date, rootId)
        continue // 根自己就是这一天
      }
      const id = uid()
      insertRow.run(
        id,
        root.title,
        root.note,
        date,
        root.due_time,
        root.end_time,
        root.quadrant,
        root.member_id,
        root.sort_order,
        root.target_count,
        rootId,
        nowIso(),
        nowIso()
      )
      for (const mid of members) insertMember.run(id, mid)
      dayMap.set(date, id)
      created += 1
      continue
    }
    dayMap.set(date, row.id)
    // 已存在的行：把根上的"静态信息"同步过来，但不动已完成的那天
    if (row.status !== 'pending') continue
    syncRow.run(
      root.title,
      root.note,
      root.due_time,
      root.end_time,
      root.quadrant,
      root.member_id,
      root.target_count,
      nowIso(),
      row.id
    )
    db.prepare('DELETE FROM todo_member WHERE todo_id = ?;').run(row.id)
    for (const mid of members) insertMember.run(row.id, mid)
  }

  // 规则缩短后，超出范围的未完成副本删掉
  const stale = db
    .prepare("SELECT id, due_date FROM todo WHERE series_id = ? AND status = 'pending';")
    .all(rootId)
    .filter((r) => !dates.includes(r.due_date))
  for (const r of stale) {
    db.prepare('DELETE FROM todo WHERE id = ?;').run(r.id)
  }

  return { created, pruned: stale.length, rootId, dayMap }
}

/** 提醒实例挂到当天的待办行上，浮层才知道"今天这条"做到哪了 */
function retargetInstances(db, rule, series) {
  const stmt = db.prepare('UPDATE reminder_instance SET todo_id = ? WHERE id = ?;')
  const rows = db.prepare('SELECT id, fire_at, todo_id FROM reminder_instance WHERE rule_id = ?;').all(rule.id)
  let changed = 0
  for (const row of rows) {
    const date = String(row.fire_at).slice(0, 10)
    const target = series.dayMap.get(date)
    if (!target || target === row.todo_id) continue
    stmt.run(target, row.id)
    changed += 1
  }
  return changed
}

/** 规则被删除时，清掉它展开出来的副本（保留原始那行） */
function dissolveSeries(db, rootId) {
  db.prepare("DELETE FROM todo WHERE series_id = ? AND status = 'pending';").run(rootId)
}

function syncRule(db, rule) {
  // 先把逐日待办补齐，实例才能挂到当天的行上
  const series = materializeSeries(db, rule)

  const fires = computeFireTimes(rule)
  if (!fires.length) return 0

  const floor = dayjs().subtract(EXPIRE_MINUTES, 'minute').format(FMT)
  const wanted = fires.filter((f) => f >= floor)
  if (!wanted.length) return 0

  const existing = new Set(
    db
      .prepare('SELECT fire_at FROM reminder_instance WHERE rule_id = ?;')
      .all(rule.id)
      .map((r) => r.fire_at)
  )

  const missing = wanted.filter((f) => !existing.has(f))
  const ins = db.prepare(
    `INSERT INTO reminder_instance (id, rule_id, todo_id, fire_at, seq, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(rule_id, fire_at) DO NOTHING;`
  )

  let created = 0
  withTx(db, () => {
    missing.forEach((fire) => {
      const seq = fires.indexOf(fire)
      const dayId = series.dayMap.get(fire.slice(0, 10)) || rule.todo_id
      const r = ins.run(uid(), rule.id, dayId, fire, seq, nowIso())
      if (r.changes > 0) created += r.changes
    })
    // 已存在的实例（比如升级前的旧数据）也补挂到当天那行
    retargetInstances(db, rule, series)
  })
  return created
}

/** 为所有启用中的规则补齐实例 */
function syncAllRules() {
  const db = getDb()
  const rules = db.prepare('SELECT * FROM reminder_rule WHERE enabled = 1;').all()
  let total = 0
  for (const rule of rules) {
    total += syncRule(db, rule)
  }
  if (total > 0) console.log(`[reminder] 新生成 ${total} 条提醒实例`)
  return total
}

/** 清理异常久未处理的实例 */
function expireStale() {
  const db = getDb()
  const limit = dayjs().subtract(EXPIRE_MINUTES, 'minute').format(FMT)
  const res = db
    .prepare(
      `UPDATE reminder_instance SET status = 'expired'
       WHERE status = 'pending' AND fire_at < ?;`
    )
    .run(limit)
  if (res.changes > 0) console.log(`[reminder] 过期未处理 ${res.changes} 条`)
  return res.changes
}

/* ------------------------------------------------------------------ */
/* 成员聚合（多成员归属）                                             */
/* ------------------------------------------------------------------ */

const MEMBER_NAMES_SQL = `(
  SELECT group_concat(m2.name, '、')
    FROM todo_member tm JOIN member m2 ON m2.id = tm.member_id
   WHERE tm.todo_id = t.id
)`
const MEMBER_AVATAR_SQL = (col) => `(
  SELECT m3.${col}
    FROM todo_member tm3 JOIN member m3 ON m3.id = tm3.member_id
   WHERE tm3.todo_id = t.id
   ORDER BY m3.sort_order, m3.created_at LIMIT 1
)`

/** 取某个待办的全部归属成员 id */
function memberIdsOf(db, todoId) {
  return db
    .prepare('SELECT member_id FROM todo_member WHERE todo_id = ?;')
    .all(todoId)
    .map((r) => r.member_id)
}

/* ------------------------------------------------------------------ */
/* 查询与处理                                                         */
/* ------------------------------------------------------------------ */

/** 查询当前应展示的提醒（已到点或即将到点） */
function findDue(windowSeconds = 60) {
  const db = getDb()
  const upper = dayjs().add(windowSeconds, 'second').format(FMT)
  const lower = dayjs().subtract(EXPIRE_MINUTES, 'minute').format(FMT)
  return db
    .prepare(
      `SELECT ri.id, ri.fire_at, ri.status, ri.seq, ri.rule_id,
              t.id AS todo_id, t.title, t.note, t.due_date, t.due_time,
              t.done_count, t.target_count,
              ${MEMBER_NAMES_SQL} AS member_names,
              ${MEMBER_AVATAR_SQL('avatar_preset')} AS avatar_preset,
              ${MEMBER_AVATAR_SQL('avatar_file')}   AS avatar_file
       FROM reminder_instance ri
       JOIN todo t ON t.id = ri.todo_id
       WHERE ri.status = 'pending' AND ri.fire_at <= ? AND ri.fire_at >= ?
         AND t.status = 'pending'
       ORDER BY ri.fire_at ASC;`
    )
    .all(upper, lower)
}

/** 某条规则当天剩余的提醒（用于中栏提示条） */
function findUpcomingToday() {
  const db = getDb()
  const start = dayjs().format('YYYY-MM-DDT00:00:00')
  const end = dayjs().format('YYYY-MM-DDT23:59:59')
  return db
    .prepare(
      `SELECT ri.id, ri.fire_at, ri.status, t.title, t.id AS todo_id,
              ${MEMBER_NAMES_SQL} AS member_names
       FROM reminder_instance ri
       JOIN todo t ON t.id = ri.todo_id
       WHERE ri.status = 'pending' AND ri.fire_at BETWEEN ? AND ?
         AND t.status = 'pending'
       ORDER BY ri.fire_at ASC;`
    )
    .all(start, end)
}

function handleInstance(id, action, snoozeMinutes = 10) {
  const db = getDb()
  const inst = db.prepare('SELECT * FROM reminder_instance WHERE id = ?;').get(id)
  if (!inst) return null

  if (action === 'snooze') {
    const nextFire = dayjs().add(snoozeMinutes, 'minute').format(FMT)
    db.prepare(
      `UPDATE reminder_instance SET fire_at = ?, status = 'pending' WHERE id = ?;`
    ).run(nextFire, id)
    db.prepare('UPDATE todo SET updated_at = ? WHERE id = ?;').run(nowIso(), inst.todo_id)
    return { id, status: 'pending', fire_at: nextFire }
  }

  const status = action === 'skip' ? 'skipped' : 'done'
  db.prepare('UPDATE reminder_instance SET status = ?, handled_at = ? WHERE id = ?;').run(
    status,
    nowIso(),
    id
  )

  if (status === 'done') {
    // 走统一入口：每天多次的任务只算一次，不会一键变成已完成
    recordCompletion(inst.todo_id)
  }
  return { id, status }
}

/**
 * 标记待办完成并写入完成记录。
 * 多成员归属时给每个成员各写一条，保证个人统计不失真。
 */
/**
 * 记录「今天完成了一次」。
 * target_count > 1 的重复任务逐次累加，够数才算完成；
 * 一次性事项等价于直接标记完成。
 */
function recordCompletion(todoId) {
  const db = getDb()
  const todo = db.prepare('SELECT * FROM todo WHERE id = ?;').get(todoId)
  if (!todo) return null
  if (todo.status === 'done' || todo.status === 'skipped') return todo

  const target = Math.max(1, Number(todo.target_count) || 1)
  const count = Math.max(0, Math.min(target, Number(todo.done_count) || 0))

  if (target > 1 && count + 1 < target) {
    db.prepare('UPDATE todo SET done_count = ?, updated_at = ? WHERE id = ?;').run(
      count + 1,
      nowIso(),
      todoId
    )
    return db.prepare('SELECT * FROM todo WHERE id = ?;').get(todoId)
  }

  completeTodo(todoId, 'done')
  db.prepare('UPDATE todo SET done_count = ? WHERE id = ?;').run(target, todoId)
  return db.prepare('SELECT * FROM todo WHERE id = ?;').get(todoId)
}

function completeTodo(todoId, action = 'done') {
  const db = getDb()
  const todo = db.prepare('SELECT * FROM todo WHERE id = ?;').get(todoId)
  if (!todo) return false

  const ts = nowIso()
  const today = dayjs().format(DAY)
  const members = memberIdsOf(db, todoId)
  const targets = members.length ? members : [todo.member_id || null]

  const ins = db.prepare(
    `INSERT INTO completion_log (id, todo_id, member_id, action, act_date, acted_at)
     VALUES (?, ?, ?, ?, ?, ?);`
  )

  withTx(db, () => {
    db.prepare('UPDATE todo SET status = ?, done_at = ?, updated_at = ? WHERE id = ?;').run(
      action === 'skip' ? 'skipped' : 'done',
      ts,
      ts,
      todoId
    )
    for (const memberId of targets) {
      ins.run(uid(), todoId, memberId, action, today, ts)
    }
  })
  return true
}

/** 待办被删除 / 规则被关闭时清理未触发的实例 */
function dropInstances(ruleId) {
  getDb()
    .prepare("DELETE FROM reminder_instance WHERE rule_id = ? AND status = 'pending';")
    .run(ruleId)
}

/* ------------------------------------------------------------------ */
/* 调度                                                               */
/* ------------------------------------------------------------------ */

function startScheduler() {
  syncAllRules()
  expireStale()

  // 每小时补齐实例 + 清理过期
  cron.schedule('5 * * * *', () => {
    try {
      syncAllRules()
      expireStale()
    } catch (err) {
      console.error('[reminder] 定时任务失败', err)
    }
  })

  // 每天 00:05 重新计算（跨天后补充新一天的实例）
  cron.schedule('5 0 * * *', () => {
    try {
      syncAllRules()
      expireStale()
    } catch (err) {
      console.error('[reminder] 跨天任务失败', err)
    }
  })

  console.log('[reminder] 调度已启动')
}

module.exports = {
  computeFireTimes,
  countFireTimes,
  dayMatches,
  parseWeekdays,
  describePattern,
  syncRule,
  syncAllRules,
  materializeSeries,
  dissolveSeries,
  expireStale,
  findDue,
  findUpcomingToday,
  handleInstance,
  completeTodo,
  recordCompletion,
  dropInstances,
  memberIdsOf,
  startScheduler,
  PATTERNS,
  EXPIRE_MINUTES,
  FMT
}
