<script setup>
import { computed, reactive, ref, watch } from 'vue'
import dayjs from 'dayjs'
import api from '../api/client'
import { useBoardStore } from '../stores/board'
import { useDisplayStore } from '../stores/display'
import { AVATAR_LABELS, AVATAR_PRESETS, avatarDataUrl, avatarSrcOf } from '../lib/avatars'
import { playChime, unlock } from '../lib/sound'
import { resizeAvatar } from '../lib/image'
import { toastError, toastOk } from '../lib/toast'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open', 'changed'])

const board = useBoardStore()
const display = useDisplayStore()

const TABS = [
  { key: 'members', name: '成员', hint: '头像 · 名称 · 常用语' },
  { key: 'reminder', name: '提醒', hint: '默认频率 · 提示音' },
  { key: 'stats', name: '统计', hint: '完成率 · 连续打卡' },
  { key: 'data', name: '数据', hint: '显示 · 备份 · 主题' }
]

const tab = ref('members')

/* ---------------- 成员 ---------------- */

const phrasesMap = reactive({})
const phraseDraft = reactive({})
const addingMember = ref(false)
const newMember = reactive({ name: '', preset: 'guest' })
const avatarEditing = ref(null)
const pendingDeleteMember = ref(null)
const uploading = ref(false)
const fileInput = ref(null)
const uploadTarget = ref(null)

async function loadPhrases() {
  await Promise.all(
    board.members.map(async (m) => {
      try {
        phrasesMap[m.id] = await api.phrases.list(m.id)
      } catch {
        phrasesMap[m.id] = []
      }
    })
  )
}

async function saveName(member, event) {
  const name = String(event.target.value || '').trim()
  if (!name) {
    event.target.value = member.name
    toastError('名称不能为空')
    return
  }
  if (name === member.name) return
  try {
    await api.members.update(member.id, { name })
    await board.reloadMembers()
    toastOk('名称已更新')
  } catch (err) {
    event.target.value = member.name
    toastError(err.message)
  }
}

async function toggleVisible(member) {
  try {
    await api.members.update(member.id, { visibleOnHome: !member.visibleOnHome })
    await board.reloadMembers()
  } catch (err) {
    toastError(err.message)
  }
}

function openAvatarEditor(member) {
  avatarEditing.value = member
}

async function pickPreset(preset) {
  const member = avatarEditing.value
  if (!member) return
  try {
    await api.members.update(member.id, { avatarPreset: preset })
    if (member.avatarFile) await api.members.resetAvatar(member.id)
    await board.reloadMembers()
    avatarEditing.value = board.members.find((m) => m.id === member.id) || null
    toastOk('头像已更新')
  } catch (err) {
    toastError(err.message)
  }
}

function triggerUpload(member) {
  uploadTarget.value = member
  fileInput.value && fileInput.value.click()
}

async function onFilePicked(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  const member = uploadTarget.value
  if (!file || !member) return
  if (!/^image\//.test(file.type)) {
    toastError('请选择图片文件')
    return
  }
  uploading.value = true
  try {
    const resized = await resizeAvatar(file, 256)
    await api.members.uploadAvatar(member.id, resized)
    await board.reloadMembers()
    if (avatarEditing.value && avatarEditing.value.id === member.id) {
      avatarEditing.value = board.members.find((m) => m.id === member.id) || null
    }
    toastOk('头像已上传')
  } catch (err) {
    toastError(err.message)
  } finally {
    uploading.value = false
  }
}

async function clearCustomAvatar(member) {
  try {
    await api.members.resetAvatar(member.id)
    await board.reloadMembers()
    avatarEditing.value = board.members.find((m) => m.id === member.id) || null
    toastOk('已恢复为内置头像')
  } catch (err) {
    toastError(err.message)
  }
}

async function addMember() {
  const name = newMember.name.trim()
  if (!name) {
    toastError('请填写成员名称')
    return
  }
  try {
    await api.members.create({ name, avatarPreset: newMember.preset })
    newMember.name = ''
    newMember.preset = 'guest'
    addingMember.value = false
    await board.reloadMembers()
    await loadPhrases()
    toastOk('成员已添加')
  } catch (err) {
    toastError(err.message)
  }
}

async function removeMember() {
  const member = pendingDeleteMember.value
  pendingDeleteMember.value = null
  if (!member) return
  try {
    await api.members.remove(member.id)
    await board.reloadMembers()
    emit('changed')
    toastOk('成员已删除')
  } catch (err) {
    toastError(err.message)
  }
}

