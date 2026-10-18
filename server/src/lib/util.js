'use strict'

const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const dayjs = require('dayjs')

const uid = () => crypto.randomUUID()

const nowIso = () => dayjs().format('YYYY-MM-DDTHH:mm:ss')

const today = () => dayjs().format('YYYY-MM-DD')

/** 解析项目根目录（server/src/db -> 项目根） */
const projectRoot = path.resolve(__dirname, '..', '..', '..')

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(projectRoot, 'data')

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')

function ensureDirs() {
  for (const dir of [DATA_DIR, UPLOAD_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

/** 校验 YYYY-MM-DD */
function isDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
}

/** 校验 HH:mm */
function isTime(v) {
  return typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

function asInt(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

module.exports = {
  uid,
  nowIso,
  today,
  isDate,
  isTime,
  asInt,
  projectRoot,
  DATA_DIR,
  UPLOAD_DIR,
  ensureDirs
}
