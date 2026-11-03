<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { toastError } from '../lib/toast'

const emit = defineEmits(['detected'])

const video = ref(null)
const status = ref('正在启动摄像头…')
const error = ref('')
const running = ref(false)
const failed = ref(false)
const hint = ref('把药盒背面的条码对准取景框')

/** 只有 https 或 localhost 才允许常驻摄像头 */
const canLive = computed(
  () => window.isSecureContext && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
)

let stream = null
let controls = null
let detector = null
let rafId = null
let stopped = false

function cleanup() {
  stopped = true
  if (rafId) cancelAnimationFrame(rafId)
  rafId = null
  if (controls) {
    try {
      controls.stop()
    } catch (err) {
      /* ignore */
    }
    controls = null
  }
  if (stream) {
    stream.getTracks().forEach((t) => t.stop())
    stream = null
  }
  if (video.value) video.value.srcObject = null
}

function finish(code) {
  if (!code) return
  const text = String(code).trim()
  if (!text) return
  cleanup()
  running.value = false
  emit('detected', text)
}

/** 原生 BarcodeDetector（安卓 Chrome 可用，速度快） */
async function startNative() {
  detector = new window.BarcodeDetector({
    formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code']
  })
  const tick = async () => {
    if (stopped || !video.value) return
    try {
      const codes = await detector.detect(video.value)
      if (codes && codes.length) {
        finish(codes[0].rawValue)
        return
      }
    } catch (err) {
      /* 单帧失败忽略 */
    }
    rafId = requestAnimationFrame(tick)
  }
  status.value = '正在识别条码…'
  tick()
}

/** 兜底：zxing 动态加载，避免拖慢首屏 */
async function startZxing() {
  const { BrowserMultiFormatReader } = await import('@zxing/browser')
  const reader = new BrowserMultiFormatReader()
  status.value = '正在识别条码…'
  try {
    controls = await reader.decodeFromVideoElement(video.value, (result) => {
      if (result) finish(result.getText())
    })
  } catch (err) {
    // 部分浏览器不支持该重载，退回逐帧解码
    throw err
  }
}

async function startLive() {
  error.value = ''
  running.value = true
  stopped = false
  status.value = '正在启动摄像头…'
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
      audio: false
    })
    if (video.value) {
      video.value.srcObject = stream
      await video.value.play().catch(() => {})
    }
    if ('BarcodeDetector' in window) {
      try {
        await startNative()
        return
      } catch (err) {
        /* 落到 zxing */
      }
    }
    await startZxing()
  } catch (err) {
    running.value = false
    cleanup()
    // 打不开摄像头（无设备 / 权限拒绝）就退回拍照识别，别留个黑框
    failed.value = true
    error.value =
      err && err.name === 'NotAllowedError'
        ? '摄像头权限被拒绝，请改用拍照识别'
        : `无法打开摄像头：${err.message || err}`
  }
}

/* ---- 拍照 / 选图解码（http 访问时的替代方案） ---- */
const fileInput = ref(null)
const decoding = ref(false)

function pickPhoto() {
  if (fileInput.value) fileInput.value.click()
}

async function onPhoto(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  decoding.value = true
  status.value = '正在识别图片中的条码…'
  try {
    const url = URL.createObjectURL(file)
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const reader = new BrowserMultiFormatReader()
    const result = await reader.decodeFromImageUrl(url)
    URL.revokeObjectURL(url)
    if (result) finish(result.getText())
  } catch (err) {
    toastError('图片里没有识别到条码，换个角度再拍一张')
  } finally {
    decoding.value = false
  }
}

onMounted(() => {
  if (canLive.value) startLive()
  else status.value = ''
})

onBeforeUnmount(cleanup)
</script>

<template>
  <div class="sc">
    <!-- 支持常驻摄像头：实时扫码 -->
    <template v-if="canLive && !failed">
      <div class="sc__stage">
        <video ref="video" class="sc__video" playsinline muted />
        <div class="sc__frame" />
        <p class="sc__status">{{ status }}</p>
      </div>
      <p class="sc__hint">{{ hint }}</p>
      <div class="sc__actions">
        <button class="sc__btn" @click="startLive">重新扫描</button>
        <button class="sc__btn sc__btn--ghost" @click="pickPhoto">从相册选图</button>
      </div>
    </template>

    <!-- 非 https：浏览器不允许常驻摄像头，改为拍照识别 -->
    <template v-else>
      <div class="sc__fallback">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.2a2 2 0 0 0 1.7-.95l.5-.8A2 2 0 0 1 10.6 3h2.8a2 2 0 0 1 1.7.95l.5.8A2 2 0 0 0 17.3 6h1.2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9Z"
            stroke="currentColor"
            stroke-width="1.4"
          />
          <circle cx="12" cy="13" r="3.6" stroke="currentColor" stroke-width="1.4" />
        </svg>
        <p class="sc__fallback-title">
          {{ failed ? '摄像头打不开，改用拍照识别' : '当前通过 http 访问，浏览器不允许常驻摄像头' }}
        </p>
        <p class="sc__fallback-desc">
          用平板拍一张药盒背面的条码，系统会从照片里解出条码。
          想用实时扫码，需要给看板配 https。
        </p>
        <button class="sc__btn sc__btn--primary" :disabled="decoding" @click="pickPhoto">
          {{ decoding ? '识别中…' : '拍照 / 选择图片' }}
        </button>
        <p v-if="status" class="sc__status">{{ status }}</p>
      </div>
    </template>

    <p v-if="error" class="sc__error">{{ error }}</p>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      capture="environment"
      class="sc__file"
      @change="onPhoto"
    />
  </div>
</template>

<style scoped>
.sc {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.sc__stage {
  position: relative;
  border-radius: var(--r-md);
  overflow: hidden;
  background: #000;
  aspect-ratio: 4 / 3;
}

.sc__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.sc__frame {
  position: absolute;
  inset: 22% 12%;
  border: 2px solid rgba(255, 255, 255, 0.9);
  border-radius: 0.5rem;
  box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.28);
}

.sc__status {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0.5rem;
  text-align: center;
  font-size: 0.7rem;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

.sc__hint {
  font-size: 0.7rem;
  color: var(--text-3);
  text-align: center;
}

.sc__actions {
  display: flex;
  gap: 0.5rem;
  justify-content: center;
}

.sc__btn {
  padding: 0.45rem 0.9rem;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--panel-2);
  font-size: 0.78rem;
  color: var(--text-2);
}

.sc__btn--primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--on-primary);
}

.sc__btn--ghost {
  background: transparent;
}

.sc__fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
  padding: 1.4rem 1rem;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  background: var(--panel-2);
  color: var(--text-3);
  text-align: center;
}

.sc__fallback-title {
  font-size: 0.8rem;
  color: var(--text);
  font-weight: 500;
}

.sc__fallback-desc {
  font-size: 0.7rem;
  line-height: 1.6;
  max-width: 24rem;
}

.sc__error {
  font-size: 0.72rem;
  color: var(--red);
  text-align: center;
}

.sc__file {
  display: none;
}
</style>
