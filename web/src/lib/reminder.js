import dayjs from 'dayjs'

/** 星期显示名（索引 = ISO 星期 - 1） */
export const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日']

export function isoWeekday(d) {
  const w = d.day() // dayjs: 0=周日
  return w === 0 ? 7 : w
}

/** 统一的重复方式文案（与后端 describePattern 保持一致） */
export function patternLabel(rule) {
  if (!rule) return ''
  const pattern = rule.pattern || 'daily'
  if (pattern === 'weekly') {
    const days = Array.isArray(rule.weekdays) ? rule.weekdays : []
    if (!days.length) return '每天'
    return `每周${days.map((d) => WEEKDAY_NAMES[d - 1]).join('、')}`
  }
  if (pattern === 'workdays') {
    return Number(rule.workWeek) === 6 ? '六天工作制' : '五天工作制'
  }
  if (pattern === 'restdays') {
    return Number(rule.workWeek) === 6 ? '单休' : '双休'
  }
  if (pattern === 'yearly') {
    return rule.yearlyKind === 'lunar' ? '每年（农历）' : '每年'
  }
  return '每天'
}

/** 某天是否命中规则 */
export function ruleMatchesDay(dateStr, rule) {
  const pattern = rule.pattern || 'daily'
  if (pattern === 'daily') return true
  const d = dayjs(dateStr)
  if (!d.isValid()) return false
  const iso = isoWeekday(d)
  if (pattern === 'weekly') {
    const days = Array.isArray(rule.weekdays) ? rule.weekdays : []
    if (!days.length) return true
    return days.includes(iso)
  }
  const workWeek = Number(rule.workWeek) === 6 ? 6 : 5
  if (pattern === 'workdays') return iso <= workWeek
  if (pattern === 'restdays') return iso === 7 || iso > workWeek
  return true
}

/**
 * 统计一条规则会触发多少次。
 * rule 需要 startDate / timesPerDay / durationDays / pattern / weekdays / workWeek
 */
export function ruleFireCount(rule) {
  if (!rule || !rule.startDate) return 0
  const base = dayjs(rule.startDate)
  if (!base.isValid()) return 0
  const perDay = Math.max(1, Number(rule.timesPerDay) || 1)
  const days = Math.max(1, Number(rule.durationDays) || 1)
  let matched = 0
  for (let i = 0; i < days; i++) {
    if (ruleMatchesDay(base.add(i, 'day').format('YYYY-MM-DD'), rule)) matched++
  }
  return matched * perDay
}
