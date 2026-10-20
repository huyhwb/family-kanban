<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { Solar, Lunar } from 'lunar-javascript'
import api from '../api/client'
import { useBoardStore } from '../stores/board'
import { avatarSrcOf } from '../lib/avatars'
import { toastError, toastOk } from '../lib/toast'

const props = defineProps({
  open: { type: Boolean, default: false },
  todo: { type: Object, default: null }
})

const emit = defineEmits(['update:open', 'saved'])

const board = useBoardStore()

const QUADRANTS = [
  { key: null, name: '不分类', tone: 'none' },
  { key: 1, name: '重要且紧急', tone: 'urgent' },
  { key: 2, name: '重要不紧急', tone: 'plan' },
  { key: 3, name: '不重要但紧急', tone: 'delegate' },
  { key: 4, name: '不重要不紧急', tone: 'later' }
]

/* ---- 重复方式 ---- */
const PATTERNS = [
  { key: 'daily', name: '每天' },
  { key: 'weekly', name: '每周' },
  { key: 'workdays', name: '工作日' },
  { key: 'restdays', name: '非工作日' },
  { key: 'yearly', name: '纪念日' }
]

const WEEKDAY_LABELS = [
  { iso: 1, name: '一' },
  { iso: 2, name: '二' },
  { iso: 3, name: '三' },
  { iso: 4, name: '四' },
  { iso: 5, name: '五' },
  { iso: 6, name: '六' },
  { iso: 7, name: '日' }
]

const DURATION_PRESETS = [3, 7, 14, 30]

const isEdit = computed(() => !!props.todo)

/** 编辑的是重复任务展开出来的某一天：日期由提醒计划排定，不给手改 */
const isSeriesDay = computed(() => !!props.todo?.seriesId)

/** 当前是否在配一个纪念日（提醒必须开着，否则退回普通待办） */
const isYearly = computed(() => form.reminderEnabled && form.pattern === 'yearly')

const form = reactive({
  title: '',
  dueDate: '',
  dueTime: '',
  endTime: '',
  memberIds: [],
  quadrant: null,
  note: '',
  reminderEnabled: false,
  startTime: '08:00',
  // 系列副本编辑时要用"根的起始日"，否则会把整个计划挪到当天
  reminderStartDate: '',
  timesPerDay: 1,
  intervalHours: 8,
  durationDays: 1,
  pattern: 'daily',
  yearlyKind: 'solar',
  weekdays: [1, 3, 5],
  workWeek: 5
})

const phrases = ref([])
const saving = ref(false)
const errorMsg = ref('')
const reminderEl = ref(null)

/** 打开提醒开关后把预览滚进视野，避免「提示看不完全」 */
async function revealPreview() {
  await nextTick()
  const box = reminderEl.value
  if (!box) return
  const scroller = box.closest('.ed__body')
  if (!scroller) return
  // 只滚动弹窗主体，避免 scrollIntoView 连带滚动内部 overflow 容器
  const boxRect = box.getBoundingClientRect()
  const bodyRect = scroller.getBoundingClientRect()
  const delta = boxRect.bottom - bodyRect.bottom + 10
  if (delta > 0) scroller.scrollTop += delta
}

watch(
  () => form.reminderEnabled,
  (on) => {
    if (on) revealPreview()
  }
)

function defaults() {
  return {
    startTime: '08:00',
    timesPerDay: Number(board.settings['reminder.defaultTimesPerDay']) || 1,
    intervalHours: Number(board.settings['reminder.defaultIntervalHours']) || 8,
    durationDays: Number(board.settings['reminder.defaultDurationDays']) || 1
  }
}

