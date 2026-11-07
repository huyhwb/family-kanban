'use strict'

const express = require('express')
const dayjs = require('dayjs')
const { getDb, getSettings, withTx } = require('../db')
const {
  syncTotals,
  takeFromBatches,
  takeLooseByAmount,
  perPackOf,
  batchList
} = require('../services/medicineStock')
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
    // 规格两栏：整包规格（必填）+ 小包装规格（选填）
    packSpec: row.pack_spec || row.spec || '',
    unitSpec: row.unit_spec || '',
    spec: row.pack_spec || row.spec || '',
    expiryDate: row.expiry_date || null,
    manufacturer: row.manufacturer || '',
    // 整件 + 散装两栏
    packCount,
    packUnit,
    looseCount,
    looseUnit,
    // 每盒含多少个小规格单位（1 盒 = 12 片），没填就是 0，扣减时退回解析规格
    perPack: Number(row.per_pack) || 0,
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
      [m.brand, m.name, m.packSpec, m.unitSpec, m.manufacturer, m.barcode, m.note]
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

/**
 * 按条码查药品信息。
 * 默认用 OpenFoodFacts（免费、免 key，能查到部分进口药与保健品的品名与规格）；
 * 想接自有/付费条码库，在设置里填 medicine.barcodeApi（含 {barcode} 占位）与可选的 medicine.barcodeApiKey。
 */
