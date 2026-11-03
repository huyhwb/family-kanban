'use strict'

const express = require('express')
const dayjs = require('dayjs')
const { getDb, getSettings } = require('../db')
const { uid, nowIso } = require('../lib/util')

const router = express.Router()

const UNITS = ['盒', '瓶', '袋', '罐', '支', '板']
/** 散装单位：拆开后按片 / 袋 / 支 / 毫升计 */
const LOOSE_UNITS = ['片', '粒', '袋', '支', '包', 'ml', 'g']

function warnDays() {
  const n = Number(getSettings()['medicine.warnDays'])
  return Number.isFinite(n) && n > 0 ? n : 30
}

function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function text(v, max = 200) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayjs(v).isValid()
}

/** 剩余量文案：整件 + 散装，缺一项就只说一项 */
function amountText(packCount, packUnit, looseCount, looseUnit) {
  const parts = []
  if (packCount > 0) parts.push(`${packCount}${packUnit}`)
  if (looseCount > 0) parts.push(`${looseCount}${looseUnit}`)
  return parts.length ? parts.join(' + ') : `0${packUnit}`
}

/** 计算剩余天数与状态：expired 已过期 / soon 临期 / empty 缺货 / ok 正常 */
function shape(row) {
  const today = dayjs().startOf('day')
  let daysLeft = null
  if (row.expiry_date && isDate(row.expiry_date)) {
    daysLeft = dayjs(row.expiry_date).startOf('day').diff(today, 'day')
  }
  const packCount = num(row.pack_count)
  const looseCount = num(row.loose_count)
  const packUnit = row.pack_unit || '盒'
  const looseUnit = row.loose_unit || '片'
  const isEmpty = packCount <= 0 && looseCount <= 0

  let status = 'ok'
  if (isEmpty) status = 'empty'
  else if (daysLeft !== null && daysLeft < 0) status = 'expired'
  else if (daysLeft !== null && daysLeft <= warnDays()) status = 'soon'

  return {
    id: row.id,
    brand: row.brand || '',
    name: row.name,
    spec: row.spec || '',
    expiryDate: row.expiry_date || null,
    manufacturer: row.manufacturer || '',
    // 整件 + 散装两栏
    packCount,
    packUnit,
    looseCount,
    looseUnit,
    amountText: amountText(packCount, packUnit, looseCount, looseUnit),
    // 兼容旧字段
    quantity: packCount,
    unit: packUnit,
    barcode: row.barcode || '',
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    daysLeft,
    status
  }
}

router.get('/', (req, res) => {
  const db = getDb()
  const q = text(req.query.q, 60)
  const filter = String(req.query.filter || 'all')

  let rows = db.prepare('SELECT * FROM medicine;').all().map(shape)

  if (q) {
    const kw = q.toLowerCase()
    rows = rows.filter((m) =>
      [m.brand, m.name, m.spec, m.manufacturer, m.barcode, m.note]
        .join(' ')
        .toLowerCase()
        .includes(kw)
    )
  }
  if (filter !== 'all') rows = rows.filter((m) => m.status === filter)

  // 过期 → 临期 → 正常 → 缺货；同组按有效期升序，没写日期的排最后
  const order = { expired: 0, soon: 1, ok: 2, empty: 3 }
  rows.sort((a, b) => {
    const d = (order[a.status] ?? 9) - (order[b.status] ?? 9)
    if (d !== 0) return d
    if (a.expiryDate && b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
    if (a.expiryDate) return -1
    if (b.expiryDate) return 1
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })

  res.json(rows)
})

router.get('/stats', (req, res) => {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM medicine;').all().map(shape)
  res.json({
    total: rows.length,
    expired: rows.filter((m) => m.status === 'expired').length,
    soon: rows.filter((m) => m.status === 'soon').length,
    empty: rows.filter((m) => m.status === 'empty').length,
    warnDays: warnDays()
  })
})

router.get('/units', (req, res) => {
  res.json({ pack: UNITS, loose: LOOSE_UNITS })
})

router.get('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '药品不存在' })
  res.json(shape(row))
})

/** 从 body 里取「整件 + 散装」，兼容老的 quantity / unit */
function readAmount(body, base = {}) {
  const packCount =
    body.packCount !== undefined
      ? Math.max(0, num(body.packCount))
      : body.quantity !== undefined
        ? Math.max(0, num(body.quantity))
        : num(base.packCount)
  const packUnit = text(body.packUnit ?? body.unit, 8) || base.packUnit || '盒'
  const looseCount =
    body.looseCount !== undefined ? Math.max(0, num(body.looseCount)) : num(base.looseCount)
  const looseUnit = text(body.looseUnit, 8) || base.looseUnit || '片'
  return { packCount, packUnit, looseCount, looseUnit }
}