function resetForm() {
  const t = props.todo
  const d = defaults()
  form.title = ''
  form.dueTime = ''
  form.endTime = ''
  form.quadrant = null
  form.note = ''
  form.reminderEnabled = false
  form.pattern = 'daily'
  form.yearlyKind = 'solar'
  form.weekdays = [1, 3, 5]
  form.workWeek = 5
  form.startTime = d.startTime
  form.timesPerDay = d.timesPerDay
  form.intervalHours = d.intervalHours
  form.durationDays = d.durationDays

  if (t) {
    form.title = t.title || ''
    form.dueDate = t.dueDate
    form.dueTime = t.dueTime || ''
    form.endTime = t.endTime || ''
    form.memberIds = Array.isArray(t.memberIds)
      ? [...t.memberIds]
      : t.memberId
        ? [t.memberId]
        : []
    form.quadrant = t.quadrant ?? null
    form.note = t.note || ''
    if (t.reminder) {
      form.reminderEnabled = !!t.reminder.enabled
      form.startTime = t.reminder.startTime || d.startTime
      form.reminderStartDate = t.reminder.startDate || t.dueDate
      form.timesPerDay = t.reminder.timesPerDay || d.timesPerDay
      form.intervalHours = t.reminder.intervalHours || d.intervalHours
      form.durationDays = t.reminder.durationDays || d.durationDays
      form.pattern = t.reminder.pattern || 'daily'
      form.yearlyKind = t.reminder.yearlyKind === 'lunar' ? 'lunar' : 'solar'
      form.workWeek = Number(t.reminder.workWeek) === 6 ? 6 : 5
      const wd = Array.isArray(t.reminder.weekdays) ? t.reminder.weekdays : []
      form.weekdays = wd.length ? wd : [1, 3, 5]
    } else {
      form.startTime = t.dueTime || d.startTime
    }
  } else {
    form.dueDate = board.selectedDate
    form.memberIds = board.selectedMemberId === 'all' ? [] : [board.selectedMemberId]
  }
  errorMsg.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      resetForm()
      loadPhrases()
    }
  }
)

watch(
  () => form.memberIds.join(','),
  () => {
    if (props.open) loadPhrases()
  }
)

async function loadPhrases() {
  try {
    const key = form.memberIds.length === 1 ? form.memberIds[0] : 'any'
    const rows = await api.phrases.list(key)
    // 未指派 / 多人时会汇集全员常用语，按文本去重后最多展示 10 条，避免 chip 区过长
    const seen = new Set()
    phrases.value = rows
      .filter((p) => {
        if (!p.text || seen.has(p.text)) return false
        seen.add(p.text)
        return true
      })
      .slice(0, 10)
  } catch {
    phrases.value = []
  }
}

function applyPhrase(text) {
  form.title = form.title ? `${form.title} ${text}` : text
}

function onDueDateChange() {
  if (!form.dueTime) form.startTime = form.startTime || '08:00'
}

/* ---- 成员多选 ---- */
function toggleMember(id) {
  const idx = form.memberIds.indexOf(id)
  if (idx >= 0) form.memberIds.splice(idx, 1)
  else form.memberIds.push(id)
}

function clearMembers() {
  form.memberIds.splice(0, form.memberIds.length)
}

/* ---- 星期多选 ---- */
function toggleWeekday(iso) {
  const idx = form.weekdays.indexOf(iso)
  if (idx >= 0) form.weekdays.splice(idx, 1)
  else form.weekdays.push(iso)
  form.weekdays.sort((a, b) => a - b)
}

function quickWeekdays(kind) {
  if (kind === 'work') form.weekdays = [1, 2, 3, 4, 5]
  else if (kind === 'weekend') form.weekdays = [6, 7]
  else if (kind === 'all') form.weekdays = [1, 2, 3, 4, 5, 6, 7]
  else if (kind === 'clear') form.weekdays = []
}

/** 切换重复方式：非「每天」时若持续天数还是 1 天，自动给到一个月，避免只触发一次 */
function setPattern(key) {
  form.pattern = key
  if (key === 'yearly') {
    // 纪念日一年一次：次数与持续天数没有意义，也不进四象限
    form.timesPerDay = 1
    form.durationDays = 1
    form.quadrant = null
  } else if (key !== 'daily' && Number(form.durationDays) < 7) {
    form.durationDays = 30
  }
  revealPreview()
}

