'use strict'

const express = require('express')
const { getSettings } = require('../db')

const router = express.Router()

/** 让模型只吐 JSON 的提示词 */
const PROMPT = `你是家庭药箱的录入助手。请识别这张药品外包装照片，提取信息并用 JSON 返回，字段如下：
brand（品牌）、name（药品通用名，不要带品牌和规格）、spec（规格，如 0.25g×24粒/盒）、
expiryDate（有效期至，格式 YYYY-MM-DD；若只印到月份，取该月最后一天）、manufacturer（生产厂家）、
packUnit（整件单位：盒/瓶/袋/罐/支）、looseUnit（拆开后的最小单位：片/粒/袋/支/ml）。
只输出 JSON，不要任何解释；识别不到的字段给空字符串。`

/** 从模型回复里抠出 JSON（兼容 ```json 包裹或前后有多余文字） */
function extractJson(content) {
  if (!content) return null
  let s = String(content).trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(s.slice(start, end + 1))
  } catch (err) {
    return null
  }
}

/** 只保留需要且合法的字段 */
function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null
  const pick = (k) => (raw[k] === null || raw[k] === undefined ? '' : String(raw[k]).trim())
  const out = {
    brand: pick('brand'),
    name: pick('name'),
    spec: pick('spec'),
    expiryDate: pick('expiryDate') || pick('expiry_date'),
    manufacturer: pick('manufacturer'),
    packUnit: pick('packUnit') || '盒',
    looseUnit: pick('looseUnit') || '片'
  }
  // 日期清洗：兼容 2026/05/01、2026年5月1日
  const m = out.expiryDate.match(/(\d{4})\D?(\d{1,2})?\D?(\d{1,2})?/)
  if (m) {
    const y = m[1]
    const mo = String(m[2] || '12').padStart(2, '0')
    const d = m[3] || new Date(Number(y), Number(mo), 0).getDate()
    out.expiryDate = `${y}-${mo}-${String(d).padStart(2, '0')}`
  } else {
    out.expiryDate = ''
  }
  return out
}

/**
 * 图片识别录入：接收 dataURL，转发给 OpenAI 兼容接口（默认 Agnes）。
 * 模型、地址、密钥都在「设置」里配置，不写死在前端。
 */
router.post('/medicine', async (req, res) => {
  const settings = getSettings()
  const baseUrl = String(settings['medicine.aiBaseUrl'] || '').replace(/\/+$/, '')
  const apiKey = String(settings['medicine.aiKey'] || '').trim()
  const model = String(settings['medicine.aiModel'] || 'agnes-2.5-flash').trim()
  const image = req.body && req.body.image

  if (!baseUrl) return res.status(400).json({ error: '未配置 AI 接口地址，请到「设置 → 药箱识别」填写' })
  if (!apiKey) return res.status(400).json({ error: '未配置 AI 密钥，请到「设置 → 药箱识别」填写' })
  if (!image || typeof image !== 'string' || !image.startsWith('data:image/')) {
    return res.status(400).json({ error: '请提供有效的图片' })
  }
  // 常见手机照片压缩后仍在 1MB 内，超过 6MB 直接拒绝，避免把模型请求撑爆
  if (image.length > 8 * 1024 * 1024) {
    return res.status(413).json({ error: '图片过大，请压缩后再试' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90000)

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: image } }
            ]
          }
        ]
      }),
      signal: controller.signal
    })

    const bodyText = await resp.text()
    if (!resp.ok) {
      let msg = bodyText.slice(0, 200)
      try {
        const j = JSON.parse(bodyText)
        msg = j.error?.message || j.message || msg
      } catch (err) {
        /* 保持原始文本 */
      }
      return res.status(502).json({ error: `AI 接口返回 ${resp.status}：${msg}` })
    }

    let content = ''
    try {
      const data = JSON.parse(bodyText)
      content = data.choices?.[0]?.message?.content || ''
      if (Array.isArray(content)) content = content.map((c) => c.text || '').join('')
    } catch (err) {
      return res.status(502).json({ error: 'AI 返回的不是合法 JSON' })
    }

    const fields = normalize(extractJson(content))
    if (!fields) {
      return res.status(502).json({ error: 'AI 没能从图片里读出药品信息，换一张更清晰的正面照试试' })
    }
    res.json({ ok: true, data: fields, raw: String(content).slice(0, 2000) })
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI 识别超时（90 秒），请稍后重试' })
    }
    res.status(502).json({ error: `调用 AI 接口失败：${err.message}` })
  } finally {
    clearTimeout(timer)
  }
})

/** 简单连通性测试，设置页用 */
router.post('/ping', async (req, res) => {
  const settings = getSettings()
  const baseUrl = String(settings['medicine.aiBaseUrl'] || '').replace(/\/+$/, '')
  const apiKey = String(settings['medicine.aiKey'] || '').trim()
  const model = String(settings['medicine.aiModel'] || 'agnes-2.5-flash').trim()
  if (!baseUrl || !apiKey) return res.status(400).json({ error: '请先填写接口地址与密钥' })

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 8,
        messages: [{ role: 'user', content: '只回复 ok' }]
      })
    })
    const t = await resp.text()
    if (!resp.ok) return res.status(502).json({ error: `返回 ${resp.status}：${t.slice(0, 160)}` })
    res.json({ ok: true, reply: t.slice(0, 160) })
  } catch (err) {
    res.status(502).json({ error: `连接失败：${err.message}` })
  }
})

module.exports = { router }
