const BASE = '/api'

async function request(path, { method = 'GET', body, signal } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const init = { method, signal }

  if (body !== undefined) {
    if (isForm) {
      init.body = body
    } else {
      init.headers = { 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
  }

  const res = await fetch(BASE + path, init)
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = { raw: text }
    }
  }

  if (!res.ok) {
    const message = (data && data.error) || `请求失败（HTTP ${res.status}）`
    const err = new Error(message)
    err.status = res.status
    throw err
  }
  return data
}

const qs = (params = {}) => {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') search.set(k, v)
  }
  const s = search.toString()
  return s ? `?${s}` : ''
}

export const api = {
  health: () => request('/health'),
  bootstrap: () => request('/bootstrap'),

  members: {
    list: () => request('/members'),
    create: (payload) => request('/members', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/members/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/members/${id}`, { method: 'DELETE' }),
    reorder: (ids) => request('/members/reorder', { method: 'POST', body: { ids } }),
    uploadAvatar: (id, file) => {
      const fd = new FormData()
      fd.append('avatar', file)
      return request(`/members/${id}/avatar`, { method: 'POST', body: fd })
    },
    resetAvatar: (id) => request(`/members/${id}/avatar`, { method: 'DELETE' })
  },

  phrases: {
    list: (memberId) => request(`/phrases${qs({ memberId })}`),
    create: (payload) => request('/phrases', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/phrases/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/phrases/${id}`, { method: 'DELETE' })
  },

  todos: {
    list: (params) => request(`/todos${qs(params)}`),
    get: (id) => request(`/todos/${id}`),
    create: (payload) => request('/todos', { method: 'POST', body: payload }),
    update: (id, payload) => request(`/todos/${id}`, { method: 'PATCH', body: payload }),
    remove: (id) => request(`/todos/${id}`, { method: 'DELETE' }),
    complete: (id) => request(`/todos/${id}/complete`, { method: 'POST' }),
    skip: (id) => request(`/todos/${id}/skip`, { method: 'POST' }),
    restore: (id) => request(`/todos/${id}/restore`, { method: 'POST' }),
    dailyCounts: (params) => request(`/todos/daily-counts${qs(params)}`),
    memberSummary: (date) => request(`/todos/member-summary${qs({ date })}`)
  },

  reminders: {
    due: (window = 60) => request(`/reminders/due${qs({ window })}`),
    upcoming: () => request('/reminders/upcoming'),
    rule: (todoId) => request(`/reminders/rules/${todoId}`),
    preview: (payload) => request('/reminders/preview', { method: 'POST', body: payload }),
    handle: (id, action) =>
      request(`/reminders/instances/${id}/handle`, { method: 'POST', body: { action } }),
    resync: () => request('/reminders/resync', { method: 'POST' })
  },

  stats: (params) => request(`/stats${qs(params)}`),

  settings: {
    get: () => request('/settings'),
    patch: (payload) => request('/settings', { method: 'PATCH', body: payload })
  },

  calendar: {
    holidays: (year) => request(`/calendar/holidays${qs({ year })}`),
    years: () => request('/calendar/holiday-years'),
    save: (year, payload) => request(`/calendar/holidays/${year}`, { method: 'PUT', body: payload }),
    reset: (year) => request(`/calendar/holidays/${year}`, { method: 'DELETE' })
  },

  backup: {
    export: () => request('/backup/export'),
    import: (payload) => request('/backup/import', { method: 'POST', body: payload })
  }
}

export default api