/* ---- 本地预览（与后端 computeFireTimes 同一套口径） ---- */
function isoWeekday(d) {
  const w = d.day()
  return w === 0 ? 7 : w
}

function dayMatches(d) {
  const iso = isoWeekday(d)
  if (form.pattern === 'weekly') return form.weekdays.includes(iso)
  if (form.pattern === 'workdays') return iso <= form.workWeek
  if (form.pattern === 'restdays') return iso === 7 || iso > form.workWeek
  return true
}

/** 纪念日：本地按公历 / 农历各推若干年，仅取"下次"起的日期用于预览 */
const YEARLY_PREVIEW_YEARS = 10

function yearlyPreview() {
  const base = dayjs(form.dueDate)
  if (!base.isValid()) return []
  const time = form.startTime || '08:00'
  const today = dayjs().startOf('day')
  const todayLunarYear = Solar.fromYmd(today.year(), today.month() + 1, today.date()).getLunar().getYear()
  const out = []

  if (form.yearlyKind === 'lunar') {
    const lunar = Solar.fromYmd(base.year(), base.month() + 1, base.date()).getLunar()
    const month = Math.abs(lunar.getMonth())
    const day = lunar.getDay()
    const fromYear = Math.max(lunar.getYear(), todayLunarYear - 1)
    for (let i = 0; i < YEARLY_PREVIEW_YEARS + 2; i++) {
      try {
        const s = Lunar.fromYmd(fromYear + i, month, day).getSolar()
        out.push(dayjs(`${s.toYmd()} ${time}`))
      } catch (err) {
        /* 该年没有这一天 */
      }
    }
  } else {
    const fromYear = Math.max(base.year(), today.year() - 1)
    for (let i = 0; i < YEARLY_PREVIEW_YEARS + 2; i++) {
      const y = fromYear + i
      const dim = dayjs(`${y}-${base.month() + 1}-01`).daysInMonth()
      out.push(dayjs(`${y}-${base.month() + 1}-${Math.min(base.date(), dim)} ${time}`))
    }
  }

  // 只保留今天及以后的，纪念日是「不限时长」，没有末次
  return out.filter((d) => !d.isBefore(today, 'day')).slice(0, YEARLY_PREVIEW_YEARS)
}

/** 纪念日的农历表述，用于预览文案 */
const yearlyLunarLabel = computed(() => {
  const base = dayjs(form.dueDate)
  if (!base.isValid()) return ''
  const lunar = Solar.fromYmd(base.year(), base.month() + 1, base.date()).getLunar()
  return `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`
})

const previewTimes = computed(() => {
  if (!form.reminderEnabled) return []
  if (form.pattern === 'yearly') return yearlyPreview()

  const base = dayjs(`${form.dueDate} ${form.startTime || '08:00'}`)
  if (!base.isValid()) return []
  if (form.pattern === 'weekly' && !form.weekdays.length) return []

  const perDay = Math.max(1, Number(form.timesPerDay) || 1)
  const interval = Math.max(0.25, Number(form.intervalHours) || 8)
  const days = Math.max(1, Number(form.durationDays) || 1)

  const out = []
  for (let i = 0; i < days && out.length < 500; i++) {
    const dayStart = base.add(i, 'day')
    if (!dayMatches(dayStart)) continue
    for (let j = 0; j < perDay && out.length < 500; j++) {
      out.push(dayStart.add(Math.round(j * interval * 60), 'minute'))
    }
  }
  return out
})

const patternLabel = computed(() => {
  if (form.pattern === 'weekly') {
    if (!form.weekdays.length) return '未选择星期'
    return `每周${form.weekdays.map((d) => WEEKDAY_LABELS[d - 1].name).join('、')}`
  }
  if (form.pattern === 'workdays') {
    return form.workWeek === 6 ? '六天工作制（周一至周六）' : '五天工作制（周一至周五）'
  }
  if (form.pattern === 'restdays') {
    return form.workWeek === 6 ? '单休（每周日）' : '双休（每周六、日）'
  }
  if (form.pattern === 'yearly') {
    return form.yearlyKind === 'lunar' ? '每年（农历）' : '每年'
  }
  return '每天'
})

