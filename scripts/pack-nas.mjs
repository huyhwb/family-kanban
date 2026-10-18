#!/usr/bin/env node
/**
 * 打包「构建镜像所需的最小文件集」，直接产出可上传的 zip。
 *
 * 用法：npm run pack
 * 产物：release/family-kanban-nas.zip（解压后在 NAS 上 docker compose up -d --build）
 *
 * 排除 node_modules / data / 截图 / .git 等。
 * zip 由本脚本自行封装：统一 UTF-8 文件名 + 正斜杠路径，
 * 避免 PowerShell Compress-Archive 在中文文件名和路径分隔符上的坑。
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateRawSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE = join(ROOT, 'release')
const NAME = 'family-kanban-nas'
const OUT = join(RELEASE, NAME)
const ZIP = join(RELEASE, `${NAME}.zip`)

/** 逐文件复制（保持相对路径） */
const FILES = [
  'Dockerfile',
  'docker-compose.yml',
  '.dockerignore',
  'README.md',
  'server/package.json',
  'server/package-lock.json',
  'web/package.json',
  'web/package-lock.json',
  'web/index.html',
  'web/vite.config.js',
  'deploy/nas.env.example',
  'scripts/preflight.sh',
  'docs/NAS-deploy.md',
  'docs/push-to-dockerhub.md',
  'docs/ghcr.md'
]

/** 可选：存在就一起带上（.env 决定端口与数据目录） */
const OPTIONAL = ['.env']

/** 整目录复制 */
const DIRS = ['server/src', 'web/src']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/* ---------------- 1. 复制文件 ---------------- */

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let count = 0
let bytes = 0

for (const rel of FILES) {
  const src = join(ROOT, rel)
  if (!existsSync(src)) {
    console.warn(`  ! 缺少文件，已跳过：${rel}`)
    continue
  }
  const dst = join(OUT, rel)
  mkdirSync(dirname(dst), { recursive: true })
  cpSync(src, dst)
  count += 1
  bytes += statSync(src).size
}

for (const rel of OPTIONAL) {
  const src = join(ROOT, rel)
  if (!existsSync(src)) continue
  cpSync(src, join(OUT, rel))
  count += 1
  bytes += statSync(src).size
}

for (const rel of DIRS) {
  const src = join(ROOT, rel)
  if (!existsSync(src)) {
    console.warn(`  ! 缺少目录，已跳过：${rel}`)
    continue
  }
  // 逐文件复制：不依赖递归 cp（部分环境对递归拷贝有限制）
  for (const from of walk(src)) {
    const outPath = join(OUT, relative(ROOT, from))
    mkdirSync(dirname(outPath), { recursive: true })
    copyFileSync(from, outPath)
    count += 1
    bytes += statSync(from).size
  }
}

// 附一张便签，解压后一眼能看到怎么用
writeFileSync(
  join(OUT, 'README-NAS.txt'),
  '\ufeff' +
    [
      '家庭看板 —— NAS 部署包',
      '',
      '1) 把本目录整个上传到 NAS，例如 /volume1/docker/family-kanban',
      '2) SSH 进去执行：docker compose up -d --build',
      '   或使用群晖 Container Manager / 威联通 Container Station 的「项目」功能',
      '3) 平板访问 http://<NAS的局域网IP>:12333',
      '',
      '详细步骤见同目录下的 docs/NAS-deploy.md',
      '国内网络建议先看该文档第二节「国内网络加速」',
      ''
    ].join('\r\n'),
  'utf8'
)
count += 1

/* ---------------- 2. 打 zip ---------------- */

const entries = walk(OUT).map((abs) => ({
  name: `${NAME}/${relative(OUT, abs).split(sep).join('/')}`,
  data: readFileSync(abs)
}))

const now = new Date()
const dosTime =
  (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()

const chunks = []
const central = []
let offset = 0

for (const entry of entries) {
  const nameBuf = Buffer.from(entry.name, 'utf8')
  const packed = deflateRawSync(entry.data, { level: 9 })
  const crc = crc32(entry.data)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4) // 解压所需版本
  local.writeUInt16LE(0x0800, 6) // bit 11：文件名为 UTF-8
  local.writeUInt16LE(8, 8) // deflate
  local.writeUInt16LE(dosTime, 10)
  local.writeUInt16LE(dosDate, 12)
  local.writeUInt32LE(crc >>> 0, 14)
  local.writeUInt32LE(packed.length, 18)
  local.writeUInt32LE(entry.data.length, 22)
  local.writeUInt16LE(nameBuf.length, 26)
  local.writeUInt16LE(0, 28)

  chunks.push(local, nameBuf, packed)

  const head = Buffer.alloc(46)
  head.writeUInt32LE(0x02014b50, 0)
  head.writeUInt16LE(20, 4) // version made by
  head.writeUInt16LE(20, 6) // version needed
  head.writeUInt16LE(0x0800, 8)
  head.writeUInt16LE(8, 10)
  head.writeUInt16LE(dosTime, 12)
  head.writeUInt16LE(dosDate, 14)
  head.writeUInt32LE(crc >>> 0, 16)
  head.writeUInt32LE(packed.length, 20)
  head.writeUInt32LE(entry.data.length, 24)
  head.writeUInt16LE(nameBuf.length, 28)
  head.writeUInt16LE(0, 30)
  head.writeUInt16LE(0, 32)
  head.writeUInt16LE(0, 34)
  head.writeUInt16LE(0, 36)
  head.writeUInt32LE((0o100644 << 16) >>> 0, 38) // 普通文件 644
  head.writeUInt32LE(offset, 42)

  central.push(head, nameBuf)
  offset += local.length + nameBuf.length + packed.length
}

const cd = Buffer.concat(central)
const eocd = Buffer.alloc(22)
eocd.writeUInt32LE(0x06054b50, 0)
eocd.writeUInt16LE(0, 4)
eocd.writeUInt16LE(0, 6)
eocd.writeUInt16LE(entries.length, 8)
eocd.writeUInt16LE(entries.length, 10)
eocd.writeUInt32LE(cd.length, 12)
eocd.writeUInt32LE(offset, 16)
eocd.writeUInt16LE(0, 20)

rmSync(ZIP, { force: true })
mkdirSync(RELEASE, { recursive: true })
writeFileSync(ZIP, Buffer.concat([...chunks, cd, eocd]))

/* ---------------- 3. 汇报 ---------------- */

const zipKb = (statSync(ZIP).size / 1024).toFixed(0)
console.log('')
console.log(`  打包完成：${relative(ROOT, OUT)}`)
console.log(`  文件数：${count}，原始体积：${(bytes / 1024).toFixed(0)} KB`)
console.log(`  上传用压缩包：${relative(ROOT, ZIP)}（${zipKb} KB）`)
console.log('')
console.log('  下一步：把 zip 上传到 NAS 解压，然后在该目录执行')
console.log('         docker compose up -d --build')
console.log('  详细步骤：docs/NAS-deploy.md')
console.log('')
