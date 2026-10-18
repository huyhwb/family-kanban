/**
 * 提示音：使用 Web Audio 实时合成，无需外部音频文件。
 * 浏览器要求首次用户交互后才能播放，故提供 unlock() 供任意点击时调用。
 */

let ctx = null
let unlocked = false

function getCtx() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  return ctx
}

export function unlock() {
  const ac = getCtx()
  if (!ac) return false
  if (ac.state === 'suspended') ac.resume()
  if (!unlocked) {
    // 播放一个极短的静音节点，完成解锁
    const osc = ac.createOscillator()
    const gain = ac.createGain()
    gain.gain.value = 0
    osc.connect(gain)
    gain.connect(ac.destination)
    osc.start()
    osc.stop(ac.currentTime + 0.01)
    unlocked = true
  }
  return true
}

export function isUnlocked() {
  return unlocked
}

/**
 * 播放提示音：三声上行铃音，间隔均匀，约 1.5 秒
 */
export function playChime({ repeat = 1, volume = 0.28 } = {}) {
  const ac = getCtx()
  if (!ac) return false
  if (ac.state === 'suspended') ac.resume()

  const base = ac.currentTime + 0.05
  const notes = [
    { f: 783.99, t: 0.0, d: 0.34 },
    { f: 1046.5, t: 0.18, d: 0.36 },
    { f: 1318.51, t: 0.36, d: 0.62 }
  ]

  for (let r = 0; r < repeat; r++) {
    const offset = r * 1.6
    for (const n of notes) {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.value = n.f

      const start = base + offset + n.t
      const end = start + n.d
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, end)

      osc.connect(gain)
      gain.connect(ac.destination)
      osc.start(start)
      osc.stop(end + 0.02)
    }
  }
  return true
}