const perDayLabel = computed(() => {
  if (form.pattern === 'yearly') {
    return form.yearlyKind === 'lunar' ? `农历 ${yearlyLunarLabel.value}` : '公历同月同日'
  }
  const n = Math.max(1, Number(form.timesPerDay) || 1)
  return n === 1 ? '每天 1 次' : `每天 ${n} 次，间隔 ${Number(form.intervalHours) || 0} 小时`
})

/** 每天多次时提示「勾几次才算完成」 */
const repeatHint = computed(() => {
  if (form.pattern === 'yearly') return ''
  const n = Math.max(1, Number(form.timesPerDay) || 1)
  if (!form.reminderEnabled || n <= 1) return ''
  return `每天 ${n} 次 → 待办需勾选 ${n} 次才算完成`
})

const previewNotice = computed(() => {
  if (!form.reminderEnabled) return ''
  if (form.pattern === 'weekly' && !form.weekdays.length) return '请至少选择一个星期'
  if (!previewTimes.value.length) {
    return '按当前设置在持续天数内没有任何匹配的日子，请延长持续天数或调整重复方式'
  }
  return ''
})

const previewHead = computed(() => {
  const list = previewTimes.value
  if (!list.length) return []
  const fmt = form.pattern === 'yearly' ? 'YYYY-MM-DD' : 'MM-DD HH:mm'
  return list.slice(0, 6).map((t) => t.format(fmt))
})

const previewRange = computed(() => {
  const list = previewTimes.value
  if (list.length < 2) return ''
  if (form.pattern === 'yearly') {
    return `首次 ${list[0].format('YYYY-MM-DD')} · 末次 ${list[list.length - 1].format('YYYY-MM-DD')}`
  }
  return `首次 ${list[0].format('MM-DD HH:mm')} · 末次 ${list[list.length - 1].format('MM-DD HH:mm')}`
})

function close() {
  emit('update:open', false)
}

async function submit() {
  errorMsg.value = ''
  const title = form.title.trim()
  if (!title) {
    errorMsg.value = '请填写待办标题'
    return
  }
  if (!form.dueDate) {
    errorMsg.value = '请选择日期'
    return
  }
  if (form.reminderEnabled && !form.startTime) {
    errorMsg.value = '请设置提醒开始时间'
    return
  }
  if (form.reminderEnabled && form.pattern === 'weekly' && !form.weekdays.length) {
    errorMsg.value = '请至少选择一个星期'
    return
  }
  if (form.reminderEnabled && !previewTimes.value.length) {
    errorMsg.value = '当前重复设置在持续天数内不会触发，请调整'
    return
  }

  const payload = {
    title,
    dueDate: form.dueDate,
    dueTime: form.dueTime || null,
    endTime: form.endTime || null,
    memberIds: [...form.memberIds],
    memberId: form.memberIds[0] || null,
    quadrant: form.quadrant,
    note: form.note.trim() || null,
    reminder: form.reminderEnabled
      ? {
          startDate: isSeriesDay.value ? form.reminderStartDate || form.dueDate : form.dueDate,
          startTime: form.startTime,
          timesPerDay: form.pattern === 'yearly' ? 1 : Number(form.timesPerDay) || 1,
          intervalHours: Number(form.intervalHours) || 8,
          durationDays: form.pattern === 'yearly' ? 1 : Number(form.durationDays) || 1,
          pattern: form.pattern,
          yearlyKind: form.pattern === 'yearly' ? form.yearlyKind : 'solar',
          weekdays: form.pattern === 'weekly' ? [...form.weekdays] : [],
          workWeek: Number(form.workWeek) === 6 ? 6 : 5,
          enabled: true
        }
      : null
  }

  saving.value = true
  try {
    if (isEdit.value) {
      await board.updateTodo(props.todo.id, payload)
      toastOk('已保存修改')
    } else {
      await board.createTodo(payload)
      toastOk('已添加待办')
    }
    emit('saved')
    close()
  } catch (err) {
    errorMsg.value = err.message
    toastError(err.message)
  } finally {
    saving.value = false
  }
}

