import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import api from '../api/client'

const POLL_MS = 10000

export const useReminderStore = defineStore('reminder', {
  state: () => ({
    due: [],
    upcoming: [],
    active: null,
    handled: new Set(),
    timer: null,
    polling: false,
    lastError: ''
  }),

  getters: {
    hasActive: (s) => !!s.active,
    activeTitle: (s) => (s.active ? s.active.title : ''),
    pendingCount: (s) => s.due.length
  },

  actions: {
    async poll() {
      if (this.polling) return
      this.polling = true
      try {
        const [dueRes, upcoming] = await Promise.all([
          api.reminders.due(60),
          api.reminders.upcoming()
        ])
        const now = dayjs()
        this.due = (dueRes.items || []).filter((it) => {
          if (this.handled.has(it.id)) return false
          return !dayjs(it.fire_at).isAfter(now)
        })
        this.upcoming = upcoming || []
        this.lastError = ''
        this.promote()
      } catch (err) {
        this.lastError = err.message
      } finally {
        this.polling = false
      }
    },

    promote() {
      if (this.active) return
      const next = this.due.find((it) => !this.handled.has(it.id))
      if (next) this.active = next
    },

    dismissCurrent() {
      if (this.active) this.handled.add(this.active.id)
      this.active = null
      this.due = this.due.filter((it) => !this.handled.has(it.id))
      this.promote()
    },

    async handle(action) {
      const current = this.active
      if (!current) return
      try {
        await api.reminders.handle(current.id, action)
      } catch (err) {
        this.lastError = err.message
      }
      this.dismissCurrent()
      try {
        await api.reminders.upcoming().then((u) => {
          this.upcoming = u || []
        })
      } catch {
        /* 忽略 */
      }
    },

    start() {
      if (this.timer) return
      this.poll()
      this.timer = setInterval(() => this.poll(), POLL_MS)
    },

    stop() {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }
})
