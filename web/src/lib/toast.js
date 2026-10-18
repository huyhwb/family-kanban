import { reactive } from 'vue'

export const toastState = reactive({ items: [] })

let seq = 0

export function toast(message, type = 'info', duration = 2400) {
  const id = ++seq
  toastState.items.push({ id, message, type })
  window.setTimeout(() => {
    const index = toastState.items.findIndex((t) => t.id === id)
    if (index >= 0) toastState.items.splice(index, 1)
  }, duration)
  return id
}

export const toastError = (message, duration) => toast(message, 'error', duration)
export const toastOk = (message, duration) => toast(message, 'ok', duration)