const members = computed(() => board.members)
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="ed" @click.self="close">
        <div class="ed__box">
          <header class="ed__head">
            <h3>{{ isEdit ? '编辑待办' : '添加待办' }}</h3>
            <button class="ed__close" aria-label="关闭" @click="close">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </button>
          </header>

          <div class="ed__body scroll-y">
            <label class="ed__field">
              <span class="ed__label">标题</span>
              <input
                v-model="form.title"
                class="field"
                maxlength="60"
                placeholder="例如：吃降压药"
                @keyup.enter="submit"
              />
            </label>

            <div v-if="phrases.length" class="ed__phrases">
              <span class="ed__phrases-label">常用语</span>
              <button
                v-for="p in phrases"
                :key="p.id"
                class="chip"
                @click="applyPhrase(p.text)"
              >
                {{ p.text }}
              </button>
            </div>

            <div class="ed__row">
              <label class="ed__field">
                <span class="ed__label">日期</span>
                <input
                  v-model="form.dueDate"
                  type="date"
                  class="field"
                  :disabled="isSeriesDay"
                  :title="isSeriesDay ? '重复任务的日期由提醒计划排定' : ''"
                  @change="onDueDateChange"
                />
              </label>
              <label class="ed__field">
                <span class="ed__label">开始时间</span>
                <input v-model="form.dueTime" type="time" class="field" />
              </label>
              <label class="ed__field">
                <span class="ed__label">结束时间</span>
                <input v-model="form.endTime" type="time" class="field" />
              </label>
            </div>

            <div class="ed__field">
              <div class="ed__label-row">
                <span class="ed__label">归属成员</span>
                <span class="ed__label-hint">
                  {{ form.memberIds.length ? `已选 ${form.memberIds.length} 人 · 再点一次取消` : '可多选，不选则不指派' }}
                </span>
              </div>
              <div class="ed__chips">
                <button
                  class="ed__member"
                  :class="{ 'ed__member--active': !form.memberIds.length }"
                  @click="clearMembers"
                >
                  <span class="ed__member-avatar ed__member-avatar--none">无</span>
                  <span>未指派</span>
                </button>
                <button
                  v-for="m in members"
                  :key="m.id"
                  class="ed__member"
                  :class="{ 'ed__member--active': form.memberIds.includes(m.id) }"
                  @click="toggleMember(m.id)"
                >
                  <img class="ed__member-avatar" :src="avatarSrcOf(m)" :alt="m.name" />
                  <span>{{ m.name }}</span>
                  <span v-if="form.memberIds.includes(m.id)" class="ed__member-tick">✓</span>
                </button>
              </div>
            </div>

            <div v-if="!isYearly" class="ed__field">
              <span class="ed__label">象限</span>
              <div class="ed__chips">
                <button
                  v-for="q in QUADRANTS"
                  :key="String(q.key)"
                  class="chip"
                  :class="[
                    `chip--${q.tone}`,
                    { 'chip--active': form.quadrant === q.key }
                  ]"
                  @click="form.quadrant = q.key"
                >
                  {{ q.name }}
                </button>
              </div>
            </div>

            <p v-else class="ed__field">
              <span class="ed__label-hint">纪念日归入「未分类」，不占用四象限</span>
            </p>

            <label class="ed__field">
              <span class="ed__label">备注（选填）</span>
              <textarea v-model="form.note" class="field" rows="1" maxlength="500" placeholder="补充说明" />
            </label>

            <section
              ref="reminderEl"
              class="ed__reminder"
              :class="{ 'ed__reminder--on': form.reminderEnabled }"
            >
              <header class="ed__reminder-head" @click="form.reminderEnabled = !form.reminderEnabled">
                <span class="ed__reminder-title">定时提醒</span>
                <span class="ed__reminder-sub">适用于吃药、喝水、打卡等重复提醒</span>
                <span class="switch" :class="{ 'switch--on': form.reminderEnabled }" />
              </header>

              <div v-if="form.reminderEnabled" class="ed__reminder-body">
                <!-- 重复方式 -->
                <div class="ed__field">
                  <span class="ed__label">重复方式</span>
                  <div class="ed__chips">
                    <button
                      v-for="p in PATTERNS"
                      :key="p.key"
                      class="chip"
                      :class="{ 'chip--active': form.pattern === p.key }"
                      @click="setPattern(p.key)"
                    >
                      {{ p.name }}
                    </button>
                  </div>
                </div>

                <!-- 纪念日：公历 / 农历 -->
                <div v-if="form.pattern === 'yearly'" class="ed__field">
                  <span class="ed__label">按哪种日期</span>
                  <div class="ed__chips">
                    <button
                      class="chip"
                      :class="{ 'chip--active': form.yearlyKind === 'solar' }"
                      @click="form.yearlyKind = 'solar'"
                    >
                      公历 · 每年 {{ dayjs(form.dueDate).format('M月D日') }}
                    </button>
                    <button
                      class="chip"
                      :class="{ 'chip--active': form.yearlyKind === 'lunar' }"
                      @click="form.yearlyKind = 'lunar'"
                    >
                      农历 · 每年 {{ yearlyLunarLabel }}
                    </button>
                  </div>
                  <span class="ed__label-hint">
                    选农历时按农历同月同日推算，公历日期每年会变（如春节、生日）
                  </span>
                </div>

                <!-- 每周：星期多选 -->
                <div v-if="form.pattern === 'weekly'" class="ed__field">
                  <div class="ed__label-row">
                    <span class="ed__label">选择星期（可多选）</span>
                    <span class="ed__label-hint ed__quick">
                      <button class="ed__link" @click="quickWeekdays('work')">工作日</button>
                      <button class="ed__link" @click="quickWeekdays('weekend')">周末</button>
                      <button class="ed__link" @click="quickWeekdays('all')">全选</button>
                      <button class="ed__link" @click="quickWeekdays('clear')">清空</button>
                    </span>
                  </div>
                  <div class="ed__chips">
                    <button
                      v-for="w in WEEKDAY_LABELS"
                      :key="w.iso"
                      class="ed__day"
                      :class="{ 'ed__day--active': form.weekdays.includes(w.iso) }"
                      @click="toggleWeekday(w.iso)"
                    >
                      {{ w.name }}
                    </button>
                  </div>
                </div>

                <!-- 工作日 / 非工作日：工作制 -->
                <div v-if="form.pattern === 'workdays' || form.pattern === 'restdays'" class="ed__field">
                  <span class="ed__label">工作制</span>
                  <div class="ed__chips">
                    <button
                      class="chip"
                      :class="{ 'chip--active': form.workWeek === 5 }"
                      @click="form.workWeek = 5"
                    >
                      {{ form.pattern === 'workdays' ? '五天工作制（周一至周五）' : '双休（每周六、日）' }}
                    </button>
                    <button
                      class="chip"
                      :class="{ 'chip--active': form.workWeek === 6 }"
                      @click="form.workWeek = 6"
                    >
                      {{ form.pattern === 'workdays' ? '六天工作制（周一至周六）' : '单休（每周日）' }}
                    </button>
                  </div>
                  <span class="ed__label-hint">按工作制推算，不叠加法定调休</span>
                </div>

                <!-- 时间与次数 -->
                <div class="ed__row ed__row--tight">
                  <label class="ed__field">
                    <span class="ed__label">几点开始</span>
                    <input v-model="form.startTime" type="time" class="field" />
                  </label>
                  <label v-if="form.pattern !== 'yearly'" class="ed__field">
                    <span class="ed__label">每天几次</span>
                    <input v-model.number="form.timesPerDay" type="number" min="1" max="24" class="field" />
                  </label>
                  <label v-if="form.pattern !== 'yearly'" class="ed__field">
                    <span class="ed__label">间隔小时</span>
                    <input
                      v-model.number="form.intervalHours"
                      type="number"
                      min="0.5"
                      max="24"
                      step="0.5"
                      class="field"
                    />
                  </label>
                </div>

                <!-- 持续天数 -->
                <div v-if="form.pattern !== 'yearly'" class="ed__field">
                  <div class="ed__label-row">
                    <span class="ed__label">持续天数</span>
                    <span class="ed__label-hint ed__quick">
                      <button
                        v-for="d in DURATION_PRESETS"
                        :key="d"
                        class="ed__link"
                        :class="{ 'ed__link--on': Number(form.durationDays) === d }"
                        @click="form.durationDays = d"
                      >
                        {{ d }}天
                      </button>
                    </span>
                  </div>
                  <input
                    v-model.number="form.durationDays"
                    type="number"
                    min="1"
                    max="365"
                    class="field"
                  />
                </div>

                <!-- 预览：结构化多行，不再被容器裁切 -->
                <div class="ed__preview" :class="{ 'ed__preview--warn': !!previewNotice }">
                  <p v-if="previewNotice" class="ed__preview-notice">{{ previewNotice }}</p>
                  <template v-else>
                    <div class="ed__preview-head">
                      <span class="ed__preview-total">
                        {{ form.pattern === 'yearly' ? '不限时长' : `共 ${previewTimes.length} 次` }}
                      </span>
                      <span class="ed__preview-tag">{{ patternLabel }}</span>
                      <span class="ed__preview-tag">{{ perDayLabel }}</span>
                    </div>
                    <p v-if="form.pattern === 'yearly'" class="ed__preview-range">
                      下次 {{ previewTimes[0] ? previewTimes[0].format('YYYY-MM-DD') : '—' }} · 此后每年重复，无终止
                    </p>
                    <p v-else class="ed__preview-range">从 {{ form.dueDate }} 起持续 {{ form.durationDays }} 天 · {{ previewRange }}</p>
                    <p v-if="repeatHint" class="ed__preview-range">{{ repeatHint }}</p>
                    <p class="ed__preview-list">
                      {{ previewHead.join('、') }}
                      <span v-if="previewTimes.length > 6" class="ed__preview-more">
                        … 还有 {{ previewTimes.length - 6 }} 次
                      </span>
                    </p>
                  </template>
                </div>
              </div>
            </section>

            <p v-if="errorMsg" class="ed__error">{{ errorMsg }}</p>
          </div>

          <footer class="ed__foot">
            <button class="btn" @click="close">取消</button>
            <button class="btn btn--primary" :disabled="saving" @click="submit">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ed {
  position: fixed;
  inset: 0;
  z-index: 600;
  background: rgba(12, 20, 30, 0.44);
  display: grid;
  place-items: center;
  padding: 1.2rem;
}

