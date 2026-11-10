'use strict'

const cron = require('node-cron')
const dayjs = require('dayjs')
const { getDb, getSettings } = require('../db')

/**
 * 节假日自动更新。
 *
 * 数据源用 timor.tech 的公开接口（免 key，国内可直连），返回形如：
 *   { holiday: { "01-01": { holiday: true, name: "元旦", date: "2027-01-01" }, ... } }
 * holiday=true 是放假，false 是调休补班。
 *
 * 写入 app_setting 的 holiday.custom.<年>（与「设置 → 放假安排」手动导入同一份存储），
 * 落在数据库里，容器重建不丢。内置的 static/holidays/*.json 保持不动，作为兜底。
 */

const SETTING_KEYS = {
  lastSync: 'holiday.lastSync',
  lastResult: 'holiday.lastResult',
  pending: 'holiday.syncPending'
}

function setSetting(key, value) {
  getDb()
    .prepare(
      `INSERT INTO app_setting (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
    )
    .run(key, value === null || value === undefined ? '' : String(value))
}

function getSetting(key) {
  const row = getDb().prepare('SELECT value FROM app_setting WHERE key = ?;').get(key)
  return row ? row.value : ''
}

function autoEnabled() {
  return String(getSettings()['calendar.autoHoliday'] ?? '1') !== '0'
}

/** 数据源一：holiday-cn，按国务院通知维护，更新最快。优先走 jsDelivr（国内可直连） */
const HOLIDAY_CN_URLS = [
  (y) => `https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${y}.json`,
  (y) => `https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/${y}.json`
]

async function fetchFromHolidayCn(year) {
  const errors = []
  for (const make of HOLIDAY_CN_URLS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const resp = await fetch(make(year), {
        headers: { 'User-Agent': 'family-kanban/holiday-sync' },
        signal: controller.signal
      })
      if (resp.status === 404) throw new Error('该年份暂无数据')
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const days = Array.isArray(data.days) ? data.days : []
      const off = {}
      const work = []
      for (const d of days) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) continue
        if (d.isOffDay) off[d.date] = d.name || '放假'
        else work.push(d.date)
      }
      if (!Object.keys(off).length) throw new Error('该年份暂无数据')
      return { year, off, work, source: 'holiday-cn' }
    } catch (err) {
      errors.push(err.message)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(errors.join(' / '))
}

/** 数据源二：timor.tech（holiday-cn 拉不到时的兜底） */
async function fetchFromTimor(year) {
  const url = `https://timor.tech/api/holiday/year/${year}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'family-kanban/holiday-sync' },
      signal: controller.signal
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    const data = await resp.json()
    if (!data || !data.holiday) throw new Error('返回结构不对')

    const off = {}
    const work = []
    for (const [key, item] of Object.entries(data.holiday)) {
      const date = item.date || `${year}-${key}`
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      if (item.holiday) off[date] = item.name || '放假'
      else work.push(date)
    }
    if (!Object.keys(off).length) throw new Error('该年份暂无数据')
    return { year, off, work, source: 'timor.tech' }
  } finally {
    clearTimeout(timer)
  }
}

/** 依次尝试两个数据源 */
async function fetchYear(year) {
  const errors = []
  for (const fn of [fetchFromHolidayCn, fetchFromTimor]) {
    try {
      return await fn(year)
    } catch (err) {
      errors.push(err.message)
    }
  }
  throw new Error(errors.join(' / '))
}

function saveYear({ year, off, work, source }) {
  const payload = JSON.stringify({
    off,
    work,
    source: `${source || '自动'} 自动更新 ${dayjs().format('YYYY-MM-DD HH:mm')}`
  })
  setSetting(`holiday.custom.${year}`, payload)
}

/**
 * 同步今年与明年。
 * 明年安排一般 11 月才公布，届时会自然补上；没公布就跳过，不算失败。
 */
async function syncHolidays({ years = null } = {}) {
  const thisYear = dayjs().year()
  const targets = years || [thisYear, thisYear + 1]
  const done = []
  const failed = []

  for (const y of targets) {
    try {
      const data = await fetchYear(y)
      saveYear(data)
      done.push({ year: y, off: Object.keys(data.off).length, work: data.work.length })
    } catch (err) {
      failed.push({ year: y, error: err.message })
    }
  }

  const ok = done.length > 0
  const summary = {
    at: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    done,
    failed,
    ok
  }
  setSetting(SETTING_KEYS.lastSync, summary.at)
  setSetting(SETTING_KEYS.lastResult, JSON.stringify(summary))
  // 全失败 → 记待重试，次日再来
  setSetting(SETTING_KEYS.pending, ok ? '0' : '1')
  return summary
}

/**
 * 每天 03:10 检查一次：
 * - 每月 1 号是常规更新日
 * - 其余日子只在「上次失败」时重试
 * 用一个日任务同时覆盖「每月 1 号」和「失败次日重试」，比两个任务更好维护。
 */
function scheduleHolidaySync() {
  cron.schedule(
    '10 3 * * *',
    async () => {
      if (!autoEnabled()) return
      const isFirstDay = dayjs().date() === 1
      const pending = getSetting(SETTING_KEYS.pending) === '1'
      if (!isFirstDay && !pending) return

      const r = await syncHolidays()
      if (r.ok) console.log(`[holiday] 自动更新完成：${r.done.map((d) => d.year).join(', ')}`)
      else console.warn('[holiday] 自动更新失败，明天重试：', r.failed.map((f) => `${f.year} ${f.error}`).join('; '))
    },
    { timezone: 'Asia/Shanghai' }
  )
}

module.exports = { syncHolidays, scheduleHolidaySync, SETTING_KEYS, getSetting }
