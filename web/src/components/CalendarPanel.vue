<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import { useBoardStore } from '../stores/board'

const board = useBoardStore()
const openMedicine = inject('openMedicine', () => {})

const now = ref(new Date())
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = new Date()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const clockText = computed(() => dayjs(now.value).format('HH:mm:ss'))

const weekdayCn = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

const selectedDay = computed(() => dayjs(board.selectedDate))
const dayNumber = computed(() => selectedDay.value.date())
const weekdayText = computed(() => weekdayCn[selectedDay.value.day()])

const yearText = computed(() => selectedDay.value.year())
const monthText = computed(() => selectedDay.value.month() + 1)

const dayOfYear = computed(
  () => selectedDay.value.diff(selectedDay.value.startOf('year'), 'day') + 1
)

const weekOfYear = computed(() => {
  const d = selectedDay.value
  const offset = (d.startOf('year').day() + 6) % 7
  return Math.ceil((dayOfYear.value + offset) / 7)
})

const info = computed(() => board.selectedDayInfo)

const showMonthPick = ref(false)
const showHoliday = ref(false)

const pickYear = ref(yearText.value)

function toggleMonthPick() {
  pickYear.value = yearText.value
  showMonthPick.value = !showMonthPick.value
  showHoliday.value = false
}

function chooseMonth(monthIndex) {
  const ym = `${pickYear.value}-${String(monthIndex + 1).padStart(2, '0')}`
  board.setMonth(ym)
  showMonthPick.value = false
}

function shiftPickYear(delta) {
  pickYear.value = Math.min(2100, Math.max(2000, pickYear.value + delta))
}

const holidayData = computed(() => board.holidaysByYear[yearText.value] || null)

const holidayBlocks = computed(() => {
  const data = holidayData.value
  if (!data) return []
  const groups = []
  const dates = Object.keys(data.off || {}).sort()
  let current = null
  for (const date of dates) {
    const name = data.off[date]
    if (name) {
      current = { name, start: date, end: date }
      groups.push(current)
    } else if (current) {
      current.end = date
    }
  }
  return groups.map((g) => ({
    name: g.name,
    range:
      g.start === g.end
        ? dayjs(g.start).format('M月D日')
        : `${dayjs(g.start).format('M月D日')} - ${dayjs(g.end).format('M月D日')}`,
    days: dayjs(g.end).diff(dayjs(g.start), 'day') + 1
  }))
})

const workDays = computed(() =>
  (holidayData.value?.work || []).map((d) => dayjs(d).format('M月D日'))
)

function toggleHoliday() {
  showHoliday.value = !showHoliday.value
  showMonthPick.value = false
}

function onCellClick(cell) {
  board.selectDate(cell.date)
}

function closePopovers(e) {
  if (!e.target.closest('.cal__pop-anchor')) {
    showMonthPick.value = false
    showHoliday.value = false
  }
}

onMounted(() => document.addEventListener('click', closePopovers))
onBeforeUnmount(() => document.removeEventListener('click', closePopovers))

function cellClass(cell) {
  const holiday = board.holidayMap[cell.date]
  const weekend = cell.week === 0 || cell.week === 6
  return {
    'cell--out': !cell.inMonth,
    'cell--today': cell.isToday,
    'cell--sel': cell.date === board.selectedDate,
    'cell--weekend': weekend,
    'cell--off': holiday && holiday.type === 'off',
    'cell--work': holiday && holiday.type === 'work'
  }
}

function badgeOf(date) {
  const h = board.holidayMap[date]
  if (!h) return ''
  return h.type === 'off' ? '休' : '班'
}

function countOf(date) {
  return board.counts[date] || null
}
</script>

