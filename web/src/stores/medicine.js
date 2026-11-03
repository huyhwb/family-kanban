import { defineStore } from 'pinia'
import api from '../api/client'

/**
 * 家庭药箱。
 * 列表在后端按「已过期 → 临期 → 正常 → 缺货」排好序，前端只管展示。
 */
export const useMedicineStore = defineStore('medicine', {
  state: () => ({
    items: [],
    stats: { total: 0, expired: 0, soon: 0, empty: 0, warnDays: 30 },
    filter: 'all',
    keyword: '',
    loading: false,
    loaded: false,
    error: ''
  }),

  getters: {
    isEmpty: (s) => s.loaded && !s.items.length,
    statusText: () => (m) => {
      if (m.status === 'expired') return '已过期'
      if (m.status === 'soon') return m.daysLeft === 0 ? '今天到期' : `还剩 ${m.daysLeft} 天`
      if (m.status === 'empty') return '已用完'
      return m.daysLeft === null ? '未填保质期' : `还剩 ${m.daysLeft} 天`
    }
  },

  actions: {
    async load({ silent = false } = {}) {
      if (!silent) this.loading = true
      try {
        const [list, stats] = await Promise.all([
          api.medicines.list({ q: this.keyword || undefined, filter: this.filter }),
          api.medicines.stats()
        ])
        this.items = list || []
        this.stats = stats
        this.loaded = true
        this.error = ''
      } catch (err) {
        this.error = err.message
      } finally {
        this.loading = false
      }
    },

    async setFilter(next) {
      this.filter = next
      await this.load()
    },

    async setKeyword(next) {
      this.keyword = next
      await this.load({ silent: true })
    },

    async save(payload, id = null) {
      const saved = id ? await api.medicines.update(id, payload) : await api.medicines.create(payload)
      await this.load({ silent: true })
      return saved
    },

    async remove(id) {
      await api.medicines.remove(id)
      await this.load({ silent: true })
    },

    async adjust(id, delta) {
      const next = await api.medicines.adjust(id, delta)
      const idx = this.items.findIndex((m) => m.id === id)
      if (idx >= 0) this.items[idx] = next
      this.stats = await api.medicines.stats()
      return next
    }
  }
})
