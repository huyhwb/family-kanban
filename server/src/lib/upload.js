'use strict'

const path = require('path')
const crypto = require('crypto')
const multerPkg = require('multer')
const multer = multerPkg.default || multerPkg
const { UPLOAD_DIR, ensureDirs } = require('./util')

ensureDirs()

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MAX_BYTES = 2 * 1024 * 1024

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const raw = path.extname(file.originalname || '').toLowerCase()
    const ext = ALLOWED_EXT.has(raw) ? raw : '.png'
    cb(null, `${crypto.randomUUID()}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_BYTES },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) {
      cb(new Error('仅支持图片文件（png / jpg / webp / gif）'))
      return
    }
    cb(null, true)
  }
})

module.exports = { upload, UPLOAD_DIR, MAX_BYTES }
