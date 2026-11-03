'use strict'

const path = require('path')
const { getDriver } = require('./driver')
const { migrations } = require('./schema')
const { uid, nowIso, DATA_DIR, ensureDirs } = require('../lib/util')

let db = null
let driverName = ''

/** 默认设置项 */
const DEFAULT_SETTINGS = {
  'calendar.weekStart': 1,
  'calendar.showLunar': 1,
  'ui.theme': 'light',
  'ui.soundEnabled': 1,
  'reminder.defaultTimesPerDay': 1,
  'reminder.defaultIntervalHours': 8,
  'reminder.defaultDurationDays': 1,
  'reminder.snoozeMinutes': 10,
  'holiday.dataYear': 2026,
  // 药箱 AI 识别：默认走 Agnes（完全兼容 OpenAI 协议）
  'medicine.aiBaseUrl': 'https://api.agnes-ai.cn/v1',
  'medicine.aiModel': 'agnes-2.5-flash',
  'medicine.aiKey': '',
  'medicine.warnDays': 30
}

/** 内置角色与默认常用语 */
const DEFAULT_MEMBERS = [
  { role_key: 'grandpa', name: '爷爷', preset: 'grandpa', phrases: ['吃降压药', '量血压', '去公园散步'] },
  { role_key: 'grandma', name: '奶奶', preset: 'grandma', phrases: ['吃钙片', '跳广场舞', '买菜'] },
  { role_key: 'dad', name: '爸爸', preset: 'dad', phrases: ['上班打卡', '开会', '加油'] },
  { role_key: 'mom', name: '妈妈', preset: 'mom', phrases: ['做饭', '取快递', '瑜伽'] },
  { role_key: 'sister', name: '姐姐', preset: 'sister', phrases: ['写作业', '练琴', '背单词'] },
  { role_key: 'brother', name: '弟弟', preset: 'brother', phrases: ['写作业', '刷牙', '收拾书包'] }
]

function migrate(conn) {
  const row = conn.prepare('PRAGMA user_version;').get()
  const current = row ? Number(row.user_version || Object.values(row)[0] || 0) : 0
  for (let v = current; v < migrations.length; v++) {
    // SQLite 支持事务内 DDL：单个迁移失败则整版回滚，避免半套结构
    conn.exec('BEGIN;')
    try {
      conn.exec(migrations[v])
      conn.exec(`PRAGMA user_version = ${v + 1};`)
      conn.exec('COMMIT;')
      console.log(`[db] 已应用迁移 v${v + 1}`)
    } catch (err) {
      conn.exec('ROLLBACK;')
      throw new Error(`数据库迁移 v${v + 1} 失败：${err.message}`)
    }
  }
}

function seed(conn) {
  const count = conn.prepare('SELECT COUNT(*) AS c FROM member;').get().c
  if (count === 0) {
    const insMember = conn.prepare(
      `INSERT INTO member (id, role_key, name, avatar_preset, avatar_file, sort_order, visible_on_home, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, 1, ?);`
    )
    const insPhrase = conn.prepare(
      'INSERT INTO phrase (id, member_id, text, sort_order) VALUES (?, ?, ?, ?);'
    )
    DEFAULT_MEMBERS.forEach((m, i) => {
      const id = uid()
      insMember.run(id, m.role_key, m.name, m.preset, i + 1, nowIso())
      m.phrases.forEach((text, j) => insPhrase.run(uid(), id, text, j + 1))
    })
    console.log(`[db] 已写入 ${DEFAULT_MEMBERS.length} 位默认成员及其常用语`)
  }

  const insSetting = conn.prepare(
    'INSERT INTO app_setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING;'
  )
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insSetting.run(key, String(value))
  }
}

function getDb() {
  if (db) return db
  ensureDirs()
  const file = path.join(DATA_DIR, 'kanban.db')
  const driver = getDriver()
  driverName = driver.name
  db = driver.open(file)
  migrate(db)
  seed(db)
  console.log(`[db] 驱动=${driverName} 文件=${file}`)
  return db
}

function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM app_setting;').all()
  const out = {}
  for (const r of rows) out[r.key] = r.value
  return out
}

/**
 * 事务包装（可嵌套）。
 * SQLite 不支持嵌套 BEGIN，嵌套调用时直接执行，由最外层负责提交/回滚。
 */
function withTx(db, fn) {
  if (db.__txDepth > 0) return fn()
  db.__txDepth = 1
  db.exec('BEGIN;')
  try {
    const result = fn()
    db.exec('COMMIT;')
    return result
  } catch (err) {
    try {
      db.exec('ROLLBACK;')
    } catch {
      /* 回滚失败时保留原始错误 */
    }
    throw err
  } finally {
    db.__txDepth = 0
  }
}

module.exports = {
  getDb,
  getSettings,
  withTx,
  DEFAULT_SETTINGS,
  getDriverName: () => driverName
}