.ed__box {
  width: min(42rem, 100%);
  max-height: calc(var(--stage-h) * 0.9);
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.ed__head {
  display: flex;
  align-items: center;
  padding: 0.95rem 1.1rem 0.7rem;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.ed__head h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 500;
}

.ed__close {
  margin-left: auto;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  color: var(--text-3);
}

.ed__close:hover {
  background: var(--panel-2);
  color: var(--text);
}

.ed__body {
  padding: 0.85rem 1.05rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  flex: 1;
  min-height: 0;
}

.ed__field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  flex: 1;
  min-width: 0;
}

.ed__label {
  font-size: 0.72rem;
  color: var(--text-3);
}

.ed__label-row {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.ed__label-hint {
  font-size: 0.66rem;
  color: var(--text-3);
  opacity: 0.85;
}

.ed__quick {
  margin-left: auto;
  display: inline-flex;
  gap: 0.35rem;
  align-items: baseline;
}

.ed__link {
  font-size: 0.66rem;
  color: var(--primary);
  padding: 0 0.1rem;
  line-height: 1.2;
}

.ed__link:hover {
  text-decoration: underline;
}

.ed__link--on {
  font-weight: 600;
  text-decoration: underline;
}

.ed__row {
  display: flex;
  gap: 0.5rem;
}

.ed__row--tight {
  gap: 0.4rem;
}

.ed__phrases {
  display: flex;
  flex-wrap: wrap;
  gap: 0.32rem;
  align-items: center;
  margin-top: -0.2rem;
}

.ed__phrases-label {
  font-size: 0.7rem;
  color: var(--text-3);
  margin-right: 0.1rem;
}

.ed__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.32rem;
  align-items: center;
}

