'use strict'

const express = require('express')
const { getDb } = require('../db')
const { uid } = require('../lib/util')

const router = express.Router()

function shape(row) {
  return { id: row.id, memberId: row.member_id, text: row.text, sortOrder: row.sort_order }
}

router.get('/', (req, res) => {
  const db = getDb()
  const memberId = req.query.memberId
  let rows
  if (memberId === 'any') {
    // 未指派成员时，汇集所有人的常用语供快速录入
    rows = db.prepare('SELECT * FROM phrase ORDER BY sort_order ASC;').all()
  } else if (memberId && memberId !== 'all') {
    rows = db
      .prepare('SELECT * FROM phrase WHERE member_id = ? ORDER BY sort_order ASC;')
      .all(memberId)
  } else {
    rows = db
      .prepare('SELECT * FROM phrase WHERE member_id IS NULL ORDER BY sort_order ASC;')
      .all()
  }
  res.json(rows.map(shape))
})

router.post('/', (req, res) => {
  const db = getDb()
  const { memberId = null, text } = req.body || {}
  const trimmed = String(text || '').trim()
  if (!trimmed) return res.status(400).json({ error: '常用语不能为空' })
  if (trimmed.length > 40) return res.status(400).json({ error: '常用语请控制在 40 个字以内' })

  let nextOrder = 1
  if (memberId) {
    const r = db.prepare('SELECT MAX(sort_order) AS m FROM phrase WHERE member_id = ?;').get(memberId)
    nextOrder = (r && r.m ? r.m : 0) + 1
  } else {
    const r = db
      .prepare('SELECT MAX(sort_order) AS m FROM phrase WHERE member_id IS NULL;')
      .get()
    nextOrder = (r && r.m ? r.m : 0) + 1
  }

  const id = uid()
  db.prepare('INSERT INTO phrase (id, member_id, text, sort_order) VALUES (?, ?, ?, ?);').run(
    id,
    memberId,
    trimmed,
    nextOrder
  )
  res.status(201).json(shape(db.prepare('SELECT * FROM phrase WHERE id = ?;').get(id)))
})

router.patch('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM phrase WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '常用语不存在' })
  const body = req.body || {}
  const text = body.text !== undefined ? String(body.text).trim() : row.text
  if (!text) return res.status(400).json({ error: '常用语不能为空' })
  const sortOrder = body.sortOrder !== undefined ? Number(body.sortOrder) : row.sort_order
  db.prepare('UPDATE phrase SET text = ?, sort_order = ? WHERE id = ?;').run(
    text,
    sortOrder,
    req.params.id
  )
  res.json(shape(db.prepare('SELECT * FROM phrase WHERE id = ?;').get(req.params.id)))
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM phrase WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '常用语不存在' })
  db.prepare('DELETE FROM phrase WHERE id = ?;').run(req.params.id)
  res.json({ ok: true })
})

module.exports = { router }