router.get('/lookup', async (req, res) => {
  const barcode = String(req.query.barcode || '').trim()
  if (!/^\d{6,14}$/.test(barcode)) {
    return res.status(400).json({ error: '条码格式不对，应为 6~14 位数字' })
  }

  const settings = getSettings()
  const tpl = String(settings['medicine.barcodeApi'] || '').trim()
  const key = String(settings['medicine.barcodeApiKey'] || '').trim()

  const url = tpl
    ? tpl.replace(/\{barcode\}/g, encodeURIComponent(barcode))
    : `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)

  try {
    const resp = await fetch(url, {
      headers: key ? { Authorization: key.startsWith('Bearer ') ? key : `Bearer ${key}` } : {},
      signal: controller.signal
    })
    const text = await resp.text()
    // OpenFoodFacts 对未收录的条码直接返回 404，这不是"查询出错"，而是"没这个商品"
    if (resp.status === 404) {
      return res.status(404).json({ error: '条码库没有收录这个药品' })
    }
    if (!resp.ok) {
      return res.status(502).json({ error: `条码库返回 ${resp.status}` })
    }
    let data = null
    try {
      data = JSON.parse(text)
    } catch (err) {
      return res.status(502).json({ error: '条码库返回的不是 JSON' })
    }

    // 自定义接口：假定直接给出 {name, brand, spec} 或嵌在 data 里
    const found = tpl
      ? toFields(data.data || data)
      : data.status === 1 && data.product
        ? toFields(data.product)
        : null

    if (!found || !found.name) {
      return res.status(404).json({ error: '条码库里没有这个药品，手动填一下吧' })
    }
    res.json({ ok: true, data: found })
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: '查询条码超时' })
    res.status(502).json({ error: `查询失败：${err.message}` })
  } finally {
    clearTimeout(timer)
  }
})

/** 把不同条码库的字段统一成 name / brand / packSpec */
function toFields(src) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = src[k]
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim()
    }
    return ''
  }
  const qty = pick('quantity', 'spec', 'size')
  return {
    name: pick('name', 'product_name', 'productName', 'goodsName', 'goods_name'),
    brand: pick('brand', 'brands', 'brandName', 'manuName'),
    packSpec: qty ? (qty.includes('/') ? qty : `${qty}`) : '',
    manufacturer: pick('manufacturer', 'manuName', 'factory', 'producer')
  }
}

/**
 * 用药预警：
 * - 长期服药（long_term=1）：剩余不足 14 天
 * - 短期：剩余量撑不到所选周期结束
 */
router.get('/alerts', (req, res) => {
  const db = getDb()
  const { perPackOf, availableInLoose } = require('../services/medicineStock')

  const todos = db
    .prepare(
      `SELECT t.id, t.title, t.medicine_id, t.dose_count, t.dose_unit, t.long_term, t.target_count,
              r.duration_days
         FROM todo t
         LEFT JOIN reminder_rule r ON r.todo_id = t.id
        WHERE t.kind = 'medicine' AND t.status = 'pending' AND t.medicine_id IS NOT NULL;`
    )
    .all()

  const alerts = []
  const seen = new Set()
  for (const t of todos) {
    const med = db.prepare('SELECT * FROM medicine WHERE id = ?;').get(t.medicine_id)
    if (!med) continue

    const perPack = perPackOf(med.pack_spec, med.loose_unit)
    const available = availableInLoose(med, perPack)
    const perTime = Number(t.dose_count) || 0
    const timesPerDay = Math.max(1, Number(t.target_count) || 1)
    const daily = perTime * timesPerDay
    if (daily <= 0) continue

    const days = available / daily
    const longTerm = Number(t.long_term) === 1
    const cycleDays = Math.max(1, Number(t.duration_days) || 1)

    if (longTerm && days < 14) {
      alerts.push({
        type: 'long',
        medicineId: med.id,
        name: med.name,
        todoId: t.id,
        daysLeft: Math.floor(days),
        message: `长期服药「${med.name}」只够 ${Math.floor(days)} 天，不足两周`
      })
    } else if (!longTerm && available < daily * cycleDays) {
      alerts.push({
        type: 'short',
        medicineId: med.id,
        name: med.name,
        todoId: t.id,
        need: Math.ceil(daily * cycleDays - available),
        cycleDays,
        message: `「${med.name}」剩量不够吃完这 ${cycleDays} 天，还差约 ${Math.ceil(daily * cycleDays - available)} ${med.loose_unit || '份'}`
      })
    }
    seen.add(med.id)
  }

  res.json(alerts)
})

router.get('/units', (req, res) => {
  res.json({ pack: UNITS, loose: LOOSE_UNITS })
})

router.get('/:id', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '药品不存在' })
  const out = shape(row)
  out.batches = batchList(db, req.params.id)
  res.json(out)
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
  if (!text(body.packSpec ?? body.spec, 60)) {
    return res.status(400).json({ error: '每盒（瓶/罐）的规格不能为空' })
  }

  const id = uid()
  const ts = nowIso()
  const expiry = isDate(body.expiryDate) ? body.expiryDate : null
  const amount = readAmount(body)

  db.prepare(
    `INSERT INTO medicine
       (id, brand, name, spec, pack_spec, unit_spec, expiry_date, manufacturer, quantity, unit,
        pack_count, pack_unit, loose_count, loose_unit, per_pack, barcode, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
  ).run(
    id,
    text(body.brand, 40),
    name,
    text(body.packSpec ?? body.spec, 60),
    text(body.packSpec ?? body.spec, 60),
    text(body.unitSpec, 60),
    expiry,
    text(body.manufacturer, 80),
    amount.packCount,
    amount.packUnit,
    amount.packCount,
    amount.packUnit,
    amount.looseCount,
    amount.looseUnit,
    Math.max(0, num(body.perPack)),
    text(body.barcode, 40),
    text(body.note, 500),
    ts,
    ts
  )

  // 首笔库存进批次表，后续增减都以批次为准
  db.prepare(
    'INSERT INTO medicine_batch (id, medicine_id, pack_count, loose_count, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?);'
  ).run(uid(), id, amount.packCount, amount.looseCount, expiry, ts)

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
    pack_spec:
      body.packSpec !== undefined || body.spec !== undefined
        ? text(body.packSpec ?? body.spec, 60)
        : row.pack_spec,
    unit_spec: body.unitSpec !== undefined ? text(body.unitSpec, 60) : row.unit_spec,
    expiry_date:
      body.expiryDate !== undefined ? (isDate(body.expiryDate) ? body.expiryDate : null) : row.expiry_date,
    manufacturer: body.manufacturer !== undefined ? text(body.manufacturer, 80) : row.manufacturer,
    barcode: body.barcode !== undefined ? text(body.barcode, 40) : row.barcode,
    note: body.note !== undefined ? text(body.note, 500) : row.note
  }
  if (!next.name) return res.status(400).json({ error: '药品名不能为空' })
  if (!next.pack_spec) return res.status(400).json({ error: '每盒（瓶/罐）的规格不能为空' })

  db.prepare(
    `UPDATE medicine
     SET brand = ?, name = ?, spec = ?, pack_spec = ?, unit_spec = ?, expiry_date = ?, manufacturer = ?,
         unit = ?, pack_unit = ?, loose_unit = ?, per_pack = ?, barcode = ?, note = ?, updated_at = ?
     WHERE id = ?;`
  ).run(
    next.brand,
    next.name,
    next.pack_spec,
    next.pack_spec,
    next.unit_spec,
    next.expiry_date,
    next.manufacturer,
    amount.packUnit,
    amount.packUnit,
    amount.looseUnit,
    body.perPack !== undefined ? Math.max(0, num(body.perPack)) : row.per_pack,
    next.barcode,
    next.note,
    nowIso(),
    req.params.id
  )

  // 数量改动按「校正总量」处理：多了补进最早批次，少了从最早批次扣
  const oldPack = num(row.pack_count)
  const oldLoose = num(row.loose_count)
  const dPack = amount.packCount - oldPack
  const dLoose = amount.looseCount - oldLoose
  if (dPack > 0 || dLoose > 0) {
    const first = db
      .prepare(
        `SELECT * FROM medicine_batch WHERE medicine_id = ?
         ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC LIMIT 1;`
      )
      .get(req.params.id)
    if (first) {
      db.prepare('UPDATE medicine_batch SET pack_count = ?, loose_count = ? WHERE id = ?;').run(
        num(first.pack_count) + Math.max(0, dPack),
        num(first.loose_count) + Math.max(0, dLoose),
        first.id
      )
    } else {
      db.prepare(
        'INSERT INTO medicine_batch (id, medicine_id, pack_count, loose_count, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?);'
      ).run(uid(), req.params.id, Math.max(0, dPack), Math.max(0, dLoose), next.expiry_date, nowIso())
    }
  }
  if (dPack < 0 || dLoose < 0) {
    takeFromBatches(db, req.params.id, Math.max(0, -dPack), Math.max(0, -dLoose))
  }
  // 编辑时改的有效期，落到最早那批
  if (body.expiryDate !== undefined) {
    const first = db
      .prepare(
        `SELECT id FROM medicine_batch WHERE medicine_id = ?
         ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC LIMIT 1;`
      )
      .get(req.params.id)
    if (first) {
      db.prepare('UPDATE medicine_batch SET expiry_date = ? WHERE id = ?;').run(next.expiry_date, first.id)
    }
  }
  syncTotals(db, req.params.id)

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
  let addPack = 0
  let addLoose = 0
  let usePack = 0
  let useLoose = 0

  if (body.packDelta !== undefined || body.looseDelta !== undefined) {
    const p = num(body.packDelta)
    const l = num(body.looseDelta)
    if (p >= 0) addPack = p
    else usePack = -p
    if (l >= 0) addLoose = l
    else useLoose = -l
  } else {
    const delta = num(body.delta)
    if (delta >= 0) addPack = delta
    else useLoose = -delta // 先扣散装，扣完再扣整件（下面 takeFromBatches 会处理）
  }

  if (addPack > 0 || addLoose > 0) {
    // 补货并到最早批次里，不新开一批
    const first = db
      .prepare(
        `SELECT * FROM medicine_batch WHERE medicine_id = ?
         ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC LIMIT 1;`
      )
      .get(req.params.id)
    if (first) {
      db.prepare('UPDATE medicine_batch SET pack_count = ?, loose_count = ? WHERE id = ?;').run(
        num(first.pack_count) + addPack,
        num(first.loose_count) + addLoose,
        first.id
      )
    } else {
      db.prepare(
        'INSERT INTO medicine_batch (id, medicine_id, pack_count, loose_count, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?);'
      ).run(uid(), req.params.id, addPack, addLoose, row.expiry_date, nowIso())
    }
  }

  if (useLoose > 0) {
    // 按散装单位扣：散装不够自动拆盒（1 盒 12 片，吃 1 片 → 0 盒 11 片）
    const perPack = perPackOf(row.pack_spec, row.loose_unit, row.per_pack)
    takeLooseByAmount(db, req.params.id, useLoose, perPack)
  }
  if (usePack > 0) {
    takeFromBatches(db, req.params.id, usePack, 0)
  }

  syncTotals(db, req.params.id)
  res.json(shape(db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id)))
})

