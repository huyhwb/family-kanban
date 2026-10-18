'use strict'

const express = require('express')
const { getDb, withTx } = require('../db')
const { uid, nowIso, isDate, isTime, asInt } = require('../lib/util')
const scheduler = require('../services/reminderScheduler')

const router = express.Router()

const QUADRANTS = new Set([1, 2, 3, 4])

/* ------------------------------------------------------------------ */
/* 映射                                                               */
/* ------------------------------------------------------------------ */

function shapeRule(row) {
  if (!row) return null
  return {
    id: row.id,
    todoId: row.todo_id,
    startDate: row.start_date,
    startTime: row.start_time,
    timesPerDay: row.times_per_day,
    intervalHours: row.interval_hours,
    durationDays: row.duration_days,
    pattern: row.pattern || 'daily',
    weekdays: scheduler.parseWeekdays(row.weekdays),
    workWeek: Number(row.work_week) === 6 ? 6 : 5,
    enabled: !!row.enabled
  }
}

/** 取某个待办的全部归属成员 */
function membersOf(db, todoId) {
  return db
    .prepare(
      `SELECT m.id, m.name, m.avatar_preset, m.avatar_file, m.sort_order
       FROM todo_member tm JOIN member m ON m.id = tm.member_id
       WHERE tm.todo_id = ?
       ORDER BY m.sort_order ASC, m.created_at ASC;`
    )
    .all(todoId)
}

/** 计次上限，防止误填出离谱数字 */
function clampTimes(n, lo = 1, hi = 99) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return lo
  return Math.min(hi, Math.max(lo, v))
}

/**
 * 推断「今天需要完成几次」。
 * 显式传 targetCount 优先；否则跟随提醒的「每天几次」；都没有就按一次性事项算。
 */
function resolveTargetCount(body, fallback = 1) {
  if (body.targetCount !== undefined && body.targetCount !== null && body.targetCount !== '') {
    return clampTimes(body.targetCount)
  }
  const r = body.reminder
  if (r && typeof r === 'object' && r.enabled !== false) {
    // 跟随提醒的「每天几次」：改成 1 次就是一次性事项
    return clampTimes(r.timesPerDay)
  }
  return clampTimes(fallback)
}

function shapeTodo(db, row) {
  // 规则挂在系列根上；副本要沿用根的规则，否则前端看不到提醒、保存时还会误删规则
  const rule =
    db
      .prepare('SELECT * FROM reminder_rule WHERE todo_id = ? ORDER BY created_at ASC LIMIT 1;')
      .get(row.id) ||
    (row.series_id
      ? db
          .prepare('SELECT * FROM reminder_rule WHERE todo_id = ? ORDER BY created_at ASC LIMIT 1;')
          .get(row.series_id)
      : null)
  const members = membersOf(db, row.id)
  const first = members[0] || null
  const targetCount = clampTimes(row.target_count, 1)
  // 以库里存的实际进度为准，不按状态反推，避免出现「4/4 但只做了 2 次」
  const doneCount = Math.min(targetCount, clampTimes(row.done_count, 0))
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    dueDate: row.due_date,
    dueTime: row.due_time,
    endTime: row.end_time,
    quadrant: row.quadrant,
    // 多成员归属；memberId 保留为主成员，兼容旧前端
    memberIds: members.map((m) => m.id),
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      avatarPreset: m.avatar_preset,
      avatarFile: m.avatar_file
    })),
    memberId: first ? first.id : null,
    memberName: first ? first.name : null,
    memberAvatarPreset: first ? first.avatar_preset : null,
    memberAvatarFile: first ? first.avatar_file : null,
    status: row.status,
    // 重复任务计次：今天已完成 doneCount / 需要 targetCount
    doneCount,
    targetCount,
    // 重复任务展开出来的某一天会带 seriesId（指向系列根）
    seriesId: row.series_id || null,
    sortOrder: row.sort_order,
    doneAt: row.done_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reminder: shapeRule(rule)
  }
}

const SELECT_BASE = 'SELECT t.* FROM todo t'

/* ------------------------------------------------------------------ */
/* 成员归属写入                                                       */
/* ------------------------------------------------------------------ */