async function addPhrase(member) {
  const text = (phraseDraft[member.id] || '').trim()
  if (!text) return
  try {
    const created = await api.phrases.create({ memberId: member.id, text })
    phrasesMap[member.id] = [...(phrasesMap[member.id] || []), created]
    phraseDraft[member.id] = ''
  } catch (err) {
    toastError(err.message)
  }
}

async function removePhrase(member, phrase) {
  try {
    await api.phrases.remove(phrase.id)
    phrasesMap[member.id] = (phrasesMap[member.id] || []).filter((p) => p.id !== phrase.id)
  } catch (err) {
    toastError(err.message)
  }
}

/* ---------------- 提醒 ---------------- */

const reminderDefaults = reactive({
  timesPerDay: 1,
  intervalHours: 8,
  durationDays: 1,
  snoozeMinutes: 10
})

const soundOn = computed(() => String(board.settings['ui.soundEnabled'] ?? '1') !== '0')

function syncReminderDefaults() {
  reminderDefaults.timesPerDay = Number(board.settings['reminder.defaultTimesPerDay']) || 1
  reminderDefaults.intervalHours = Number(board.settings['reminder.defaultIntervalHours']) || 8
  reminderDefaults.durationDays = Number(board.settings['reminder.defaultDurationDays']) || 1
  reminderDefaults.snoozeMinutes = Number(board.settings['reminder.snoozeMinutes']) || 10
}

async function saveReminderDefaults() {
  try {
    await board.updateSettings({
      'reminder.defaultTimesPerDay': reminderDefaults.timesPerDay,
      'reminder.defaultIntervalHours': reminderDefaults.intervalHours,
      'reminder.defaultDurationDays': reminderDefaults.durationDays,
      'reminder.snoozeMinutes': reminderDefaults.snoozeMinutes
    })
    toastOk('提醒默认值已保存')
  } catch (err) {
    toastError(err.message)
  }
}

async function toggleSound() {
  try {
    await board.updateSettings({ 'ui.soundEnabled': soundOn.value ? 0 : 1 })
  } catch (err) {
    toastError(err.message)
  }
}

function testSound() {
  unlock()
  playChime({ repeat: 1 })
  toastOk('已播放提示音')
}

async function resyncReminders() {
  try {
    const res = await api.reminders.resync()
    toastOk(`已补齐 ${res.created} 条提醒实例`)
  } catch (err) {
    toastError(err.message)
  }
}

/* ---------------- 统计 ---------------- */

const statsRange = ref('7d')
const stats = ref(null)
const statsLoading = ref(false)

async function loadStats() {
  statsLoading.value = true
  try {
    stats.value = await api.stats({ range: statsRange.value })
  } catch (err) {
    stats.value = null
    toastError(err.message)
  } finally {
    statsLoading.value = false
  }
}

const maxDaily = computed(() => {
  if (!stats.value) return 1
  return Math.max(1, ...stats.value.daily.map((d) => d.total))
})

function barHeight(day) {
  return `${Math.round((day.total / maxDaily.value) * 100)}%`
}

function barDoneHeight(day) {
  if (!day.total) return '0%'
  return `${Math.round((day.done / maxDaily.value) * 100)}%`
}

/* ---------------- 数据 ---------------- */

const holidayYear = ref(dayjs().year())
const holidayJson = ref('')
const holidaySaving = ref(false)