/**
 * 入库：可以一次录多批，每批单独有效期；也可以统一有效期。
 * body: { batches: [{ packCount, looseCount, expiryDate }] }
 */
router.post('/:id/stock-in', (req, res) => {
  const db = getDb()
  const row = db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id)
  if (!row) return res.status(404).json({ error: '药品不存在' })

  const list = Array.isArray(req.body && req.body.batches) ? req.body.batches : []
  const clean = list
    .map((b) => ({
      packCount: Math.max(0, num(b.packCount)),
      looseCount: Math.max(0, num(b.looseCount)),
      expiryDate: isDate(b.expiryDate) ? b.expiryDate : null
    }))
    .filter((b) => b.packCount > 0 || b.looseCount > 0)

  if (!clean.length) return res.status(400).json({ error: '请至少录入一批数量' })

  const ins = db.prepare(
    'INSERT INTO medicine_batch (id, medicine_id, pack_count, loose_count, expiry_date, created_at) VALUES (?, ?, ?, ?, ?, ?);'
  )
  withTx(db, () => {
    for (const b of clean) ins.run(uid(), req.params.id, b.packCount, b.looseCount, b.expiryDate, nowIso())
    syncTotals(db, req.params.id)
  })

  const shaped = shape(db.prepare('SELECT * FROM medicine WHERE id = ?;').get(req.params.id))
  shaped.batches = batchList(db, req.params.id)
  res.json(shaped)
})



router.delete('/:id', (req, res) => {
  const db = getDb()
  db.prepare('DELETE FROM medicine_batch WHERE medicine_id = ?;').run(req.params.id)
  const info = db.prepare('DELETE FROM medicine WHERE id = ?;').run(req.params.id)
  if (!info.changes) return res.status(404).json({ error: '药品不存在' })
  res.json({ ok: true })
})

module.exports = { router, UNITS }
