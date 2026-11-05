'use strict'

const fs = require('fs')
const path = require('path')
const express = require('express')
const { getDb } = require('../db')

const router = express.Router()

const DIR = path.join(__dirname, '..', 'static', 'holidays')
const customKey = (year) => `holiday.custom.${year}`

function readFileData(year) {
  const file = path.join(DIR, `${year}.json`)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.warn(`[calendar] 节假日文件解析失败：${file}`, err.message)
    return null
  }
}

function readCustom(year) {
  const db = getDb()
  const row = db.prepare('SELECT value FROM app_setting WHERE key = ?;').get(customKey(year))
  if (!row || !row.value) return null
  try {
    return JSON.parse(row.value)
  } catch (err) {
    return null
  }
}

function mergeYear(year) {
  const base = readFileData(year) || { year, off: {}, work: [], source: '未内置该年份数据' }
  const custom = readCustom(year)
  if (!custom) return { ...base, year, overridden: false }
  return {
    year,
    off: { ...(base.off || {}), ...(custom.off || {}) },
    work: [...new Set([...(base.work || []), ...(custom.work || [])])],
    source: custom.source || base.source,
    overridden: true
  }
}

router.get('/holiday-years', (req, res) => {
  const years = fs
    .readdirSync(DIR)
    .filter((f) => /^\d{4}\.json$/.test(f))
    .map((f) => Number(f.slice(0, 4)))
  const db = getDb()
  const custom = db
    .prepare("SELECT key FROM app_setting WHERE key LIKE 'holiday.custom.%';")
    .all()
    .map((r) => Number(r.key.split('.').pop()))
    .filter((n) => Number.isFinite(n))
  res.json([...new Set([...years, ...custom])].sort((a, b) => a - b))
})

router.get('/holidays', (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear()
  res.json(mergeYear(year))
})

/** 手动更新某年安排（设置页粘贴 JSON），存库而非改文件，容器重建不丢失 */
router.put('/holidays/:year', (req, res) => {
  const year = Number(req.params.year)
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return res.status(400).json({ error: '年份不合法' })
  }
  const body = req.body || {}
  const off = body.off && typeof body.off === 'object' ? body.off : {}
  const work = Array.isArray(body.work) ? body.work : []
  const badOff = Object.keys(off).find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))
  const badWork = work.find((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))
  if (badOff || badWork) {
    return res.status(400).json({ error: `日期格式应为 YYYY-MM-DD（问题项：${badOff || badWork}）` })
  }

  const payload = JSON.stringify({
    off,
    work,
    source: body.source ? String(body.source).slice(0, 200) : '手动导入'
  })
  getDb()
    .prepare(
      `INSERT INTO app_setting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
    )
    .run(customKey(year), payload)

  res.json(mergeYear(year))
})

router.delete('/holidays/:year', (req, res) => {
  const year = Number(req.params.year)
  getDb().prepare('DELETE FROM app_setting WHERE key = ?;').run(customKey(year))
  res.json(mergeYear(year))
})

/** 立即同步节假日（设置页的「立即更新」按钮） */
router.post('/sync-holidays', async (req, res) => {
  try {
    const { syncHolidays } = require('../services/holidaySync')
    const summary = await syncHolidays()
    res.json(summary)
  } catch (err) {
    res.status(502).json({ error: `同步失败：${err.message}` })
  }
})

/** 上一次自动同步的结果 */
router.get('/sync-status', (req, res) => {
  const { SETTING_KEYS, getSetting } = require('../services/holidaySync')
  let last = null
  try {
    last = JSON.parse(getSetting(SETTING_KEYS.lastResult) || 'null')
  } catch (err) {
    last = null
  }
  res.json({ lastSync: getSetting(SETTING_KEYS.lastSync), pending: getSetting(SETTING_KEYS.pending) === '1', last })
})

module.exports = { router }
