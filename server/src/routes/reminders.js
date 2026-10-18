'use strict'

const express = require('express')
const { getDb, getSettings } = require('../db')
const scheduler = require('../services/reminderScheduler')

const router = express.Router()

/** 前端轮询入口：返回当前应展示的提醒 */
router.get('/due', (req, res) => {
  const windowSeconds = Math.min(600, Math.max(0, Number(req.query.window) || 60))
  res.json({
    serverTime: new Date().toISOString(),
    items: scheduler.findDue(windowSeconds)
  })
})

/** 今日剩余提醒 */
router.get('/upcoming', (req, res) => {
  res.json(scheduler.findUpcomingToday())
})

/** 手动触发一次全量补齐（设置页可用） */
router.post('/resync', (req, res) => {
  const created = scheduler.syncAllRules()
  scheduler.expireStale()
  res.json({ ok: true, created })
})

router.post('/instances/:id/handle', (req, res) => {
  const action = String((req.body && req.body.action) || '').trim()
  if (!['done', 'skip', 'snooze'].includes(action)) {
    return res.status(400).json({ error: 'action 只能是 done / skip / snooze' })
  }
  const snoozeMinutes = Number(getSettings()['reminder.snoozeMinutes']) || 10
  const result = scheduler.handleInstance(req.params.id, action, snoozeMinutes)
  if (!result) return res.status(404).json({ error: '提醒实例不存在' })
  res.json(result)
})

/** 查看某条待办的提醒规则与已生成的实例 */
router.get('/rules/:todoId', (req, res) => {
  const db = getDb()
  const rule = db.prepare('SELECT * FROM reminder_rule WHERE todo_id = ?;').get(req.params.todoId)
  if (!rule) return res.json({ rule: null, instances: [] })
  const instances = db
    .prepare(
      `SELECT id, fire_at, seq, status, handled_at FROM reminder_instance
       WHERE rule_id = ? ORDER BY fire_at ASC LIMIT 200;`
    )
    .all(rule.id)
  res.json({
    rule: {
      id: rule.id,
      todoId: rule.todo_id,
      startDate: rule.start_date,
      startTime: rule.start_time,
      timesPerDay: rule.times_per_day,
      intervalHours: rule.interval_hours,
      durationDays: rule.duration_days,
      pattern: rule.pattern || 'daily',
      weekdays: scheduler.parseWeekdays(rule.weekdays),
      workWeek: Number(rule.work_week) === 6 ? 6 : 5,
      enabled: !!rule.enabled
    },
    instances: instances.map((i) => ({
      id: i.id,
      fireAt: i.fire_at,
      seq: i.seq,
      status: i.status,
      handledAt: i.handled_at
    }))
  })
})

/** 预览某条规则的触发时刻（不落库） */
router.post('/preview', (req, res) => {
  const body = req.body || {}
  const rule = {
    start_date: body.startDate,
    start_time: body.startTime,
    times_per_day: body.timesPerDay,
    interval_hours: body.intervalHours,
    duration_days: body.durationDays,
    pattern: scheduler.PATTERNS.includes(body.pattern) ? body.pattern : 'daily',
    weekdays: scheduler.parseWeekdays(body.weekdays).join(','),
    work_week: Number(body.workWeek) === 6 ? 6 : 5
  }
  const times = scheduler.computeFireTimes(rule)
  res.json({
    total: times.length,
    patternLabel: scheduler.describePattern(rule),
    firstAt: times[0] || null,
    lastAt: times[times.length - 1] || null,
    times: times.slice(0, 60)
  })
})

module.exports = { router }
