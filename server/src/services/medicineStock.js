'use strict'

const dayjs = require('dayjs')
const { getDb } = require('../db')
const { nowIso } = require('../lib/util')

/**
 * 药箱库存的读写都走批次表 medicine_batch，
 * 药品主表上的 pack_count / loose_count / expiry_date 只是汇总缓存。
 */

/** 按批次汇总回 medicine（总量 + 最早待用批次的有效期） */
function syncTotals(db, medicineId) {
  const rows = db.prepare('SELECT * FROM medicine_batch WHERE medicine_id = ?;').all(medicineId)
  const pack = rows.reduce((n, r) => n + (Number(r.pack_count) || 0), 0)
  const loose = rows.reduce((n, r) => n + (Number(r.loose_count) || 0), 0)
  const today = dayjs().format('YYYY-MM-DD')
  const dated = rows
    .filter((r) => r.expiry_date)
    .sort((a, b) => (a.expiry_date < b.expiry_date ? -1 : 1))
  // 优先用还没过期的最近批次；全过期就取最早那批，让用户看到红字
  const next = dated.find((r) => r.expiry_date >= today) || dated[0]
  db.prepare(
    'UPDATE medicine SET pack_count = ?, loose_count = ?, quantity = ?, expiry_date = ?, updated_at = ? WHERE id = ?;'
  ).run(pack, loose, pack, next ? next.expiry_date : null, nowIso(), medicineId)
  return { pack, loose }
}

/** 最早到期的批次优先扣（先散装再整件） */
function takeFromBatches(db, medicineId, usePack, useLoose) {
  let pack = usePack
  let loose = useLoose
  const rows = db
    .prepare(
      `SELECT * FROM medicine_batch
       WHERE medicine_id = ? AND (pack_count > 0 OR loose_count > 0)
       ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC;`
    )
    .all(medicineId)

  const upd = db.prepare('UPDATE medicine_batch SET pack_count = ?, loose_count = ? WHERE id = ?;')
  for (const r of rows) {
    if (pack <= 0 && loose <= 0) break
    let bp = Number(r.pack_count) || 0
    let bl = Number(r.loose_count) || 0
    if (loose > 0) {
      const cut = Math.min(bl, loose)
      bl -= cut
      loose -= cut
    }
    if (pack > 0) {
      const cut = Math.min(bp, pack)
      bp -= cut
      pack -= cut
    }
    upd.run(bp, bl, r.id)
  }
  return { packLeft: pack, looseLeft: loose }
}

function batchList(db, medicineId) {
  return db
    .prepare(
      `SELECT * FROM medicine_batch WHERE medicine_id = ?
       ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC;`
    )
    .all(medicineId)
    .map((b) => ({
      id: b.id,
      packCount: Number(b.pack_count) || 0,
      looseCount: Number(b.loose_count) || 0,
      expiryDate: b.expiry_date || null
    }))
}

/**
 * 从「0.25g×24粒/盒」这类规格里解析出每包装含多少个散装单位。
 * 解析不出来返回 0（调用方就只按散装算可用量）。
 */