router.post('/', (req, res) => {
  const db = getDb()
  const body = req.body || {}
  const name = text(body.name, 80)
  if (!name) return res.status(400).json({ error: '药品名不能为空' })

  const id = uid()
  const ts = nowIso()
  const expiry = isDate(body.expiryDate) ? body.expiryDate : null
  const amount = readAmount(body)

  db.prepare(
    `INSERT INTO medicine
       (id, brand, name, spec, expiry_date, manufacturer, quantity, unit,
        pack_count, pack_unit, loose_count, loose_unit, barcode, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
  ).run(
    id,
    text(body.brand, 40),
    name,
    text(body.spec, 60),
    expiry,
    text(body.manufacturer, 80),
    amount.packCount,
    amount.packUnit,
    amount.packCount,
    amount.packUnit,
    amount.looseCount,
    amount.looseUnit,
    text(body.barcode, 40),
    text(body.note, 500),
    ts,
    ts
  )

  res.status(201).json(shape(db.prepare('SELECT * FROM medicine WHERE id = ?;').get(id)))
})

router.patch('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '药品不存在' })

  const body = req.body || {}
  const amount = readAmount(body, {
    packCount: row.pack_count,
    packUnit: row.pack_unit,
    looseCount: row.loose_count,
    looseUnit: row.loose_unit
  })
  const next = {
    brand: body.brand !== undefined ? text(body.brand, 40) : row.brand,
    name: body.name !== undefined ? text(body.name, 80) : row.name,
    spec: body.spec !== undefined ? text(body.spec, 60) : row.spec,
    expiry_date:
      body.expiryDate !== undefined ? (isDate(body.expiryDate) ? body.expiryDate : null) : row.expiry_date,
    manufacturer: body.manufacturer !== undefined ? text(body.manufacturer, 80) : row.manufacturer,
    barcode: body.barcode !== undefined ? text(body.barcode, 40) : row.barcode,
    note: body.note !== undefined ? text(body.note, 500) : row.note
  }
  if (!next.name) return res.status(400).json({ error: '药品名不能为空' })

  db.prepare(
    `UPDATE medicine
     SET brand = ?, name = ?, spec = ?, expiry_date = ?, manufacturer = ?,
         quantity = ?, unit = ?, pack_count = ?, pack_unit = ?, loose_count = ?, loose_unit = ?,
         barcode = ?, note = ?, updated_at = ?
     WHERE id = ?;`
  ).run(
    next.brand,
    next.name,
    next.spec,
    next.expiry_date,
    next.manufacturer,
    amount.packCount,
    amount.packUnit,
    amount.packCount,
    amount.packUnit,
    amount.looseCount,
    amount.looseUnit,
    next.barcode,
    next.note,
    nowIso(),
    req.params.id
  )

  res.json(shape(db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id)))
})

/**
 * 取用 / 补货。
 * - `packDelta` 加减整件，`looseDelta` 加减散装；
 * - 只传 `delta` 的旧调用：正数当补一件，负数先扣散装、散装没了再扣整件。
 */
router.post('/:id/adjust', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '药品不存在' })

  const body = req.body || {}
  let pack = num(row.pack_count)
  let loose = num(row.loose_count)

  if (body.packDelta !== undefined || body.looseDelta !== undefined) {
    pack = Math.max(0, pack + num(body.packDelta))
    loose = Math.max(0, loose + num(body.looseDelta))
  } else {
    const delta = num(body.delta)
    if (delta >= 0) {
      pack += delta
    } else {
      let left = -delta
      const useLoose = Math.min(loose, left)
      loose -= useLoose
      left -= useLoose
      pack = Math.max(0, pack - left)
    }
  }

  db.prepare(
    'UPDATE medicine SET pack_count = ?, loose_count = ?, quantity = ?, updated_at = ? WHERE id = ?;'
  ).run(pack, loose, pack, nowIso(), req.params.id)

  res.json(shape(db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id)))
})

router.delete('/:id', (req, res) => {
  const db = getDb()
  const info = db.prepare('DELETE FROM medicine WHERE id = ?;').run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: '药品不存在' })
  res.json({ ok: true })
})

module.exports = { router, UNITS }