<template>
  <section class="cal panel">
    <header class="cal__head">
      <div class="cal__headline">
        <div class="cal__weekday">{{ weekdayText }}</div>
        <div class="cal__daynum-row">
          <span class="cal__daynum">{{ dayNumber }}</span>
          <span v-if="board.isTodaySelected" class="cal__todaytag">今天</span>
        </div>
      </div>

      <div class="cal__meta">
        <div class="cal__ym">{{ yearText }}年{{ monthText }}月</div>
        <div class="cal__days">第 {{ dayOfYear }} 天 · 第 {{ weekOfYear }} 周</div>
      </div>

      <div class="cal__right">
        <button class="cal__med" title="家庭药箱" aria-label="家庭药箱" @click="openMedicine()">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2.4" y="6.2" width="15.2" height="11.2" rx="2.2" stroke="currentColor" stroke-width="1.35" />
            <path d="M7 6.2V4.8A1.6 1.6 0 0 1 8.6 3.2h2.8A1.6 1.6 0 0 1 13 4.8v1.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
            <path d="M10 9.2v5.2M7.4 11.8h5.2" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" />
          </svg>
        </button>

        <div class="cal__clock">
          <div class="cal__time">{{ clockText }}</div>
          <div class="cal__fulldate">{{ selectedDay.format('YYYY-MM-DD') }} {{ weekdayText }}</div>
        </div>
      </div>
    </header>

    <div class="cal__toolbar">
      <button class="cal__nav" aria-label="上一月" @click="board.shiftMonth(-1)">‹</button>

      <div class="cal__pop-anchor">
        <button class="cal__monthbtn" @click.stop="toggleMonthPick">
          {{ yearText }}年{{ monthText }}月
        </button>
        <Transition name="pop">
          <div v-if="showMonthPick" class="cal__pop cal__pop--month" @click.stop>
            <div class="cal__pop-head">
              <button class="cal__pop-nav" @click="shiftPickYear(-1)">‹</button>
              <span>{{ pickYear }}年</span>
              <button class="cal__pop-nav" @click="shiftPickYear(1)">›</button>
            </div>
            <div class="cal__months">
              <button
                v-for="m in 12"
                :key="m"
                class="cal__monthcell"
                :class="{
                  'cal__monthcell--active':
                    pickYear === yearText && m - 1 === selectedDay.month()
                }"
                @click="chooseMonth(m - 1)"
              >
                {{ m }}月
              </button>
            </div>
          </div>
        </Transition>
      </div>

      <button class="cal__nav" aria-label="下一月" @click="board.shiftMonth(1)">›</button>

      <button
        class="cal__today-btn"
        :disabled="board.isTodaySelected && board.month === board.todayStr.slice(0, 7)"
        @click="board.goToday()"
      >
        返回今天
      </button>
    </div>

    <div class="cal__toolbar cal__toolbar--sub">
      <div class="cal__pop-anchor">
        <button class="cal__chip" @click.stop="toggleHoliday">
          放假安排
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path d="M1 3.2 5 7l4-3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </button>
        <Transition name="pop">
          <div v-if="showHoliday" class="cal__pop cal__pop--holiday" @click.stop>
            <div class="cal__pop-title">{{ yearText }} 年放假安排</div>
            <ul v-if="holidayBlocks.length" class="cal__holiday-list">
              <li v-for="b in holidayBlocks" :key="b.name">
                <span class="cal__holiday-name">{{ b.name }}</span>
                <span class="cal__holiday-range">{{ b.range }}</span>
                <span class="cal__holiday-days">{{ b.days }} 天</span>
              </li>
            </ul>
            <p v-else class="cal__pop-empty">该年度暂无内置放假安排</p>
            <div v-if="workDays.length" class="cal__work-line">
              <span class="cal__work-tag">班</span>
              {{ workDays.join('、') }}
            </div>
            <p v-if="holidayData?.source" class="cal__pop-source">{{ holidayData.source }}</p>
          </div>
        </Transition>
      </div>

      <select
        class="cal__select"
        :value="board.weekStart"
        @change="board.updateSettings({ 'calendar.weekStart': Number($event.target.value) })"
      >
        <option :value="1">周一开首</option>
        <option :value="0">周日开首</option>
      </select>

      <button
        class="cal__chip"
        :class="{ 'cal__chip--on': board.showLunar }"
        @click="board.updateSettings({ 'calendar.showLunar': board.showLunar ? 0 : 1 })"
      >
        {{ board.showLunar ? '显示农历' : '隐藏农历' }}
      </button>
    </div>

    <div class="cal__weekhead">
      <span
        v-for="(w, i) in board.weekLabels"
        :key="i"
        :class="{ 'cal__weekhead-item--weekend': w === '六' || w === '日' }"
      >
        {{ w }}
      </span>
    </div>

    <div class="cal__grid">
      <button
        v-for="cell in board.grid"
        :key="cell.date"
        class="cell"
        :class="cellClass(cell)"
        @click="onCellClick(cell)"
      >
        <span v-if="badgeOf(cell.date)" class="cell__badge">{{ badgeOf(cell.date) }}</span>
        <span class="cell__num">{{ cell.day }}</span>
        <span v-if="board.showLunar" class="cell__sub">{{ cell.sub }}</span>
        <span
          v-if="countOf(cell.date)"
          class="cell__dot"
          :class="{ 'cell__dot--done': countOf(cell.date).pending === 0 }"
        >
          {{ countOf(cell.date).total > 9 ? '9+' : countOf(cell.date).total }}
        </span>
      </button>
    </div>

    <footer class="cal__foot">
      <div class="cal__lunar-main">
        {{ info.lunarText }}
        <span v-if="info.jieQi" class="cal__jieqi">{{ info.jieQi }}</span>
        <span v-for="f in info.festivals" :key="f" class="cal__festival">{{ f }}</span>
      </div>
      <div class="cal__ganzhi">
        {{ info.yearGanZhi }}[{{ info.shengxiao }}]年 · {{ info.ganzhiText.split(' ').slice(1).join(' ') }}
      </div>
    </footer>
  </section>
