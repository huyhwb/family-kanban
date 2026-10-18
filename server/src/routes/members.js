'use strict'

const fs = require('fs')
const path = require('path')
const express = require('express')
const { getDb } = require('../db')
const { uid, nowIso, asInt } = require('../lib/util')
const { upload, UPLOAD_DIR } = require('../lib/upload')

const router = express.Router()

const AVATAR_PRESETS = new Set([
  'grandpa',
  'grandma',
  'dad',
  'mom',
  'sister',
  'brother',
  'guest'
])

function shape(row) {
  return {
    id: row.id,
    roleKey: row.role_key,
    name: row.name,
    avatarPreset: row.avatar_preset,
    avatarFile: row.avatar_file,
    avatarUrl: row.avatar_file ? `/uploads/${row.avatar_file}` : null,
    sortOrder: row.sort_order,
    visibleOnHome: !!row.visible_on_home,
    createdAt: row.created_at
  }
}

function removeAvatarFile(fileName) {
  if (!fileName) return
  const full = path.join(UPLOAD_DIR, path.basename(fileName))
  fs.promises.unlink(full).catch(() => {})
}

router.get('/', (req, res) => {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM member ORDER BY sort_order ASC, created_at ASC;')
    .all()
  res.json(rows.map(shape))
})

router.post('/', (req, res) => {
  const db = getDb()
  const { name, roleKey = null, avatarPreset = 'guest', visibleOnHome = true } = req.body || {}
  const trimmed = String(name || '').trim()
  if (!trimmed) return res.status(400).json({ error: '名称不能为空' })
  if (trimmed.length > 12) return res.status(400).json({ error: '名称请控制在 12 个字以内' })
  if (avatarPreset && !AVATAR_PRESETS.has(avatarPreset)) {
    return res.status(400).json({ error: '未知的头像预设' })
  }

  const maxRow = db.prepare('SELECT MAX(sort_order) AS m FROM member;').get()
  const nextOrder = (maxRow && maxRow.m ? maxRow.m : 0) + 1
  const id = uid()

  try {
    db.prepare(
      `INSERT INTO member (id, role_key, name, avatar_preset, avatar_file, sort_order, visible_on_home, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?);`
    ).run(id, roleKey, trimmed, avatarPreset, nextOrder, visibleOnHome ? 1 : 0, nowIso())
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: '该角色已存在' })
    }
    throw err
  }

  const row = db.prepare('SELECT * FROM member WHERE id = ?;').get(id)
  res.status(201).json(shape(row))
})

router.patch('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM member WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '成员不存在' })

  const body = req.body || {}
  const next = {
    name: body.name !== undefined ? String(body.name).trim() : row.name,
    avatar_preset: body.avatarPreset !== undefined ? body.avatarPreset : row.avatar_preset,
    visible_on_home:
      body.visibleOnHome !== undefined ? (body.visibleOnHome ? 1 : 0) : row.visible_on_home,
    sort_order: body.sortOrder !== undefined ? asInt(body.sortOrder, row.sort_order) : row.sort_order
  }

  if (!next.name) return res.status(400).json({ error: '名称不能为空' })
  if (next.name.length > 12) return res.status(400).json({ error: '名称请控制在 12 个字以内' })
  if (next.avatar_preset && !AVATAR_PRESETS.has(next.avatar_preset)) {
    return res.status(400).json({ error: '未知的头像预设' })
  }

  db.prepare(
    'UPDATE member SET name = ?, avatar_preset = ?, visible_on_home = ?, sort_order = ? WHERE id = ?;'
  ).run(next.name, next.avatar_preset, next.visible_on_home, next.sort_order, req.params.id)

  res.json(shape(db.prepare('SELECT * FROM member WHERE id = ?;').get(req.params.id)))
})

router.post('/reorder', (req, res) => {
  const db = getDb()
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : []
  if (!ids.length) return res.status(400).json({ error: 'ids 不能为空' })
  const stmt = db.prepare('UPDATE member SET sort_order = ? WHERE id = ?;')
  ids.forEach((id, index) => stmt.run(index + 1, id))
  const rows = db.prepare('SELECT * FROM member ORDER BY sort_order ASC;').all()
  res.json(rows.map(shape))
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM member WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '成员不存在' })
  db.prepare('DELETE FROM member WHERE id = ?;').run(req.params.id)
  removeAvatarFile(row.avatar_file)
  res.json({ ok: true })
})

router.post('/:id/avatar', upload.single('avatar'), (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM member WHERE id = ?;').get(req.params.id)
  if (!row) {
    if (req.file) removeAvatarFile(req.file.filename)
    return res.status(404).json({ error: '成员不存在' })
  }
  if (!req.file) return res.status(400).json({ error: '未收到图片文件' })

  db.prepare('UPDATE member SET avatar_file = ? WHERE id = ?;').run(req.file.filename, req.params.id)
  removeAvatarFile(row.avatar_file)

  res.json(shape(db.prepare('SELECT * FROM member WHERE id = ?;').get(req.params.id)))
})

router.delete('/:id/avatar', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM member WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '成员不存在' })
  db.prepare('UPDATE member SET avatar_file = NULL WHERE id = ?;').run(req.params.id)
  removeAvatarFile(row.avatar_file)
  res.json(shape(db.prepare('SELECT * FROM member WHERE id = ?;').get(req.params.id)))
})

module.exports = { router, AVATAR_PRESETS, shape }
