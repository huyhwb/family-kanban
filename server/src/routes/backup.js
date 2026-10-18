'use strict'

const express = require('express')
const { getDb, getSettings } = require('../db')
const { nowIso } = require('../lib/util')

const router = express.Router()

const EXPORT_VERSION = 2

router.get('/export', (req, res) => {
  const db = getDb()
  const payload = {
    version: EXPORT_VERSION,
    exportedAt: nowIso(),
    app: 'family-kanban',
    data: {
      members: db.prepare('SELECT * FROM member ORDER BY sort_order ASC;').all(),
      phrases: db.prepare('SELECT * FROM phrase ORDER BY sort_order ASC;').all(),
      todos: db.prepare('SELECT * FROM todo ORDER BY due_date ASC;').all(),
      todoMembers: db.prepare('SELECT * FROM todo_member;').all(),
      reminderRules: db.prepare('SELECT * FROM reminder_rule;').all(),
      reminderInstances: db.prepare('SELECT * FROM reminder_instance;').all(),
      completionLog: db.prepare('SELECT * FROM completion_log ORDER BY acted_at ASC;').all(),
      settings: getSettings()
    }
  }
  res.setHeader('Content-Disposition', 'attachment; filename="kanban-backup.json"')
  res.json(payload)
})

router.post('/import', (req, res) => {
  const db = getDb()
  const body = req.body || {}
  const data = body.data || body
  if (!data || !Array.isArray(data.members)) {
    return res.status(400).json({ error: '备份文件格式不正确：缺少 members 数组' })
  }

  const counts = {}
  db.exec('BEGIN;')
  try {
    db.exec('DELETE FROM reminder_instance;')
    db.exec('DELETE FROM reminder_rule;')
    db.exec('DELETE FROM completion_log;')
    db.exec('DELETE FROM todo_member;')
    db.exec('DELETE FROM todo;')
    db.exec('DELETE FROM phrase;')
    db.exec('DELETE FROM member;')

    const insMember = db.prepare(
      `INSERT INTO member (id, role_key, name, avatar_preset, avatar_file, sort_order, visible_on_home, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
    )
    for (const m of data.members) {
      insMember.run(
        m.id,
        m.role_key ?? null,
        m.name,
        m.avatar_preset ?? null,
        m.avatar_file ?? null,
        Number(m.sort_order) || 0,
        m.visible_on_home === undefined ? 1 : Number(m.visible_on_home) ? 1 : 0,
        m.created_at || nowIso()
      )
    }
    counts.members = data.members.length

    const insPhrase = db.prepare(
      'INSERT INTO phrase (id, member_id, text, sort_order) VALUES (?, ?, ?, ?);'
    )
    for (const p of data.phrases || []) {
      insPhrase.run(p.id, p.member_id ?? null, p.text, Number(p.sort_order) || 0)
    }
    counts.phrases = (data.phrases || []).length

    const insTodo = db.prepare(
      `INSERT INTO todo
        (id, title, note, due_date, due_time, end_time, quadrant, member_id, status, sort_order, done_at, done_count, target_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    )
    for (const t of data.todos || []) {
      insTodo.run(
        t.id,
        t.title,
        t.note ?? null,
        t.due_date,
        t.due_time ?? null,
        t.end_time ?? null,
        t.quadrant ?? null,
        t.member_id ?? null,
        t.status || 'pending',
        Number(t.sort_order) || 0,
        t.done_at ?? null,
        Number(t.done_count) || 0,
        Math.max(1, Number(t.target_count) || 1),
        t.created_at || nowIso(),
        t.updated_at || nowIso()
      )
    }
    counts.todos = (data.todos || []).length

    // 归属关系：新版备份带 todoMembers，旧版备份从 todo.member_id 推导
    const links = Array.isArray(data.todoMembers)
      ? data.todoMembers.map((l) => [l.todo_id, l.member_id])
      : (data.todos || [])
          .filter((t) => t.member_id)
          .map((t) => [t.id, t.member_id])
    const insTm = db.prepare(
      'INSERT OR IGNORE INTO todo_member (todo_id, member_id) VALUES (?, ?);'
    )
    for (const [todoId, memberId] of links) insTm.run(todoId, memberId)
    counts.todoMembers = links.length

    const insRule = db.prepare(
      `INSERT INTO reminder_rule
        (id, todo_id, start_date, start_time, times_per_day, interval_hours, duration_days,
         enabled, pattern, weekdays, work_week, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    )
    for (const r of data.reminderRules || []) {
      insRule.run(
        r.id,
        r.todo_id,
        r.start_date,
        r.start_time,
        Number(r.times_per_day) || 1,
        Number(r.interval_hours) || 8,
        Number(r.duration_days) || 1,
        Number(r.enabled) === 0 ? 0 : 1,
        r.pattern || 'daily',
        r.weekdays ?? null,
        Number(r.work_week) === 6 ? 6 : 5,
        r.created_at || nowIso()
      )
    }
    counts.reminderRules = (data.reminderRules || []).length

    const insLog = db.prepare(
      'INSERT INTO completion_log (id, todo_id, member_id, action, act_date, acted_at) VALUES (?, ?, ?, ?, ?, ?);'
    )
    for (const l of data.completionLog || []) {
      insLog.run(
        l.id,
        l.todo_id,
        l.member_id ?? null,
        l.action,
        l.act_date,
        l.acted_at || nowIso()
      )
    }
    counts.completionLog = (data.completionLog || []).length

    const insSetting = db.prepare(
      `INSERT INTO app_setting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
    )
    for (const [key, value] of Object.entries(data.settings || {})) {
      insSetting.run(key, String(value))
    }

    db.exec('COMMIT;')
  } catch (err) {
    db.exec('ROLLBACK;')
    return res.status(400).json({ error: `导入失败：${err.message}` })
  }

  // 实例不直接恢复，交由调度器按规则重新生成，避免导入过期提醒
  const scheduler = require('../services/reminderScheduler')
  const created = scheduler.syncAllRules()

  res.json({ ok: true, counts, regeneratedInstances: created })
})

module.exports = { router }
