import { defineStore } from 'pinia'
import dayjs from 'dayjs'
import api from '../api/client'
import { buildMonthGrid, dayInfo, weekHeader, WEEKDAYS_FULL } from '../lib/lunar'

const DATE_FMT = 'YYYY-MM-DD'

export const useBoardStore = defineStore('board', {
  state: () => ({
    ready: false,
    loading: false,
    busy: false,
    error: '',
    online: true,

    members: [],
    settings: {},
    version: '',

    todayStr: dayjs().format(DATE_FMT),
    selectedDate: dayjs().format(DATE_FMT),
    selectedMemberId: 'all',
    month: dayjs().format('YYYY-MM'),
    viewMode: 'quadrant',

    todos: [],
    counts: {},
    memberCounts: {},
    unassignedCount: 0,

    holidaysByYear: {},
    holidayYears: []
  }),

  getters: {
    weekStart: (s) => Number(s.settings['calendar.weekStart'] ?? 1),
    showLunar: (s) => String(s.settings['calendar.showLunar'] ?? '1') !== '0',
    theme: (s) => s.settings['ui.theme'] || 'light',

    visibleMembers: (s) => s.members.filter((m) => m.visibleOnHome),

    selectedMember(state) {
      if (state.selectedMemberId === 'all') return null
      return state.members.find((m) => m.id === state.selectedMemberId) || null
    },

    memberMap: (s) => {
      const map = {}
      for (const m of s.members) map[m.id] = m
      return map
    },

    grid: (s) => buildMonthGrid(s.month, Number(s.settings['calendar.weekStart'] ?? 1)),
    weekLabels: (s) => weekHeader(Number(s.settings['calendar.weekStart'] ?? 1)),

    selectedDayInfo: (s) => dayInfo(s.selectedDate),
    selectedWeekdayText: (s) => WEEKDAYS_FULL[dayjs(s.selectedDate).day()],

    monthLabel: (s) => `${dayjs(`${s.month}-01`).year()}年${dayjs(`${s.month}-01`).month() + 1}月`,

    isTodaySelected: (s) => s.selectedDate === s.todayStr,

    pendingCount: (s) => s.todos.filter((t) => t.status === 'pending').length,
    doneCount: (s) => s.todos.filter((t) => t.status !== 'pending').length,

    quadrants(state) {
      const buckets = { 1: [], 2: [], 3: [], 4: [], null: [] }
      for (const t of state.todos) {
        const k = t.quadrant == null ? null : Number(t.quadrant)
        ;(buckets[k] || buckets[null]).push(t)
      }
      return buckets
    },

    holidayMap(state) {
      const year = Number(state.selectedDate.slice(0, 4))
      const data = state.holidaysByYear[year]
      const map = {}
      if (!data) return map
      for (const [date, name] of Object.entries(data.off || {})) {
        map[date] = { type: 'off', name: name || '' }
      }
      for (const date of data.work || []) {
        map[date] = { type: 'work', name: '' }
      }
      return map
    },

    filterSummary(state) {
      const d = dayjs(state.selectedDate)
      const dateText = d.isSame(dayjs(), 'day') ? '今天' : `${d.month() + 1}月${d.date()}日`
      const member = state.selectedMemberId === 'all'
        ? '全部成员'
        : (state.members.find((m) => m.id === state.selectedMemberId)?.name || '未知成员')
      return `${dateText} · ${member}`
    }
  },

  actions: {
    applyTheme() {
      document.documentElement.setAttribute('data-theme', this.theme)
    },

    async bootstrap() {
      this.loading = true
      this.error = ''
      try {
        const data = await api.bootstrap()
        this.members = data.members
        this.settings = data.settings
        this.version = data.version || ''
        this.todayStr = data.today
        this.selectedDate = data.today
        this.month = data.today.slice(0, 7)
        this.todos = data.todos
        this.counts = Object.fromEntries(
          (data.dailyCounts || []).map((c) => [c.date, c])
        )
        if (data.memberCounts) {
          this.memberCounts = data.memberCounts.byMember || {}
          this.unassignedCount = data.memberCounts.unassigned || 0
        }
        this.online = true
        this.ready = true
        this.applyTheme()
        await this.loadHolidays(Number(data.today.slice(0, 4)))
      } catch (err) {
        this.error = err.message
        this.online = false
      } finally {
        this.loading = false
      }
    },

    async refreshTodos() {
      if (this.busy) return
      this.busy = true
      try {
        const [todos, summary] = await Promise.all([
          api.todos.list({ date: this.selectedDate, memberId: this.selectedMemberId }),
          api.todos.memberSummary(this.selectedDate)
        ])
        this.todos = todos
        this.memberCounts = summary.byMember || {}
        this.unassignedCount = summary.unassigned || 0
        this.online = true
      } catch (err) {
        this.error = err.message
        this.online = false
      } finally {
        this.busy = false
      }
    },

    async refreshCounts() {
      const start = dayjs(`${this.month}-01`).startOf('month').format(DATE_FMT)
      const end = dayjs(`${this.month}-01`).endOf('month').format(DATE_FMT)
      try {
        const rows = await api.todos.dailyCounts({
          from: start,
          to: end,
          memberId: this.selectedMemberId
        })
        this.counts = Object.fromEntries(rows.map((r) => [r.date, r]))
      } catch (err) {
        /* 角标失败不影响主流程 */
      }
    },

    async loadHolidays(year) {
      if (this.holidaysByYear[year]) return
      try {
        const data = await api.calendar.holidays(year)
        this.holidaysByYear = { ...this.holidaysByYear, [year]: data }
      } catch (err) {
        /* 静默失败，日历照常显示 */
      }
    },

    async ensureHolidayYear(year) {
      if (!this.holidaysByYear[year]) await this.loadHolidays(year)
    },

    async selectDate(dateStr) {
      if (!dateStr) return
      this.selectedDate = dateStr
      const targetMonth = dateStr.slice(0, 7)
      if (targetMonth !== this.month) {
        this.month = targetMonth
        await this.ensureHolidayYear(Number(dateStr.slice(0, 4)))
        await this.refreshCounts()
      }
      await this.refreshTodos()
    },

    async selectMember(memberId) {
      this.selectedMemberId = memberId
      await Promise.all([this.refreshTodos(), this.refreshCounts()])
    },

    async goToday() {
      this.month = this.todayStr.slice(0, 7)
      await this.loadHolidays(Number(this.todayStr.slice(0, 4)))
      this.selectedDate = this.todayStr
      await Promise.all([this.refreshTodos(), this.refreshCounts()])
    },

    async shiftMonth(delta) {
      const next = dayjs(`${this.month}-01`).add(delta, 'month')
      this.month = next.format('YYYY-MM')
      await this.ensureHolidayYear(next.year())
      await this.refreshCounts()
    },

    async setMonth(yearMonth) {
      this.month = yearMonth
      await this.ensureHolidayYear(Number(yearMonth.slice(0, 4)))
      await this.refreshCounts()
    },

    setViewMode(mode) {
      this.viewMode = mode
    },

    async createTodo(payload) {
      const created = await api.todos.create(payload)
      if (created.dueDate.slice(0, 7) === this.month) await this.refreshCounts()
      if (created.dueDate === this.selectedDate) {
        await this.refreshTodos()
      }
      return created
    },

    async updateTodo(id, payload) {
      const updated = await api.todos.update(id, payload)
      await this.refreshTodos()
      await this.refreshCounts()
      return updated
    },

    async removeTodo(id) {
      await api.todos.remove(id)
      await Promise.all([this.refreshTodos(), this.refreshCounts()])
    },

    /** memberId 只在多人事项里用：指明是谁完成的 */
    async setTodoStatus(id, action, memberId = null) {
      let updated = null
      if (action === 'done') updated = await api.todos.complete(id, memberId)
      else if (action === 'skip') updated = await api.todos.skip(id)
      else updated = await api.todos.restore(id, memberId)
      await Promise.all([this.refreshTodos(), this.refreshCounts()])
      return updated
    },

    async updateSettings(patch) {
      const res = await api.settings.patch(patch)
      this.settings = res.settings
      this.applyTheme()
      return res
    },

    async reloadMembers() {
      this.members = await api.members.list()
      if (
        this.selectedMemberId !== 'all' &&
        !this.members.some((m) => m.id === this.selectedMemberId)
      ) {
        this.selectedMemberId = 'all'
      }
    },

    /** 跨天检测：每分钟检查一次日期是否变化 */
    checkDateRollover() {
      const now = dayjs().format(DATE_FMT)
      if (now !== this.todayStr) {
        const wasTodaySelected = this.selectedDate === this.todayStr
        this.todayStr = now
        if (wasTodaySelected) {
          this.selectedDate = now
          this.month = now.slice(0, 7)
          this.refreshTodos()
          this.refreshCounts()
        }
      }
    }
  }
})