/** 把入参里的成员统一成去重后的 id 数组（过滤掉不存在 / all / 空值） */
function normalizeMemberIds(db, body) {
  let raw = []
  if (Array.isArray(body.memberIds)) raw = body.memberIds
  else if (body.memberIds !== undefined && body.memberIds !== null) raw = String(body.memberIds).split(',')
  else if (body.memberId !== undefined) raw = [body.memberId]

  const ids = []
  for (const item of raw) {
    const id = String(item == null ? '' : item).trim()
    if (!id || id === 'all' || ids.includes(id)) continue
    ids.push(id)
  }
  if (!ids.length) return []

  const placeholders = ids.map(() => '?').join(',')
  const valid = db
    .prepare(`SELECT id FROM member WHERE id IN (${placeholders});`)
    .all(...ids)
    .map((r) => r.id)
  // 按传入顺序保留
  return ids.filter((id) => valid.includes(id))
}

function setTodoMembers(db, todoId, memberIds) {
  db.prepare('DELETE FROM todo_member WHERE todo_id = ?;').run(todoId)
  const ins = db.prepare('INSERT OR IGNORE INTO todo_member (todo_id, member_id) VALUES (?, ?);')
  for (const id of memberIds) ins.run(todoId, id)
  // 主成员写回 todo.member_id，兼容旧查询与旧数据导出
  db.prepare('UPDATE todo SET member_id = ? WHERE id = ?;').run(memberIds[0] || null, todoId)
}

/* ------------------------------------------------------------------ */
/* 提醒规则                                                           */
/* ------------------------------------------------------------------ */

/** 把系列根的静态信息同步给其余「未完成」的天；已完成的当天保持原样 */
function propagateSeries(db, rootId) {
  const root = db.prepare('SELECT * FROM todo WHERE id = ?;').get(rootId)
  if (!root) return
  const members = db
    .prepare('SELECT member_id FROM todo_member WHERE todo_id = ?;')
    .all(rootId)
    .map((r) => r.member_id)
  const clones = db
    .prepare("SELECT id FROM todo WHERE series_id = ? AND status = 'pending';")
    .all(rootId)
  if (!clones.length) return

  const upd = db.prepare(
    `UPDATE todo
     SET title = ?, note = ?, due_time = ?, end_time = ?, quadrant = ?, member_id = ?,
         target_count = ?, updated_at = ?
     WHERE id = ?;`
  )
  const del = db.prepare('DELETE FROM todo_member WHERE todo_id = ?;')
  const ins = db.prepare('INSERT OR IGNORE INTO todo_member (todo_id, member_id) VALUES (?, ?);')

  for (const c of clones) {
    upd.run(
      root.title,
      root.note,
      root.due_time,
      root.end_time,
      root.quadrant,
      root.member_id,
      root.target_count,
      nowIso(),
      c.id
    )
    del.run(c.id)
    for (const mid of members) ins.run(c.id, mid)
  }
}

