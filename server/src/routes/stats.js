'use strict'

const express = require('express')
const dayjs = require('dayjs')
const { getDb } = require('../db')

const router = express.Router()

const RANGES = { '7d': 7, '30d': 30, '90d': 90, '365d': 365 }

function resolveRange(range) {
  return RANGES[range] || 7
}

/** 多成员归属下的成员过滤条件（命中任一归属即算） */
const MEMBER_EXISTS = (alias = 't') =>
  `EXISTS (SELECT 1 FROM todo_member tm WHERE tm.todo_id = ${alias}.id AND tm.member_id = ?)`

router.get('/', (req, res) => {
  const db = getDb()
  const days = resolveRange(String(req.query.range || '7d'))
  const memberId = req.query.memberId
  const scoped = memberId && memberId !== 'all'
  const today = dayjs()
  const from = today.subtract(days - 1, 'day').format('YYYY-MM-DD')
  const to = today.format('YYYY-MM-DD')

  const params = [from, to]
  let memberClause = ''
  if (scoped) {
    memberClause = `AND ${MEMBER_EXISTS('t')}`
    params.push(memberId)
  }

  const rows = db
    .prepare(
      `SELECT t.due_date AS date, t.status
       FROM todo t
       WHERE t.due_date BETWEEN ? AND ? ${memberClause};`
    )
    .all(...params)

  const byDate = new Map()
  let total = 0
  let done = 0
  let skipped = 0
  let pending = 0

  for (const r of rows) {
    total++
    if (r.status === 'done') done++
    else if (r.status === 'skipped') skipped++
    else pending++

    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date, total: 0, done: 0, skipped: 0 })
    const d = byDate.get(r.date)
    d.total++
    if (r.status === 'done') d.done++
    if (r.status === 'skipped') d.skipped++
  }

  const daily = []
  for (let i = days - 1; i >= 0; i--) {
    const d = today.subtract(i, 'day').format('YYYY-MM-DD')
    daily.push(byDate.get(d) || { date: d, total: 0, done: 0, skipped: 0 })
  }

  // 按成员分布：一条待办归属多人时，每个成员各计一次
  const memberParams = [from, to]
  let memberFilter = ''
  if (scoped) {
    memberFilter = 'AND tm.member_id = ?'
    memberParams.push(memberId)
  }
  const memberRows = db
    .prepare(
      `SELECT tm.member_id AS mid, m.name AS member_name,
              COUNT(DISTINCT t.id) AS total,
              COUNT(DISTINCT CASE WHEN t.status = 'done' THEN t.id END) AS done
       FROM todo t
       JOIN todo_member tm ON tm.todo_id = t.id
       LEFT JOIN member m ON m.id = tm.member_id
       WHERE t.due_date BETWEEN ? AND ? ${memberFilter}
       GROUP BY tm.member_id;`
    )
    .all(...memberParams)

  const members = memberRows.map((m) => ({
    memberId: m.mid,
    memberName: m.member_name || '未知成员',
    total: Number(m.total),
    done: Number(m.done || 0),
    rate: Number(m.total) ? Math.round((Number(m.done || 0) / Number(m.total)) * 100) : 0
  }))

  if (!scoped) {
    const un = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
         FROM todo t
         WHERE t.due_date BETWEEN ? AND ?
           AND NOT EXISTS (SELECT 1 FROM todo_member tm WHERE tm.todo_id = t.id);`
      )
      .get(from, to)
    if (un && Number(un.total) > 0) {
      members.push({
        memberId: null,
        memberName: '未指派',
        total: Number(un.total),
        done: Number(un.done || 0),
        rate: Math.round((Number(un.done || 0) / Number(un.total)) * 100)
      })
    }
  }

  members.sort((a, b) => b.total - a.total)

  // 连续打卡：从最近一个有待办的日期向前，连续「当天全部完成」的天数
  const streakParams = [today.format('YYYY-MM-DD')]
  let streakMemberClause = ''
  if (scoped) {
    streakMemberClause = `AND ${MEMBER_EXISTS('todo')}`
    streakParams.push(memberId)
  }
  const streakRows = db
    .prepare(
      `SELECT due_date AS date,
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
       FROM todo
       WHERE due_date <= ? ${streakMemberClause}
       GROUP BY due_date
       ORDER BY due_date DESC
       LIMIT 120;`
    )
    .all(...streakParams)

  let streak = 0
  for (const r of streakRows) {
    const t = Number(r.total)
    const d = Number(r.done || 0)
    if (t === 0) continue
    if (d === t) streak++
    else break
  }

  // 打卡次数：completion_log 已按成员展开，多成员待办会各记一次
  const logCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM completion_log
       WHERE act_date BETWEEN ? AND ? ${scoped ? 'AND member_id = ?' : ''};`
    )
    .get(...(scoped ? [from, to, memberId] : [from, to]))

  res.json({
    range: `${days}d`,
    from,
    to,
    total,
    done,
    skipped,
    pending,
    completionRate: total ? Math.round((done / total) * 100) : 0,
    handledRate: total ? Math.round(((done + skipped) / total) * 100) : 0,
    streak,
    checkinCount: Number(logCount.c || 0),
    daily,
    members
  })
})

module.exports = { router }
