import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * 显示适配 store
 *
 * 1) 自动缩放：整个看板以 rem 为单位排版，根字号按「可用尺寸 ÷ 设计基准」实时计算，
 *    宽高两条轴取较小值，保证任何分辨率下都等比缩放、不溢出、不错位。
 * 2) 横竖屏切换：pref = auto / landscape / portrait。
 *    - auto      跟随设备（宽 ≥ 高 → 横屏）
 *    - landscape 强制横屏；若设备当前是竖的，整块面板旋转 90° 铺满屏幕
 *    - portrait  强制竖屏；若设备当前是横的，旋转 90° 铺满屏幕
 * 3) 锁定：锁定后不再跟随设备旋转，始终保持所选方向。
 *
 * 选择存在 localStorage：方向是「这台设备怎么摆」的事，不该跨设备同步。
 */

const KEY = 'kanban.display'

/** 设计基准（rem）：横屏 80×48 → 1280×800/16px；竖屏为其转置 */
const DESIGN = {
  landscape: { w: 80, h: 48 },
  portrait: { w: 48, h: 80 }
}
const FS_MIN = 7.5
const FS_MAX = 28

function readStored() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

export const useDisplayStore = defineStore('display', () => {
  const saved = readStored()

  /** 方向偏好：auto | landscape | portrait */
  const pref = ref(['auto', 'landscape', 'portrait'].includes(saved.pref) ? saved.pref : 'auto')
  /** 是否锁定当前方向 */
  const locked = ref(saved.locked === true)
  /** 需要旋转 90° 时是否反向（false = 顺时针，内容顶边落在屏幕右侧） */
  const reverse = ref(saved.reverse === true)

  const vw = ref(0)
  const vh = ref(0)

  /* ---------------- 派生 ---------------- */

  const natural = computed(() => (vw.value >= vh.value ? 'landscape' : 'portrait'))
  const orientation = computed(() =>
    locked.value && pref.value !== 'auto' ? pref.value : natural.value
  )
  /** 需要整块旋转才能得到所选方向 */
  const turned = computed(() => orientation.value !== natural.value)
  const rotation = computed(() => (turned.value ? (reverse.value ? -90 : 90) : 0))
  const rotateClass = computed(() => {
    if (!turned.value) return ''
    return reverse.value ? 'is-rot270' : 'is-rot90'
  })

  /** 逻辑尺寸：旋转时宽高互换 */
  const layoutW = computed(() => (turned.value ? vh.value : vw.value))
  const layoutH = computed(() => (turned.value ? vw.value : vh.value))

  const fontSize = computed(() => {
    const d = DESIGN[orientation.value]
    if (!layoutW.value || !layoutH.value) return 16
    const base = Math.min(layoutW.value / d.w, layoutH.value / d.h)
    return Math.round(clamp(base, FS_MIN, FS_MAX) * 100) / 100
  })

  /** 当前缩放比例（相对设计基准 16px），用于设置页展示 */
  const scalePercent = computed(() => Math.round((fontSize.value / 16) * 100))

  /* ---------------- 生效 ---------------- */

  function apply() {
    const el = document.documentElement
    const body = document.body
    if (!el || !body) return

    el.style.fontSize = `${fontSize.value}px`
    el.style.setProperty('--stage-w', `${layoutW.value}px`)
    el.style.setProperty('--stage-h', `${layoutH.value}px`)
    el.dataset.orientation = orientation.value
    el.dataset.rotated = turned.value ? String(rotation.value) : '0'

    body.classList.toggle('is-rot90', turned.value && !reverse.value)
    body.classList.toggle('is-rot270', turned.value && reverse.value)
  }

  function measure() {
    const el = document.documentElement
    vw.value = el.clientWidth || window.innerWidth || 0
    vh.value = el.clientHeight || window.innerHeight || 0
    apply()
  }

  function persist() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ pref: pref.value, locked: locked.value, reverse: reverse.value })
      )
    } catch {
      /* 隐私模式下忽略 */
    }
  }

  /* ---------------- 交互 ---------------- */

  /** 在横屏 / 竖屏之间切换（切换即固定） */
  function toggleOrientation() {
    pref.value = orientation.value === 'landscape' ? 'portrait' : 'landscape'
    locked.value = true
    persist()
    apply()
  }

  /** 锁定 / 解锁：解锁后回到跟随设备 */
  function toggleLock() {
    locked.value = !locked.value
    if (!locked.value) pref.value = 'auto'
    persist()
    apply()
  }

  /** 设置方向：auto / landscape / portrait */
  function setPref(next) {
    pref.value = ['auto', 'landscape', 'portrait'].includes(next) ? next : 'auto'
    locked.value = pref.value !== 'auto'
    persist()
    apply()
  }

  function setReverse(next) {
    reverse.value = !!next
    persist()
    apply()
  }

  /* ---------------- 生命周期 ---------------- */

  let raf = 0
  let settleTimers = []
  let started = false

  function schedule() {
    if (raf) cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      raf = 0
      measure()
    })
  }

  function init() {
    measure()
    if (started) return
    started = true

    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', () => {
      schedule()
      // 移动端旋转后视口尺寸有延迟，多补几次
      settleTimers.forEach(clearTimeout)
      settleTimers = [80, 260, 620].map((ms) => setTimeout(() => measure(), ms))
    })
    if (window.screen && window.screen.orientation && window.screen.orientation.addEventListener) {
      window.screen.orientation.addEventListener('change', schedule)
    }
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', schedule)
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => measure()).catch(() => {})
    }
  }

  return {
    pref,
    locked,
    reverse,
    vw,
    vh,
    natural,
    orientation,
    turned,
    rotation,
    rotateClass,
    layoutW,
    layoutH,
    fontSize,
    scalePercent,
    apply,
    measure,
    init,
    toggleOrientation,
    toggleLock,
    setPref,
    setReverse
  }
})