function perPackOf(packSpec, looseUnit, perPack) {
  const explicit = Number(perPack) || 0
  if (explicit > 0) return explicit
  const spec = String(packSpec || '')
  if (!spec) return 0
  const unit = String(looseUnit || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    unit ? new RegExp(`[×x*]\\s*(\\d+(?:\\.\\d+)?)\\s*${unit}`) : null,
    unit ? new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${unit}\\s*/\\s*(盒|瓶|袋|罐|支)`) : null,
    /[×x*]\s*(\d+(?:\.\d+)?)/
  ].filter(Boolean)
  for (const re of patterns) {
    const m = spec.match(re)
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return 0
}

/** 药品当前可用量，折算成散装单位（片/袋/ml） */
function availableInLoose(medicine, perPack) {
  const loose = Number(medicine.loose_count) || 0
  const pack = Number(medicine.pack_count) || 0
  return loose + (perPack > 0 ? pack * perPack : 0)
}

/**
 * 按散装单位扣减，自动拆盒：
 * 0 盒 0 片 + 每盒 12 片，吃 1 片 → 拆一盒 → 0 盒 11 片。
 * 从最早到期的批次开始扣，返回还差多少（缺货时 > 0）。
 */
function takeLooseByAmount(db, medicineId, need, perPack) {
  let remaining = Math.max(0, Number(need) || 0)
  if (remaining <= 0) return 0

  const rows = db
    .prepare(
      `SELECT * FROM medicine_batch
       WHERE medicine_id = ? AND (pack_count > 0 OR loose_count > 0)
       ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC;`
    )
    .all(medicineId)

  const upd = db.prepare('UPDATE medicine_batch SET pack_count = ?, loose_count = ? WHERE id = ?;')
  for (const r of rows) {
    if (remaining <= 0) break
    let bp = Number(r.pack_count) || 0
    let bl = Number(r.loose_count) || 0

    // 先用现成的散装
    const useLoose = Math.min(bl, remaining)
    bl -= useLoose
    remaining -= useLoose

    // 还不够就拆盒（每拆一盒补 perPack 个散装）
    if (remaining > 0 && perPack > 0) {
      while (remaining > 0 && bp > 0) {
        bp -= 1
        bl += perPack
        const take = Math.min(bl, remaining)
        bl -= take
        remaining -= take
      }
    }
    upd.run(bp, bl, r.id)
  }
  return remaining
}

/**
 * 按「每次用量 × 次数」扣库存。
 * 单位与散装单位一致时按散装扣；一盒没拆也能自动折盒（perPack）。
 * 返回 { ok, shortage }，shortage>0 表示库存不够、只扣到 0。
 */
function consumeByDose(medicineId, amount, unit) {
  const db = getDb()
  const med = db.prepare('SELECT * FROM medicine WHERE id = ?;').get(medicineId)
  if (!med) return { ok: false, shortage: amount, available: 0, reason: '药品不存在' }

  const perPack = perPackOf(med.pack_spec, med.loose_unit || unit, med.per_pack)
  const available = availableInLoose(med, perPack)
  const need = Math.max(0, Number(amount) || 0)
  const shortage = Math.max(0, need - available)

  // 散装不够时自动拆盒，拆开的部分留在 loose 里，不会凭空蒸发
  takeLooseByAmount(db, medicineId, Math.min(need, available), perPack)
  syncTotals(db, medicineId)
  return { ok: shortage <= 0, shortage, available }
}

/**
 * 撤回时把用量补回库存（补成散装，加到最早那批）。
 * 与 consumeByDose 对称，避免"点错了库存却少一份"。
 */
function refundDose(medicineId, amount) {
  const db = getDb()
  const med = db.prepare('SELECT * FROM medicine WHERE id = ?;').get(medicineId)
  if (!med) return false
  const qty = Math.max(0, Number(amount) || 0)
  if (!qty) return false

  const first = db
    .prepare(
      `SELECT * FROM medicine_batch WHERE medicine_id = ?
       ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date ASC, created_at ASC LIMIT 1;`
    )
    .get(medicineId)

  if (first) {
    db.prepare('UPDATE medicine_batch SET loose_count = ? WHERE id = ?;').run(
      (Number(first.loose_count) || 0) + qty,
      first.id
    )
  } else {
    db.prepare(
      'INSERT INTO medicine_batch (id, medicine_id, pack_count, loose_count, expiry_date, created_at) VALUES (?, ?, 0, ?, ?, ?);'
    ).run(require('../lib/util').uid(), medicineId, qty, med.expiry_date || null, nowIso())
  }
  syncTotals(db, medicineId)
  return true
}

module.exports = {
  takeLooseByAmount,
  refundDose,
  syncTotals,
  takeFromBatches,
  batchList,
  perPackOf,
  availableInLoose,
  consumeByDose
}
