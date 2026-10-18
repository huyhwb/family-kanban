'use strict'

/**
 * SQLite 驱动适配层。
 *
 * 优先使用 better-sqlite3（Docker 镜像内的正式方案）；
 * 若本机无法安装原生模块，则自动回退到 Node 22 内置的 node:sqlite，
 * 使项目在没有编译工具链的机器上也能直接运行。
 *
 * 对外暴露统一接口，全部 SQL 只使用 `?` 位置参数，规避两种驱动在具名参数上的差异。
 */

let cached = null

function createDriver() {
  try {
    const Database = require('better-sqlite3')
    const probe = new Database(':memory:')
    probe.close()
    return { name: 'better-sqlite3', open: openBetterSqlite3 }
  } catch (err) {
    try {
      require('node:sqlite')
      return { name: 'node:sqlite', open: openNodeSqlite }
    } catch (err2) {
      throw new Error(
        '未找到可用的 SQLite 驱动：better-sqlite3 安装失败且当前 Node 版本不支持 node:sqlite。'
      )
    }
  }
}

function openBetterSqlite3(file) {
  const Database = require('better-sqlite3')
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return {
    raw: db,
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    close: () => db.close()
  }
}

function openNodeSqlite(file) {
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  return {
    raw: db,
    exec: (sql) => db.exec(sql),
    prepare: (sql) => db.prepare(sql),
    close: () => db.close()
  }
}

function getDriver() {
  if (!cached) cached = createDriver()
  return cached
}

module.exports = { getDriver }