.ed__member {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  height: 2.1rem;
  padding: 0 0.55rem 0 0.3rem;
  border-radius: 999px;
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 0.76rem;
  border: 1px solid transparent;
}

.ed__member:hover {
  background: var(--panel-3);
}

.ed__member--active {
  background: var(--primary-weak);
  border-color: var(--primary);
  color: var(--primary);
}

.ed__member-tick {
  font-size: 0.66rem;
  color: var(--primary);
  line-height: 1;
}

.ed__member-avatar {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.ed__member-avatar--none {
  display: grid;
  place-items: center;
  background: var(--panel-3);
  color: var(--text-3);
  font-size: 0.6rem;
}

/* 星期选择器：正方形触控块 */
.ed__day {
  width: 2.1rem;
  height: 2.1rem;
  border-radius: var(--r-sm);
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text-2);
  font-size: 0.78rem;
  display: grid;
  place-items: center;
}

.ed__day:hover {
  border-color: var(--primary);
}

.ed__day--active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.chip--urgent {
  color: var(--red);
}

.chip--plan {
  color: var(--primary);
}

.chip--delegate {
  color: var(--amber);
}

.chip--urgent.chip--active {
  background: var(--red-weak);
  border-color: var(--red);
  color: var(--red);
}

.chip--plan.chip--active {
  background: var(--primary-weak);
  border-color: var(--primary);
  color: var(--primary);
}

