'use strict'

const express = require('express')
const dayjs = require('dayjs')
const { getDb } = require('../db')
const scheduler = require('../services/reminderScheduler')

const router = express.Router()

/** 导出范围：从今天起算的天数 */
const SCOPES = {
  '1d': { days: 1, name: '1 天' },
  '3d': { days: 3, name: '3 天' },
  '7d': { days: 7, name: '7 天' },
  '1m': { days: 30, name: '1 个月' },
  all: { days: 1825, name: '全部' }
}

/** iCalendar 文本转义 */
function esc(text) {
  return String(text == null ? '' : text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/** 按 75 字节折行（UTF-8 安全），续行以单个空格开头 */
function fold(line) {
  if (Buffer.byteLength(line, 'utf8') <= 73) return line
  const out = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8')
    if (bytes + b > 73) {
      out.push(cur)
      cur = ' ' + ch
      bytes = b + 1
    } else {
      cur += ch
      bytes += b
    }
  }
  if (cur) out.push(cur)
  return out.join('\r\n')
}

/** 本地时间（服务端时区 Asia/Shanghai）→ UTC 的 iCal 时间戳 */
function toUtcStamp(dateStr, timeStr) {
  const d = new Date(`${dateStr}T${timeStr}:00`)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

function dateStamp(dateStr) {
  return String(dateStr).replace(/-/g, '')
}

function addMinutes(timeStr, minutes) {
  const [h, m] = String(timeStr).split(':').map(Number)
  const total = (h * 60 + m + minutes) % (24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/**
 * 导出为 .ics，可导入 iOS / Android 日历，或作为订阅文件使用。
 * 事件按"具体日期"展开，不使用 RRULE——规则里含工作日、农历等中国特有逻辑，
 * 交给各端日历去推算反而会算错。
 */
router.get('/ics', (req, res) => {
  const db = getDb()
  const scopeKey = String(req.query.scope || '7d')
  const scope = SCOPES[scopeKey] || SCOPES['7d']

  const today = dayjs().format('YYYY-MM-DD')
  const end = dayjs().add(scope.days - 1, 'day').format('YYYY-MM-DD')

  // 可选：只导出某几个成员的事项（memberId=a,b,c）
  const memberIds = String(req.query.memberId || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  let rows = db
    .prepare(
      `SELECT t.* FROM todo t
       WHERE t.due_date BETWEEN ? AND ? AND t.status = 'pending'
       ORDER BY t.due_date ASC, CASE WHEN t.due_time IS NULL THEN 1 ELSE 0 END, t.due_time ASC;`
    )
    .all(today, end)

  if (memberIds.length) {
    const wanted = new Set(memberIds)
    const stmt = db.prepare('SELECT member_id FROM todo_member WHERE todo_id = ?;')
    rows = rows.filter((r) => stmt.all(r.id).some((x) => wanted.has(x.member_id)))
  }

  const memberStmt = db.prepare(
    `SELECT m.name FROM todo_member tm JOIN member m ON m.id = tm.member_id
     WHERE tm.todo_id = ? ORDER BY m.sort_order ASC;`
  )
  const ruleStmt = db.prepare(
    'SELECT * FROM reminder_rule WHERE todo_id = ? ORDER BY created_at ASC LIMIT 1;'
  )

  const stamp = (() => {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return (
      `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
      `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
    )
  })()
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Family Kanban//ZH-CN//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:家庭看板',
    'X-WR-TIMEZONE:Asia/Shanghai',
    `X-WR-CALDESC:导出自家庭看板（${today} 起 ${scope.name}）`
  ]

  for (const row of rows) {
    const rule = ruleStmt.get(row.id) || (row.series_id ? ruleStmt.get(row.series_id) : null)
    const names = memberStmt.all(row.id).map((m) => m.name)

    lines.push('BEGIN:VEVENT')
    lines.push(`UID:${row.id}@family-kanban`)
    lines.push(`DTSTAMP:${stamp}`)
    // 只要到了提醒时间就提醒一次；没写时间的按全天事件处理
    if (row.due_time) {
      const start = toUtcStamp(row.due_date, row.due_time)
      const endTime = row.end_time && row.end_time > row.due_time ? row.end_time : addMinutes(row.due_time, 30)
      const finish = toUtcStamp(row.due_date, endTime)
      if (start) lines.push(`DTSTART:${start}`)
      if (finish) lines.push(`DTEND:${finish}`)
    } else {
      lines.push(`DTSTART;VALUE=DATE:${dateStamp(row.due_date)}`)
      lines.push(`DTEND;VALUE=DATE:${dateStamp(dayjs(row.due_date).add(1, 'day').format('YYYY-MM-DD'))}`)
    }

    lines.push(`SUMMARY:${esc(row.title)}`)

    const desc = []
    if (row.note) desc.push(row.note)
    if (names.length) desc.push(`成员：${names.join('、')}`)
    if (rule) {
      const per = Math.max(1, Number(rule.times_per_day) || 1)
      let label = scheduler.describePattern(rule)
      if (per > 1) {
        label = label === '每天' ? `每天 ${per} 次` : `${label}，每天 ${per} 次`
      }
      if (rule.pattern === 'yearly' && rule.yearly_kind === 'lunar') {
        const lunar = scheduler.lunarLabelOf(row.due_date)
        if (lunar) label += `（${lunar}）`
      }
      desc.push(`提醒：${label}`)
    }
    desc.push('来自家庭看板')
    lines.push(`DESCRIPTION:${esc(desc.join('\n'))}`)

    if (row.due_time) {
      lines.push('BEGIN:VALARM')
      lines.push('TRIGGER:PT0M')
      lines.push('ACTION:DISPLAY')
      lines.push(`DESCRIPTION:${esc(row.title)}`)
      lines.push('END:VALARM')
    }
    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  const body = lines.map(fold).join('\r\n') + '\r\n'
  const filename = `family-kanban-${scopeKey}-${today}.ics`

  res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.setHeader('Cache-Control', 'no-store')
  res.send(body)
})

module.exports = { router, SCOPES }