async function exportBackup() {
  try {
    const data = await api.backup.export()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `kanban-backup-${dayjs().format('YYYYMMDD-HHmm')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    toastOk('备份已导出')
  } catch (err) {
    toastError(err.message)
  }
}

const importInput = ref(null)
const pendingImport = ref(null)
const importing = ref(false)

function pickImportFile() {
  importInput.value && importInput.value.click()
}

async function onImportPicked(event) {
  const file = event.target.files && event.target.files[0]
  event.target.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    if (!parsed.data && !parsed.members) throw new Error('文件不是有效的看板备份')
    pendingImport.value = parsed
  } catch (err) {
    toastError(err.message || '文件解析失败')
  }
}

async function doImport() {
  const payload = pendingImport.value
  pendingImport.value = null
  if (!payload) return
  importing.value = true
  try {
    const res = await api.backup.import(payload)
    toastOk(`导入完成：${res.counts.todos} 条待办、${res.counts.members} 位成员`)
    await board.bootstrap()
    await loadPhrases()
    emit('changed')
  } catch (err) {
    toastError(err.message)
  } finally {
    importing.value = false
  }
}

async function loadHolidayJson() {
  try {
    const data = await api.calendar.holidays(holidayYear.value)
    holidayJson.value = JSON.stringify({ off: data.off, work: data.work }, null, 2)
  } catch (err) {
    toastError(err.message)
  }
}

async function saveHolidayJson() {
  holidaySaving.value = true
  try {
    const parsed = JSON.parse(holidayJson.value)
    await api.calendar.save(holidayYear.value, parsed)
    board.holidaysByYear = {}
    await board.ensureHolidayYear(holidayYear.value)
    toastOk('放假安排已更新')
  } catch (err) {
    toastError(err.message || 'JSON 格式不正确')
  } finally {
    holidaySaving.value = false
  }
}

async function setTheme(theme) {
  try {
    await board.updateSettings({ 'ui.theme': theme })
  } catch (err) {
    toastError(err.message)
  }
}

const health = ref(null)
async function loadHealth() {
  try {
    health.value = await api.health()
  } catch {
    health.value = null
  }
}

/* ---------------- 生命周期 ---------------- */

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    tab.value = 'members'
    syncReminderDefaults()
    await board.reloadMembers()
    await loadPhrases()
    loadHealth()
  }
)

watch(tab, (next) => {
  if (next === 'stats' && !stats.value) loadStats()
  if (next === 'data') loadHolidayJson()
})

watch(statsRange, () => loadStats())

watch(holidayYear, () => loadHolidayJson())

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="st" @click.self="close">
        <div class="st__box">
          <aside class="st__rail">
            <div class="st__brand">设置</div>
            <button
              v-for="t in TABS"
              :key="t.key"
              class="st__tab"
              :class="{ 'st__tab--active': tab === t.key }"
              @click="tab = t.key"
            >
              <span class="st__tab-name">{{ t.name }}</span>
              <span class="st__tab-hint">{{ t.hint }}</span>
            </button>
            <div class="st__rail-foot">
              <span v-if="health">驱动 {{ health.driver }}</span>
            </div>
          </aside>

          <div class="st__main">
            <header class="st__head">
              <h3>{{ TABS.find((t) => t.key === tab)?.name }}</h3>
              <button class="st__close" aria-label="关闭设置" @click="close">
                <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                  <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </button>
            </header>

            <div class="st__body scroll-y">
              <!-- ============ 成员 ============ -->
              <template v-if="tab === 'members'">
                <div class="st__toolbar">
                  <p class="st__desc">管理头像、显示名称、主页显隐以及录入待办时的快捷常用语。</p>
                  <button class="btn btn--primary btn--sm" @click="addingMember = !addingMember">
                    {{ addingMember ? '收起' : '＋ 新增成员' }}
                  </button>
                </div>

                <div v-if="addingMember" class="st__addbox">
                  <input v-model="newMember.name" class="field" maxlength="12" placeholder="成员名称，如：外公" />
                  <select v-model="newMember.preset" class="field">
                    <option v-for="p in AVATAR_PRESETS" :key="p" :value="p">
                      头像：{{ AVATAR_LABELS[p] }}
                    </option>
                  </select>
                  <button class="btn btn--primary btn--sm" @click="addMember">添加</button>
                </div>

                <div class="mcard" v-for="m in board.members" :key="m.id">
                  <div class="mcard__top">
                    <button class="mcard__avatar" @click="openAvatarEditor(m)">
                      <img :src="avatarSrcOf(m)" :alt="m.name" />
                      <span class="mcard__avatar-edit">改</span>
                    </button>

                    <div class="mcard__info">
                      <input
                        class="mcard__name"
                        :value="m.name"
                        maxlength="12"
                        @change="saveName(m, $event)"
                      />
                      <div class="mcard__sub">
                        {{ m.avatarFile ? '自定义头像' : `内置头像 · ${AVATAR_LABELS[m.avatarPreset] || '自定义'}` }}
                      </div>
                    </div>

                    <div class="mcard__switch">
                      <span class="mcard__switch-label">主页显示</span>
                      <button
                        class="switch"
                        :class="{ 'switch--on': m.visibleOnHome }"
                        :aria-label="m.visibleOnHome ? '隐藏' : '显示'"
                        @click="toggleVisible(m)"
                      />
                    </div>

                    <button class="mcard__del" title="删除成员" @click="pendingDeleteMember = m">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M2.5 4h9M5.5 4V2.6h3V4M4 4l.6 7.2h4.8L10 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </button>
                  </div>

                  <div class="mcard__phrases">
                    <span class="mcard__phrases-label">常用语</span>
                    <span
                      v-for="p in phrasesMap[m.id] || []"
                      :key="p.id"
                      class="pchip"
                    >
                      {{ p.text }}
                      <button class="pchip__x" @click="removePhrase(m, p)">×</button>
                    </span>
                    <input
                      v-model="phraseDraft[m.id]"
                      class="pchip__input"
                      maxlength="40"
                      placeholder="输入后回车添加"
                      @keyup.enter="addPhrase(m)"
                    />
                    <button class="pchip__add" @click="addPhrase(m)">添加</button>
                  </div>
                </div>

                <div class="st__hintbox">
                  提示：点左侧头像可切换内置卡通头像或上传自己的照片（会自动裁切为正方形并压缩）。
                </div>
              </template>

              <!-- ============ 提醒 ============ -->
              <template v-else-if="tab === 'reminder'">
                <p class="st__desc">
                  这里设置的是新建待办时的默认提醒参数，单条待办仍可单独调整。
                </p>

                <div class="sgroup">
                  <div class="sgroup__title">默认提醒频率</div>
                  <div class="srow">
                    <span class="srow__label">每天提醒次数</span>
                    <input v-model.number="reminderDefaults.timesPerDay" type="number" min="1" max="24" class="field srow__input" />
                    <span class="srow__unit">次</span>
                  </div>
                  <div class="srow">
                    <span class="srow__label">相邻提醒间隔</span>
                    <input v-model.number="reminderDefaults.intervalHours" type="number" min="0.5" max="24" step="0.5" class="field srow__input" />
                    <span class="srow__unit">小时</span>
                  </div>
                  <div class="srow">
                    <span class="srow__label">连续提醒天数</span>
                    <input v-model.number="reminderDefaults.durationDays" type="number" min="1" max="365" class="field srow__input" />
                    <span class="srow__unit">天</span>
                  </div>
                  <div class="srow">
                    <span class="srow__label">「稍后提醒」推迟</span>
                    <input v-model.number="reminderDefaults.snoozeMinutes" type="number" min="1" max="120" class="field srow__input" />
                    <span class="srow__unit">分钟</span>
                  </div>
                  <div class="srow srow--actions">
                    <button class="btn btn--primary btn--sm" @click="saveReminderDefaults">保存默认值</button>
                  </div>
                </div>

                <div class="sgroup">
                  <div class="sgroup__title">提示音</div>
                  <div class="srow">
                    <span class="srow__label">提醒时播放声音</span>
                    <button class="switch" :class="{ 'switch--on': soundOn }" @click="toggleSound" />
                  </div>
                  <div class="srow srow--actions">
                    <button class="btn btn--sm" @click="testSound">测试提示音</button>
                    <span class="srow__note">浏览器需先有一次点击才允许自动播放</span>
                  </div>
                </div>

                <div class="sgroup">
                  <div class="sgroup__title">提醒实例</div>
                  <p class="sgroup__text">
                    提醒实例由服务端按规则预生成并持久化，刷新页面或重启平板都不会丢失。
                  </p>
                  <div class="srow srow--actions">
                    <button class="btn btn--sm" @click="resyncReminders">重新生成未来提醒</button>
                  </div>
                </div>
              </template>

              <!-- ============ 统计 ============ -->
              <template v-else-if="tab === 'stats'">
                <div class="st__toolbar">
                  <div class="chips">
                    <button
                      v-for="r in [['7d', '近 7 天'], ['30d', '近 30 天'], ['90d', '近 90 天']]"
                      :key="r[0]"
                      class="chip"
                      :class="{ 'chip--active': statsRange === r[0] }"
                      @click="statsRange = r[0]"
                    >
                      {{ r[1] }}
                    </button>
                  </div>
                  <button class="btn btn--sm" @click="loadStats">刷新</button>
                </div>

                <div v-if="stats" class="kpis">
                  <div class="kpi">
                    <div class="kpi__value">{{ stats.completionRate }}<small>%</small></div>
                    <div class="kpi__label">完成率</div>
                  </div>
                  <div class="kpi">
                    <div class="kpi__value">{{ stats.done }}</div>
                    <div class="kpi__label">已完成</div>
                  </div>
                  <div class="kpi">
                    <div class="kpi__value">{{ stats.pending }}</div>
                    <div class="kpi__label">未完成</div>
                  </div>
                  <div class="kpi">
                    <div class="kpi__value">{{ stats.streak }}</div>
                    <div class="kpi__label">连续打卡（天）</div>
                  </div>
                  <div class="kpi">
                    <div class="kpi__value">{{ stats.checkinCount }}</div>
                    <div class="kpi__label">打卡记录</div>
                  </div>
                </div>

                <div v-if="stats" class="sgroup">
                  <div class="sgroup__title">每日完成情况</div>
                  <div class="bars">
                    <div v-for="d in stats.daily" :key="d.date" class="bars__col">
                      <div class="bars__track">
                        <div class="bars__total" :style="{ height: barHeight(d) }" />
                        <div class="bars__done" :style="{ height: barDoneHeight(d) }" />
                      </div>
                      <span class="bars__label">{{ dayjs(d.date).format('D') }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="stats && stats.members.length" class="sgroup">
                  <div class="sgroup__title">按成员</div>
                  <table class="mtab">
                    <thead>
                      <tr>
                        <th>成员</th>
                        <th>待办</th>
                        <th>完成</th>
                        <th>完成率</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="m in stats.members" :key="m.memberId || 'none'">
                        <td>{{ m.memberName }}</td>
                        <td>{{ m.total }}</td>
                        <td>{{ m.done }}</td>
                        <td>
                          <span class="mtab__bar">
                            <span :style="{ width: m.rate + '%' }" />
                          </span>
                          {{ m.rate }}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p v-if="!stats" class="st__desc">暂无统计数据</p>
              </template>

              <!-- ============ 数据 ============ -->
              <template v-else>
                <div class="sgroup">
                  <div class="sgroup__title">屏幕与方向</div>
                  <div class="srow">
                    <span class="srow__label">屏幕方向</span>
                    <div class="chips">
                      <button
                        class="chip"
                        :class="{ 'chip--active': display.pref === 'auto' }"
                        @click="display.setPref('auto')"
                      >
                        跟随设备
                      </button>
                      <button
                        class="chip"
                        :class="{ 'chip--active': display.pref === 'landscape' }"
                        @click="display.setPref('landscape')"
                      >
                        横屏
                      </button>
                      <button
                        class="chip"
                        :class="{ 'chip--active': display.pref === 'portrait' }"
                        @click="display.setPref('portrait')"
                      >
                        竖屏
                      </button>
                    </div>
                  </div>

                  <div class="srow">
                    <span class="srow__label">锁定方向</span>
                    <button
                      class="switch"
                      :class="{ 'switch--on': display.locked }"
                      aria-label="锁定屏幕方向"
                      @click="display.toggleLock()"
                    />
                  </div>

                  <div v-if="display.turned" class="srow">
                    <span class="srow__label">旋转方向</span>
                    <div class="chips">
                      <button
                        class="chip"
                        :class="{ 'chip--active': !display.reverse }"
                        @click="display.setReverse(false)"
                      >
                        顺时针
                      </button>
                      <button
                        class="chip"
                        :class="{ 'chip--active': display.reverse }"
                        @click="display.setReverse(true)"
                      >
                        逆时针
                      </button>
                    </div>
                  </div>

                  <p class="sgroup__text">
                    当前 {{ display.vw }}×{{ display.vh }}，界面按
                    {{ display.scalePercent }}% 等比缩放<template v-if="display.turned">，已旋转 90°</template>。
                    换分辨率或平板重新摆放后无需手动调整。
                  </p>
                  <div class="srow srow--actions">
                    <button class="btn btn--sm" @click="display.measure()">重新适配</button>
                  </div>
                </div>

                <div class="sgroup">
                  <div class="sgroup__title">外观</div>
                  <div class="srow">
                    <span class="srow__label">主题</span>
                    <div class="chips">
                      <button
                        class="chip"
                        :class="{ 'chip--active': board.theme === 'light' }"
                        @click="setTheme('light')"
                      >
                        浅色
                      </button>
                      <button
                        class="chip"
                        :class="{ 'chip--active': board.theme === 'dark' }"
                        @click="setTheme('dark')"
                      >
                        深色
                      </button>
                    </div>
                  </div>
                </div>

                <div class="sgroup">
                  <div class="sgroup__title">备份与恢复</div>
                  <p class="sgroup__text">
                    导出包含成员、待办、提醒规则、完成记录与设置。导入会清空当前数据，请谨慎操作。
                  </p>
                  <div class="srow srow--actions">
                    <button class="btn btn--sm" @click="exportBackup">导出备份 JSON</button>
                    <button class="btn btn--sm" :disabled="importing" @click="pickImportFile">
                      导入备份
                    </button>
                    <input ref="importInput" type="file" accept="application/json,.json" hidden @change="onImportPicked" />
                  </div>
                </div>

                <div class="sgroup">
                  <div class="sgroup__title">放假安排</div>
                  <p class="sgroup__text">
                    节假日与调休数据按年内置，可按年度覆盖更新。格式：<code>{ "off": { "2027-01-01": "元旦" }, "work": ["2027-01-04"] }</code>
                  </p>
                  <div class="srow">
                    <span class="srow__label">年份</span>
                    <input v-model.number="holidayYear" type="number" min="2000" max="2100" class="field srow__input" />
                    <button class="btn btn--sm" @click="loadHolidayJson">读取</button>
                  </div>
                  <textarea v-model="holidayJson" class="field st__code" rows="7" spellcheck="false" />
                  <div class="srow srow--actions">
                    <button class="btn btn--primary btn--sm" :disabled="holidaySaving" @click="saveHolidayJson">
                      保存
                    </button>
                  </div>
                </div>

                <div class="sgroup">
                  <div class="sgroup__title">服务信息</div>
                  <div v-if="health" class="info">
                    <div><span>服务</span>{{ health.app }}</div>
                    <div><span>数据库驱动</span>{{ health.driver }}</div>
                    <div><span>时区</span>{{ health.tz }}</div>
                    <div><span>服务端时间</span>{{ health.serverTime.replace('T', ' ') }}</div>
                    <div><span>已运行</span>{{ Math.floor(health.uptimeSeconds / 60) }} 分钟</div>
                  </div>
                  <p v-else class="st__desc">服务信息获取失败</p>
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- 头像编辑 -->
        <Transition name="pop">
          <div v-if="avatarEditing" class="st__sub" @click.self="avatarEditing = null">
            <div class="st__subbox">
              <h4>选择头像 — {{ avatarEditing.name }}</h4>
              <div class="presets">
                <button
                  v-for="p in AVATAR_PRESETS"
                  :key="p"
                  class="presets__item"
                  :class="{
                    'presets__item--active':
                      avatarEditing.avatarPreset === p && !avatarEditing.avatarFile
                  }"
                  @click="pickPreset(p)"
                >
                  <img :src="avatarDataUrl(p)" :alt="AVATAR_LABELS[p]" />
                  <span>{{ AVATAR_LABELS[p] }}</span>
                </button>
              </div>
              <div class="st__subactions">
                <button class="btn btn--sm" :disabled="uploading" @click="triggerUpload(avatarEditing)">
                  {{ uploading ? '上传中…' : '上传图片' }}
                </button>
                <button
                  v-if="avatarEditing.avatarFile"
                  class="btn btn--sm"
                  @click="clearCustomAvatar(avatarEditing)"
                >
                  移除自定义头像
                </button>
                <button class="btn btn--sm" @click="avatarEditing = null">完成</button>
              </div>
            </div>
          </div>
        </Transition>

        <input ref="fileInput" type="file" accept="image/*" hidden @change="onFilePicked" />

        <ConfirmDialog
          :open="!!pendingDeleteMember"
          title="删除该成员？"
          :message="pendingDeleteMember ? `「${pendingDeleteMember.name}」的头像与常用语将被删除，其名下待办会保留但变为未指派。` : ''"
          confirm-text="删除"
          danger
          @confirm="removeMember"
          @cancel="pendingDeleteMember = null"
        />

        <ConfirmDialog
          :open="!!pendingImport"
          title="导入备份将覆盖现有数据"
          message="当前所有成员、待办与完成记录都会被清空并替换为备份内容。建议先导出一份当前数据。"
          confirm-text="确认导入"
          danger
          @confirm="doImport"
          @cancel="pendingImport = null"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.st {
  position: fixed;
  inset: 0;
  z-index: 650;
  background: rgba(12, 20, 30, 0.48);
  display: grid;
  place-items: center;
  padding: 1.2rem;
}

.st__box {
  /* 用舞台尺寸而非 vw/vh：横竖屏互换时整块舞台会旋转，vh/vw 会指到物理视口 */
  width: min(58rem, calc(var(--stage-w) * 0.96));
  height: min(46rem, calc(var(--stage-h) * 0.92));
  display: grid;
  grid-template-columns: 11rem 1fr;
  /* 必须显式限定行高，否则网格行按内容撑开，内部滚动区失效 */
  grid-template-rows: minmax(0, 1fr);
  background: var(--panel);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

/* ---- 左侧标签 ---- */
.st__rail {
  background: var(--panel-2);
  padding: 1rem 0.6rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  border-right: 1px solid var(--border);
  min-height: 0;
  overflow: hidden;
}

.st__brand {
  font-size: 0.95rem;
  font-weight: 500;
  padding: 0 0.6rem 0.8rem;
}

.st__tab {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  padding: 0.5rem 0.6rem;
  border-radius: var(--r-md);
  text-align: left;
  transition: background 0.15s;
}

.st__tab:hover {
  background: var(--panel-3);
}

.st__tab--active {
  background: var(--panel);
  box-shadow: var(--shadow-sm);
}

.st__tab-name {
  font-size: 0.84rem;
  color: var(--text-2);
}

.st__tab--active .st__tab-name {
  color: var(--primary);
  font-weight: 500;
}

.st__tab-hint {
  font-size: 0.62rem;
  color: var(--text-3);
}

.st__rail-foot {
  margin-top: auto;
  padding: 0 0.6rem;
  font-size: 0.62rem;
  color: var(--text-3);
}

/* ---- 右侧内容 ---- */
.st__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  /* 作为网格项必须允许收缩，否则 .st__body 的 overflow 永远不会触发 */
  min-height: 0;
  overflow: hidden;
}

.st__head {
  display: flex;
  align-items: center;
  padding: 0.95rem 1.2rem 0.7rem;
  border-bottom: 1px solid var(--border);
  flex: none;
}

.st__head h3 {
  margin: 0;
  font-size: 0.98rem;
  font-weight: 500;
}

.st__close {
  margin-left: auto;
  width: 1.9rem;
  height: 1.9rem;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  color: var(--text-3);
}

.st__close:hover {
  background: var(--panel-2);
  color: var(--text);
}

.st__body {
  flex: 1;
  min-height: 0;
  padding: 1rem 1.2rem 1.4rem;
}

.st__toolbar {
  display: flex;
  align-items: flex-start;
  gap: 0.8rem;
  margin-bottom: 0.8rem;
}

.st__desc {
  margin: 0;
  font-size: 0.78rem;
  color: var(--text-3);
  line-height: 1.6;
  flex: 1;
}

.st__hintbox {
  margin-top: 0.8rem;
  padding: 0.6rem 0.75rem;
  border-radius: var(--r-md);
  background: var(--panel-2);
  font-size: 0.72rem;
  color: var(--text-3);
  line-height: 1.6;
}

/* ---- 成员卡 ---- */
.st__addbox {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.8rem;
  padding: 0.6rem;
  border-radius: var(--r-md);
  background: var(--panel-2);
}

.st__addbox .field {
  flex: 1;
  height: 2.4rem;
}

.mcard {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 0.7rem 0.8rem;
  margin-bottom: 0.6rem;
  background: var(--panel);
}

.mcard__top {
  display: flex;
  align-items: center;
  gap: 0.7rem;
}

.mcard__avatar {
  position: relative;
  width: 3.1rem;
  height: 3.1rem;
  border-radius: 50%;
  overflow: hidden;
  flex: none;
  border: 1px solid var(--border);
}

.mcard__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.mcard__avatar-edit {
  position: absolute;
  inset: auto 0 0 0;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 0.58rem;
  text-align: center;
  padding: 0.06rem 0;
}

.mcard__info {
  flex: 1;
  min-width: 0;
}

.mcard__name {
  width: 100%;
  max-width: 12rem;
  border: 1px solid transparent;
  background: transparent;
  border-radius: var(--r-sm);
  padding: 0.2rem 0.35rem;
  font-size: 0.9rem;
  font-weight: 500;
  outline: none;
}

.mcard__name:hover {
  border-color: var(--border);
}

.mcard__name:focus {
  border-color: var(--primary);
  background: var(--panel-2);
}

.mcard__sub {
  font-size: 0.66rem;
  color: var(--text-3);
  padding-left: 0.35rem;
}

.mcard__switch {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex: none;
}

.mcard__switch-label {
  font-size: 0.7rem;
  color: var(--text-3);
}

.mcard__del {
  width: 1.8rem;
  height: 1.8rem;
  border-radius: var(--r-sm);
  display: grid;
  place-items: center;
  color: var(--text-3);
  flex: none;
}

.mcard__del:hover {
  background: var(--red-weak);
  color: var(--red);
}

.mcard__phrases {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.6rem;
  padding-top: 0.55rem;
  border-top: 1px dashed var(--border);
}

.mcard__phrases-label {
  font-size: 0.66rem;
  color: var(--text-3);
  margin-right: 0.1rem;
}

.pchip {
  display: inline-flex;
  align-items: center;
  gap: 0.15rem;
  font-size: 0.7rem;
  background: var(--primary-weak);
  color: var(--primary);
  border-radius: 999px;
  padding: 0.1rem 0.2rem 0.1rem 0.5rem;
}

.pchip__x {
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 0.72rem;
  line-height: 1;
  color: var(--primary);
  opacity: 0.6;
}

.pchip__x:hover {
  opacity: 1;
  background: rgba(0, 0, 0, 0.08);
}

.pchip__input {
  width: 8rem;
  height: 1.7rem;
  border: 1px dashed var(--border-strong);
  border-radius: 999px;
  background: transparent;
  padding: 0 0.55rem;
  font-size: 0.7rem;
  outline: none;
}

.pchip__input:focus {
  border-color: var(--primary);
  border-style: solid;
}

.pchip__add {
  font-size: 0.68rem;
  color: var(--primary);
  padding: 0 0.3rem;
}

/* ---- 设置分组 ---- */
.sgroup {
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  padding: 0.75rem 0.85rem;
  margin-bottom: 0.7rem;
}

.sgroup__title {
  font-size: 0.82rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.sgroup__text {
  margin: 0 0 0.6rem;
  font-size: 0.72rem;
  color: var(--text-3);
  line-height: 1.6;
}

.sgroup__text code {
  font-size: 0.66rem;
  background: var(--panel-2);
  padding: 0.05rem 0.25rem;
  border-radius: 3px;
}

.srow {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.28rem 0;
}

.srow__label {
  font-size: 0.78rem;
  color: var(--text-2);
  min-width: 8rem;
}

.srow__input {
  width: 5.5rem;
  height: 2.1rem;
  flex: none;
}

.srow__unit {
  font-size: 0.72rem;
  color: var(--text-3);
}

.srow__note {
  font-size: 0.68rem;
  color: var(--text-3);
}

.srow--actions {
  padding-top: 0.5rem;
  flex-wrap: wrap;
}

.chips {
  display: flex;
  gap: 0.3rem;
  flex-wrap: wrap;
}

.st__code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.72rem;
  margin-top: 0.4rem;
}

/* ---- 统计 ---- */
.kpis {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.8rem;
}

.kpi {
  background: var(--panel-2);
  border-radius: var(--r-md);
  padding: 0.6rem 0.5rem;
  text-align: center;
}

.kpi__value {
  font-size: 1.35rem;
  font-weight: 500;
  color: var(--primary);
  line-height: 1.2;
}

.kpi__value small {
  font-size: 0.7rem;
  font-weight: 400;
}

.kpi__label {
  font-size: 0.66rem;
  color: var(--text-3);
  margin-top: 0.15rem;
}

.bars {
  display: flex;
  align-items: flex-end;
  gap: 0.22rem;
  height: 7rem;
  padding-top: 0.4rem;
}

.bars__col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  gap: 0.25rem;
  min-width: 0;
}

.bars__track {
  position: relative;
  flex: 1;
  width: 100%;
  max-width: 1.6rem;
  background: transparent;
  border-radius: 4px 4px 2px 2px;
  overflow: hidden;
}

.bars__total,
.bars__done {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 4px 4px 0 0;
}

.bars__total {
  background: var(--border-strong);
}

.bars__done {
  background: var(--primary);
}

.bars__label {
  font-size: 0.6rem;
  color: var(--text-3);
  flex: none;
}

.mtab {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.76rem;
}

.mtab th {
  text-align: left;
  font-weight: 400;
  color: var(--text-3);
  font-size: 0.68rem;
  padding: 0.3rem 0.4rem;
  border-bottom: 1px solid var(--border);
}

.mtab td {
  padding: 0.4rem;
  border-bottom: 1px dashed var(--border);
}

.mtab tr:last-child td {
  border-bottom: none;
}

.mtab__bar {
  display: inline-block;
  width: 4rem;
  height: 0.32rem;
  border-radius: 999px;
  background: var(--panel-3);
  margin-right: 0.35rem;
  vertical-align: middle;
  overflow: hidden;
}

.mtab__bar span {
  display: block;
  height: 100%;
  background: var(--primary);
  border-radius: 999px;
}

.info {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem 0.8rem;
  font-size: 0.74rem;
  color: var(--text-2);
}

.info div {
  display: flex;
  gap: 0.4rem;
}

.info span {
  color: var(--text-3);
  min-width: 5.5rem;
}

/* ---- 头像编辑子层 ---- */
.st__sub {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgba(12, 20, 30, 0.5);
  display: grid;
  place-items: center;
  padding: 1.5rem;
}

.st__subbox {
  width: min(30rem, 100%);
  background: var(--panel);
  border-radius: var(--r-lg);
  padding: 1.1rem 1.2rem;
  box-shadow: var(--shadow-lg);
}

.st__subbox h4 {
  margin: 0 0 0.8rem;
  font-size: 0.92rem;
  font-weight: 500;
}

.presets {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
}

.presets__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.2rem;
  border-radius: var(--r-md);
  border: 2px solid transparent;
  transition: border-color 0.15s, background 0.15s;
}

.presets__item:hover {
  background: var(--panel-2);
}

.presets__item--active {
  border-color: var(--primary);
  background: var(--primary-weak);
}

.presets__item img {
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  display: block;
}

.presets__item span {
  font-size: 0.68rem;
  color: var(--text-2);
}

.st__subactions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.9rem;
  justify-content: flex-end;
}
</style>