.chip--delegate.chip--active {
  background: var(--amber-weak);
  border-color: var(--amber);
  color: var(--amber);
}

/* ---- 提醒 ---- */
.ed__reminder {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--panel-2);
  /* clip 不产生滚动容器，避免误滚动导致内容被裁掉 */
  overflow: clip;
}

.ed__reminder--on {
  border-color: var(--amber);
  background: var(--amber-weak);
}

.ed__reminder-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  cursor: pointer;
}

.ed__reminder-title {
  font-size: 0.82rem;
  font-weight: 500;
}

.ed__reminder-sub {
  font-size: 0.68rem;
  color: var(--text-3);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ed__reminder-body {
  padding: 0 0.75rem 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

/* 预览块：多行自适应，禁止省略与裁切 */
.ed__preview {
  border-radius: var(--r-sm);
  background: var(--panel);
  border: 1px solid var(--border);
  padding: 0.5rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.ed__preview--warn {
  border-color: var(--amber);
  background: var(--amber-weak);
}

.ed__preview-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.ed__preview-total {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--amber);
  margin-right: 0.1rem;
}

.ed__preview-tag {
  font-size: 0.66rem;
  color: var(--text-2);
  background: var(--panel-2);
  border-radius: 999px;
  padding: 0.1rem 0.45rem;
  white-space: normal;
}

.ed__preview-range,
.ed__preview-list {
  margin: 0;
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--text-3);
}

.ed__preview-list {
  color: var(--text-2);
}

.ed__preview-more {
  color: var(--text-3);
}

.ed__preview-notice {
  margin: 0;
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--amber);
}

.ed__error {
  margin: 0;
  font-size: 0.76rem;
  color: var(--red);
}

.ed__foot {
  flex: none;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.1rem 0.9rem;
  border-top: 1px solid var(--border);
}
</style>