</template>

<style scoped>
.cal {
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: 0.9rem 1rem 0.85rem;
  overflow: hidden;
  position: relative;
}

/* ---- 顶部信息条 ---- */
.cal__head {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid var(--border);
}

.cal__headline {
  flex: none;
}

.cal__weekday {
  font-size: 0.78rem;
  color: var(--text-2);
  letter-spacing: 0.06em;
}

.cal__daynum-row {
  display: flex;
  align-items: baseline;
  gap: 0.3rem;
  margin-top: -0.15rem;
}

.cal__daynum {
  font-size: 2.5rem;
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.cal__todaytag {
  font-size: 0.72rem;
  color: var(--primary);
  background: var(--primary-weak);
  border-radius: 999px;
  padding: 0.1rem 0.4rem;
}

.cal__meta {
  flex: 1;
  min-width: 0;
  padding-top: 0.35rem;
}

.cal__ym {
  font-size: 0.95rem;
  font-weight: 500;
}

.cal__days {
  font-size: 0.72rem;
  color: var(--text-3);
  margin-top: 0.15rem;
}

.cal__right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: none;
}

/* 时间左侧的药箱入口 */
.cal__med {
  width: 1.85rem;
  height: 1.85rem;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-3);
  display: grid;
  place-items: center;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}

.cal__med:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-weak);
}

.cal__clock {
  text-align: right;
  flex: none;
}

.cal__time {
  font-size: 1.5rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  color: var(--primary);
  line-height: 1.2;
}

.cal__fulldate {
  font-size: 0.7rem;
  color: var(--text-3);
  margin-top: 0.1rem;
  font-variant-numeric: tabular-nums;
}

/* ---- 工具栏 ---- */
.cal__toolbar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding-top: 0.6rem;
}

.cal__toolbar--sub {
  padding-top: 0.45rem;
}

.cal__nav {
  width: 2rem;
  height: 2rem;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  font-size: 1.15rem;
  color: var(--text-2);
  background: var(--panel-2);
  flex: none;
}

.cal__nav:hover {
  background: var(--panel-3);
  color: var(--text);
}

.cal__monthbtn {
  height: 2rem;
  padding: 0 0.6rem;
  border-radius: var(--r-sm);
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text);
  background: var(--panel-2);
}

.cal__monthbtn:hover {
  background: var(--panel-3);
}

.cal__today-btn {
  margin-left: auto;
  height: 2rem;
  padding: 0 0.7rem;
  border-radius: var(--r-sm);
  background: var(--primary-weak);
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 500;
}

.cal__today-btn:disabled {
  opacity: 0.42;
  cursor: default;
}

.cal__chip {
  display: inline-flex;
  align-items: center;
  gap: 0.28rem;
  height: 1.8rem;
  padding: 0 0.55rem;
  border-radius: var(--r-sm);
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 0.74rem;
}

.cal__chip:hover {
  background: var(--panel-3);
  color: var(--text);
}

.cal__chip--on {
  background: var(--primary-weak);
  color: var(--primary);
}

.cal__select {
  height: 1.8rem;
  padding: 0 0.3rem;
  border-radius: var(--r-sm);
  border: none;
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 0.74rem;
  outline: none;
}

/* ---- 弹层 ---- */
.cal__pop-anchor {
  position: relative;
  display: inline-flex;
}

.cal__pop {
  position: absolute;
  top: calc(100% + 0.35rem);
  left: 0;
  z-index: 30;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lg);
  padding: 0.6rem;
  width: 15rem;
}

.cal__pop-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.82rem;
  font-weight: 500;
  margin-bottom: 0.45rem;
}

.cal__pop-nav {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: var(--r-sm);
  color: var(--text-2);
}

.cal__pop-nav:hover {
  background: var(--panel-3);
}

.cal__months {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.25rem;
}

