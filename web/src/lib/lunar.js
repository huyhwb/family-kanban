import dayjs from 'dayjs'
import LunarLib from 'lunar-javascript'

// lunar-javascript 为 UMD 包，统一取出 Solar 构造器，兼容不同打包形态
const Solar = LunarLib.Solar || (LunarLib.default && LunarLib.default.Solar)

const cache = new Map()

export const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
export const WEEKDAYS_FULL = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日']

/**
 * 节日白名单：农历库内置了大量国际日（世界粮食日、世界邮政日等），
 * 全量展示会让日期格严重拥挤，这里只保留中国法定与传统节日 + 家庭场景常用的感恩类节日。
 */
const FESTIVAL_WHITELIST = new Set([
  '元旦',
  '情人节',
  '妇女节',
  '植树节',
  '愚人节',
  '劳动节',
  '青年节',
  '儿童节',
  '建党节',
  '建军节',
  '教师节',
  '国庆节',
  '平安夜',
  '圣诞节',
  '母亲节',
  '父亲节',
  '感恩节',
  '除夕',
  '春节',
  '元宵节',
  '龙头节',
  '清明节',
  '端午节',
  '七夕节',
  '中元节',
  '中秋节',
  '重阳节',
  '腊八节',
  '小年'
])

const keepFestivals = (list) => (list || []).filter((f) => FESTIVAL_WHITELIST.has(f))

/**
 * 取某一天的日历展示信息。
 * 单元格副标题优先级：节气 > 公历节日 > 农历节日 > 农历日（初一显示月份）
 */
export function dayInfo(dateStr) {
  const hit = cache.get(dateStr)
  if (hit) return hit

  const [y, m, d] = dateStr.split('-').map(Number)
  let info
  try {
    const solar = Solar.fromYmd(y, m, d)
    const lunar = solar.getLunar()
    const solarFestivals = keepFestivals(solar.getFestivals())
    const lunarFestivals = keepFestivals(lunar.getFestivals())
    const jieQi = lunar.getJieQi() || ''

    let sub = ''
    let kind = 'lunar'
    if (jieQi) {
      sub = jieQi
      kind = 'jieqi'
    } else if (solarFestivals.length) {
      sub = solarFestivals[0]
      kind = 'festival'
    } else if (lunarFestivals.length) {
      sub = lunarFestivals[0]
      kind = 'festival'
    } else {
      const dayCn = lunar.getDayInChinese()
      sub = dayCn === '初一' ? `${lunar.getMonthInChinese()}月` : dayCn
    }

    info = {
      date: dateStr,
      day: d,
      sub,
      kind,
      lunarDay: lunar.getDayInChinese(),
      lunarMonth: lunar.getMonthInChinese(),
      lunarText: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
      ganzhiText: `${lunar.getYearInGanZhi()}年 ${lunar.getMonthInGanZhi()}月 ${lunar.getDayInGanZhi()}日`,
      yearGanZhi: lunar.getYearInGanZhi(),
      shengxiao: lunar.getYearShengXiao(),
      jieQi,
      week: dayjs(dateStr).day(),
      festivals: [...solarFestivals, ...lunarFestivals]
    }
  } catch (err) {
    info = {
      date: dateStr,
      day: d,
      sub: '',
      kind: 'lunar',
      lunarText: '',
      ganzhiText: '',
      yearGanZhi: '',
      shengxiao: '',
      jieQi: '',
      week: dayjs(dateStr).day(),
      festivals: []
    }
  }

  cache.set(dateStr, info)
  return info
}

/**
 * 生成月视图网格（固定 6 行 × 7 列，避免切换月份时高度跳动）
 * @param {string} yearMonth YYYY-MM
 * @param {number} weekStart 0=周日 1=周一
 */
export function buildMonthGrid(yearMonth, weekStart = 1) {
  const first = dayjs(`${yearMonth}-01`)
  const month = first.month()
  const lead = (first.day() - weekStart + 7) % 7
  const start = first.subtract(lead, 'day')
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = start.add(i, 'day')
    const dateStr = d.format('YYYY-MM-DD')
    cells.push({
      ...dayInfo(dateStr),
      date: dateStr,
      inMonth: d.month() === month,
      isToday: d.isSame(dayjs(), 'day')
    })
  }
  return cells
}

export function weekHeader(weekStart = 1) {
  const out = []
  for (let i = 0; i < 7; i++) out.push(WEEKDAYS[(weekStart - 1 + i + 7) % 7])
  return out
}