/** 写入 / 更新提醒规则，并立即补齐实例 */
function upsertRule(db, todoId, reminder) {
  const existing = db.prepare('SELECT * FROM reminder_rule WHERE todo_id = ?;').get(todoId)

  if (!reminder) {
    if (existing) {
      scheduler.dropInstances(existing.id)
      db.prepare('DELETE FROM reminder_rule WHERE id = ?;').run(existing.id)
    }
    // 提醒被取消，「每天」展开出来的副本也一并收回，只留原始那行
    const owner = db.prepare('SELECT series_id FROM todo WHERE id = ?;').get(todoId)
    if (owner && !owner.series_id) scheduler.dissolveSeries(db, todoId)
    return
  }

  const startDate = isDate(reminder.startDate) ? reminder.startDate : null
  const startTime = isTime(reminder.startTime) ? reminder.startTime : null
  if (!startDate || !startTime) {
    throw Object.assign(new Error('提醒规则的开始日期与开始时间格式不正确'), { status: 400 })
  }

  const timesPerDay = Math.min(24, Math.max(1, asInt(reminder.timesPerDay, 1)))
  const intervalHours = Math.min(24, Math.max(0.25, Number(reminder.intervalHours) || 8))
  const durationDays = Math.min(365, Math.max(1, asInt(reminder.durationDays, 1)))
  const enabled = reminder.enabled === false ? 0 : 1

  const pattern = scheduler.PATTERNS.includes(reminder.pattern) ? reminder.pattern : 'daily'
  const weekdayList = scheduler.parseWeekdays(reminder.weekdays)
  if (pattern === 'weekly' && !weekdayList.length) {
    throw Object.assign(new Error('请至少选择一天星期'), { status: 400 })
  }
  const weekdays = weekdayList.length ? weekdayList.join(',') : null
  const workWeek = Number(reminder.workWeek) === 6 ? 6 : 5

  let ruleId
  if (existing) {
    ruleId = existing.id
    db.prepare(
      `UPDATE reminder_rule
       SET start_date = ?, start_time = ?, times_per_day = ?, interval_hours = ?,
           duration_days = ?, enabled = ?, pattern = ?, weekdays = ?, work_week = ?
       WHERE id = ?;`
    ).run(
      startDate,
      startTime,
      timesPerDay,
      intervalHours,
      durationDays,
      enabled,
      pattern,
      weekdays,
      workWeek,
      ruleId
    )
    // 规则参数变了，已生成但未触发的实例全部作废重建
    db.prepare('DELETE FROM reminder_instance WHERE rule_id = ?;').run(ruleId)
  } else {
    ruleId = uid()
    db.prepare(
      `INSERT INTO reminder_rule
        (id, todo_id, start_date, start_time, times_per_day, interval_hours, duration_days,
         enabled, pattern, weekdays, work_week, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    ).run(
      ruleId,
      todoId,
      startDate,
      startTime,
      timesPerDay,
      intervalHours,
      durationDays,
      enabled,
      pattern,
      weekdays,
      workWeek,
      nowIso()
    )
  }

  const rule = db.prepare('SELECT * FROM reminder_rule WHERE id = ?;').get(ruleId)
  if (rule.enabled) scheduler.syncRule(db, rule)
}

function normalizeQuadrant(v) {
  if (v === null || v === undefined || v === '' || v === 'null') return null
  const n = asInt(v, null)
  return QUADRANTS.has(n) ? n : null
}

/* ------------------------------------------------------------------ */
/* 查询                                                               */
/* ------------------------------------------------------------------ */

router.get('/', (req, res) => {
  const db = getDb()
  const { date, from, to, memberId, status, quadrant, q } = req.query

  const where = []
  const params = []

  if (isDate(date)) {
    where.push('t.due_date = ?')
    params.push(date)
  }
  if (isDate(from)) {
    where.push('t.due_date >= ?')
    params.push(from)
  }
  if (isDate(to)) {
    where.push('t.due_date <= ?')
    params.push(to)
  }
  if (memberId && memberId !== 'all') {
    where.push(
      'EXISTS (SELECT 1 FROM todo_member tm WHERE tm.todo_id = t.id AND tm.member_id = ?)'
    )
    params.push(memberId)
  }
  if (status && status !== 'all') {
    where.push('t.status = ?')
    params.push(status)
  }
  if (quadrant && quadrant !== 'all') {
    const n = normalizeQuadrant(quadrant)
    if (n === null) {
      where.push('t.quadrant IS NULL')
    } else {
      where.push('t.quadrant = ?')
      params.push(n)
    }
  }
  if (q) {
    where.push("(t.title LIKE ? OR IFNULL(t.note, '') LIKE ?)")
    params.push(`%${q}%`, `%${q}%`)
  }

  const sql = `${SELECT_BASE}
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY
      CASE t.status WHEN 'pending' THEN 0 ELSE 1 END,
      CASE WHEN t.due_time IS NULL THEN 1 ELSE 0 END,
      t.due_time ASC,
      t.sort_order ASC,
      t.created_at ASC;`

  const rows = db.prepare(sql).all(...params)
  res.json(rows.map((r) => shapeTodo(db, r)))
})

/** 日历角标用：按日聚合数量 */
router.get('/daily-counts', (req, res) => {
  const db = getDb()
  const { from, to, memberId } = req.query
  if (!isDate(from) || !isDate(to)) {
    return res.status(400).json({ error: 'from / to 需为 YYYY-MM-DD' })
  }
  const params = [from, to]
  let memberClause = ''
  if (memberId && memberId !== 'all') {
    memberClause =
      'AND EXISTS (SELECT 1 FROM todo_member tm WHERE tm.todo_id = t.id AND tm.member_id = ?)'
    params.push(memberId)
  }
  const rows = db
    .prepare(
      `SELECT t.due_date AS date,
              COUNT(*) AS total,
              SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM todo t
       WHERE t.due_date BETWEEN ? AND ? ${memberClause}
       GROUP BY t.due_date;`
    )
    .all(...params)
  res.json(
    rows.map((r) => ({ date: r.date, total: Number(r.total), pending: Number(r.pending || 0) }))
  )
})

/** 未来若干天内即将到点的提醒 */
router.get('/upcoming-reminders', (req, res) => {
  res.json(scheduler.findUpcomingToday())
})

/** 某日各成员的未完成数量（右侧头像栏角标） */
router.get('/member-summary', (req, res) => {
  const db = getDb()
  const date = isDate(req.query.date) ? req.query.date : new Date().toISOString().slice(0, 10)
  const rows = db
    .prepare(
      `SELECT tm.member_id AS mid,
              COUNT(DISTINCT t.id) AS total,
              COUNT(DISTINCT CASE WHEN t.status = 'pending' THEN t.id END) AS pending
       FROM todo t JOIN todo_member tm ON tm.todo_id = t.id
       WHERE t.due_date = ?
       GROUP BY tm.member_id;`
    )
    .all(date)
  const map = {}
  for (const r of rows) {
    map[r.mid] = Number(r.pending || 0)
  }
  const unassignedRow = db
    .prepare(
      `SELECT COUNT(*) AS n FROM todo t
       WHERE t.due_date = ? AND t.status = 'pending'
         AND NOT EXISTS (SELECT 1 FROM todo_member tm WHERE tm.todo_id = t.id);`
    )
    .get(date)
  res.json({ date, byMember: map, unassigned: Number((unassignedRow && unassignedRow.n) || 0) })
})

router.get('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare(`${SELECT_BASE} WHERE t.id = ?;`).get(req.params.id)
  if (!row) return res.status(404).json({ error: '待办不存在' })
  res.json(shapeTodo(db, row))
})

/* ------------------------------------------------------------------ */
/* 写入                                                               */
/* ------------------------------------------------------------------ */

router.post('/', (req, res) => {
  const db = getDb()
  const body = req.body || {}
  const title = String(body.title || '').trim()
  if (!title) return res.status(400).json({ error: '标题不能为空' })
  if (title.length > 60) return res.status(400).json({ error: '标题请控制在 60 个字以内' })
  if (!isDate(body.dueDate)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' })
  if (body.dueTime && !isTime(body.dueTime)) {
    return res.status(400).json({ error: '开始时间格式应为 HH:mm' })
  }
  if (body.endTime && !isTime(body.endTime)) {
    return res.status(400).json({ error: '结束时间格式应为 HH:mm' })
  }

  const id = uid()
  const ts = nowIso()
  const memberIds = normalizeMemberIds(db, body)
  const targetCount = resolveTargetCount(body)
  const maxRow = db
    .prepare('SELECT MAX(sort_order) AS m FROM todo WHERE due_date = ?;')
    .get(body.dueDate)

  try {
    withTx(db, () => {
      db.prepare(
        `INSERT INTO todo
          (id, title, note, due_date, due_time, end_time, quadrant, member_id, status, sort_order, done_at, done_count, target_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, 0, ?, ?, ?);`
      ).run(
        id,
        title,
        body.note ? String(body.note).slice(0, 500) : null,
        body.dueDate,
        body.dueTime || null,
        body.endTime || null,
        normalizeQuadrant(body.quadrant),
        memberIds[0] || null,
        (maxRow && maxRow.m ? maxRow.m : 0) + 1,
        targetCount,
        ts,
        ts
      )
      setTodoMembers(db, id, memberIds)
      upsertRule(db, id, body.reminder)
    })
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message })
    throw err
  }

  const row = db.prepare(`${SELECT_BASE} WHERE t.id = ?;`).get(id)
  res.status(201).json(shapeTodo(db, row))
})

router.patch('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM todo WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '待办不存在' })

  // 重复任务的一天只是一份副本：编辑要落到系列根上，再同步给其余未完成的天
  const rootId = row.series_id || row.id
  const isSeries =
    !!row.series_id ||
    !!db.prepare('SELECT 1 FROM todo WHERE series_id = ? LIMIT 1;').get(rootId)
  const editId = isSeries ? rootId : req.params.id
  const base = isSeries && rootId !== row.id
    ? db.prepare('SELECT * FROM todo WHERE id = ?;').get(rootId)
    : row

  const body = req.body || {}
  const next = {
    title: body.title !== undefined ? String(body.title).trim() : base.title,
    note: body.note !== undefined ? (body.note ? String(body.note).slice(0, 500) : null) : base.note,
    // 副本的日期由提醒计划决定：改副本时既不能改副本自己的日期，也不能把它的日期写到根上
    due_date: row.series_id
      ? base.due_date
      : body.dueDate !== undefined
        ? body.dueDate
        : base.due_date,
    due_time: body.dueTime !== undefined ? body.dueTime || null : base.due_time,
    end_time: body.endTime !== undefined ? body.endTime || null : base.end_time,
    quadrant: body.quadrant !== undefined ? normalizeQuadrant(body.quadrant) : base.quadrant
  }

  if (!next.title) return res.status(400).json({ error: '标题不能为空' })
  if (!isDate(next.due_date)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' })
  if (next.due_time && !isTime(next.due_time)) {
    return res.status(400).json({ error: '开始时间格式应为 HH:mm' })
  }
  if (next.end_time && !isTime(next.end_time)) {
    return res.status(400).json({ error: '结束时间格式应为 HH:mm' })
  }

  const touchMembers = body.memberIds !== undefined || body.memberId !== undefined
  // 只有显式传了 targetCount，或改了提醒规则（每天几次）时才重算次数
  const touchTarget = body.targetCount !== undefined || body.reminder !== undefined
  const nextTarget = touchTarget
    ? resolveTargetCount(body, base.target_count)
    : clampTimes(base.target_count, 1)
  // 目标次数调小时同步收敛进度，避免出现 5/3
  const nextDone = Math.min(clampTimes(row.done_count, 0), nextTarget)

  try {
    withTx(db, () => {
      db.prepare(
        `UPDATE todo
         SET title = ?, note = ?, due_date = ?, due_time = ?, end_time = ?, quadrant = ?,
             target_count = ?, done_count = ?, updated_at = ?
         WHERE id = ?;`
      ).run(
        next.title,
        next.note,
        next.due_date,
        next.due_time,
        next.end_time,
        next.quadrant,
        nextTarget,
        nextDone,
        nowIso(),
        editId
      )
      if (touchMembers) {
        setTodoMembers(db, editId, normalizeMemberIds(db, body))
      }
      if (body.reminder !== undefined) {
        upsertRule(db, editId, body.reminder)
      }
      if (isSeries) propagateSeries(db, editId)
    })
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message })
    throw err
  }

  // 改小目标次数后进度已够，直接判完成（顺带写完成记录）
  if (row.status === 'pending' && nextTarget > 1 && nextDone >= nextTarget) {
    scheduler.completeTodo(req.params.id, 'done')
  }
  // 反过来把目标调大、实际没做够，就退回未完成
  if (row.status === 'done' && nextDone < nextTarget) {
    withTx(db, () => {
      db.prepare(
        "UPDATE todo SET status = 'pending', done_at = NULL, updated_at = ? WHERE id = ?;"
      ).run(nowIso(), req.params.id)
      db.prepare(
        "DELETE FROM completion_log WHERE todo_id = ? AND act_date = date('now', 'localtime');"
      ).run(req.params.id)
    })
  }

  const updated = db.prepare(`${SELECT_BASE} WHERE t.id = ?;`).get(req.params.id)
  res.json(shapeTodo(db, updated))
})

/**
 * 勾选完成。
 * target_count > 1 的重复任务每次 +1，累计到目标才真正变「已完成」；
 * 一次性事项维持原来的行为。逻辑与提醒浮层的「已完成」共用 scheduler.recordCompletion。
 */
router.post('/:id/complete', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM todo WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '待办不存在' })

  if (row.status === 'done' || row.status === 'skipped') {
    return res.json(shapeTodo(db, row))
  }

  scheduler.recordCompletion(req.params.id)
  res.json(shapeTodo(db, db.prepare(`${SELECT_BASE} WHERE t.id = ?;`).get(req.params.id)))
})

router.post('/:id/skip', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM todo WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '待办不存在' })
  scheduler.completeTodo(req.params.id, 'skip')
  res.json(shapeTodo(db, db.prepare(`${SELECT_BASE} WHERE t.id = ?;`).get(req.params.id)))
})

router.post('/:id/restore', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM todo WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '待办不存在' })

  // 重复任务撤销一次：从已完成回到 N-1，仍在进行中就再减一次
  const target = clampTimes(row.target_count, 1)
  const count = clampTimes(row.done_count, 0)
  const nextCount = row.status === 'done' ? Math.max(0, target - 1) : Math.max(0, count - 1)

  withTx(db, () => {
    db.prepare(
      "UPDATE todo SET status = 'pending', done_at = NULL, done_count = ?, updated_at = ? WHERE id = ?;"
    ).run(nextCount, nowIso(), req.params.id)
    if (row.status !== 'pending') {
      db.prepare(
        "DELETE FROM completion_log WHERE todo_id = ? AND act_date = date('now', 'localtime');"
      ).run(req.params.id)
    }
  })

  res.json(shapeTodo(db, db.prepare(`${SELECT_BASE} WHERE t.id = ?;`).get(req.params.id)))
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM todo WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '待办不存在' })
  // 重复任务删任意一天 = 删掉整个系列（提醒规则与实例由外键级联清理）
  const rootId = row.series_id || row.id
  withTx(db, () => {
    db.prepare('DELETE FROM todo WHERE series_id = ?;').run(rootId)
    db.prepare('DELETE FROM todo WHERE id = ?;').run(rootId)
  })
  res.json({ ok: true })
})

module.exports = { router, shapeTodo, shapeRule, membersOf, setTodoMembers, normalizeMemberIds }