.cal__monthcell {
  height: 1.9rem;
  border-radius: var(--r-sm);
  font-size: 0.75rem;
  color: var(--text-2);
}

.cal__monthcell:hover {
  background: var(--panel-3);
}

.cal__monthcell--active {
  background: var(--primary);
  color: var(--on-primary);
}

.cal__pop--holiday {
  width: 17rem;
}

.cal__pop-title {
  font-size: 0.82rem;
  font-weight: 500;
  margin-bottom: 0.45rem;
}

.cal__holiday-list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 14rem;
  overflow-y: auto;
}

.cal__holiday-list li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  padding: 0.22rem 0;
  border-bottom: 1px dashed var(--border);
}

.cal__holiday-list li:last-child {
  border-bottom: none;
}

.cal__holiday-name {
  font-weight: 500;
}

.cal__holiday-range {
  color: var(--text-3);
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.cal__holiday-days {
  color: var(--red);
  font-size: 0.7rem;
}

.cal__work-line {
  margin-top: 0.4rem;
  font-size: 0.72rem;
  color: var(--text-2);
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.cal__work-tag {
  background: var(--panel-3);
  color: var(--text-2);
  border-radius: 3px;
  padding: 0 0.22rem;
  font-size: 0.66rem;
}

.cal__pop-source {
  margin: 0.4rem 0 0;
  font-size: 0.65rem;
  color: var(--text-3);
  line-height: 1.4;
}

.cal__pop-empty {
  margin: 0;
  font-size: 0.75rem;
  color: var(--text-3);
}

/* ---- 星期表头 ---- */
.cal__weekhead {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  padding: 0.45rem 0 0.2rem;
  font-size: 0.72rem;
  color: var(--text-3);
  text-align: center;
}

.cal__weekhead-item--weekend {
  color: var(--red);
}

/* ---- 日期格子 ---- */
.cal__grid {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  grid-template-rows: repeat(6, minmax(0, 1fr));
  gap: 0.15rem;
}

.cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.05rem;
  border-radius: var(--r-sm);
  border: 1.5px solid transparent;
  color: var(--text);
  transition: background 0.14s, border-color 0.14s;
  min-height: 0;
  padding: 0.1rem 0;
}

.cell:hover {
  background: var(--panel-2);
}

.cell__num {
  font-size: 1.08rem;
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
}

.cell__sub {
  font-size: 0.62rem;
  line-height: 1.15;
  color: var(--text-3);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cell__badge {
  position: absolute;
  top: 0.1rem;
  right: 0.1rem;
  font-size: 0.55rem;
  line-height: 1.3;
  padding: 0 0.12rem;
  border-radius: 3px;
  background: var(--red);
  color: #fff;
}

.cell__dot {
  position: absolute;
  bottom: 0.1rem;
  right: 0.2rem;
  min-width: 0.72rem;
  height: 0.72rem;
  padding: 0 0.12rem;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 0.52rem;
  line-height: 0.72rem;
  text-align: center;
}

.cell__dot--done {
  background: var(--green);
}

.cell--out {
  opacity: 0.35;
}

.cell--weekend .cell__num {
  color: var(--red);
}

.cell--off {
  background: var(--red-weak);
}

.cell--off .cell__num {
  color: var(--red);
}

.cell--off .cell__badge {
  background: var(--red);
}

.cell--work .cell__badge {
  background: var(--text-3);
}

.cell--today {
  border-color: var(--amber);
  background: var(--amber-weak);
}

.cell--today .cell__num {
  color: var(--amber);
  font-weight: 500;
}

.cell--sel {
  border-color: var(--primary);
  background: var(--primary-weak);
}

.cell--sel .cell__num {
  color: var(--primary);
  font-weight: 500;
}

.cell--today.cell--sel {
  border-color: var(--primary);
}

/* ---- 底部农历 ---- */
.cal__foot {
  margin-top: 0.5rem;
  padding-top: 0.55rem;
  border-top: 1px solid var(--border);
  flex: none;
}

.cal__lunar-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.82rem;
  font-weight: 500;
}

.cal__jieqi,
.cal__festival {
  font-size: 0.68rem;
  font-weight: 400;
  padding: 0.05rem 0.34rem;
  border-radius: 999px;
  background: var(--green-weak);
  color: var(--green);
}

.cal__festival {
  background: var(--red-weak);
  color: var(--red);
}

.cal__ganzhi {
  font-size: 0.7rem;
  color: var(--text-3);
  margin-top: 0.2rem;
}
</style>
