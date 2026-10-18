'use strict'

const express = require('express')
const { getDb, getSettings, DEFAULT_SETTINGS } = require('../db')

const router = express.Router()

const BOOLEAN_KEYS = new Set(['calendar.showLunar', 'ui.soundEnabled'])

function normalize(key, value) {
  if (BOOLEAN_KEYS.has(key)) return value === true || value === 1 || value === '1' ? '1' : '0'
  return String(value)
}

router.get('/', (req, res) => {
  res.json(getSettings())
})

router.patch('/', (req, res) => {
  const db = getDb()
  const body = req.body || {}
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS))
  const stmt = db.prepare(
    `INSERT INTO app_setting (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
  )
  const applied = {}
  db.exec('BEGIN;')
  try {
    for (const [key, value] of Object.entries(body)) {
      if (!allowed.has(key)) continue
      const v = normalize(key, value)
      stmt.run(key, v)
      applied[key] = v
    }
    db.exec('COMMIT;')
  } catch (err) {
    db.exec('ROLLBACK;')
    throw err
  }
  res.json({ ok: true, applied, settings: getSettings() })
})

module.exports = { router }
