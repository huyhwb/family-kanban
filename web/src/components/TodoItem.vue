<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import dayjs from 'dayjs'
import { avatarSrcOf } from '../lib/avatars'
import { patternLabel, ruleFireCount } from '../lib/reminder'
import { useBoardStore } from '../stores/board'

const props = defineProps({
  todo: { type: Object, required: true },
  showDate: { type: Boolean, default: false }
})

const emit = defineEmits(['action', 'edit'])

const board = useBoardStore()
const menuOpen = ref(false)
/** actions=编辑/删除；members=选谁完成 */
const menuMode = ref('actions')
const root = ref(null)

const isDone = computed(() => props.todo.status !== 'pending')

/** 多人事项：每人各自勾选，全部完成后整条才算完成 */
const isMultiMember = computed(() => memberList.value.length > 1)
const memberDone = computed(() => {
  if (!isMultiMember.value) return 0
  return memberList.value.filter((m) => m.status === 'done' || m.status === 'skipped').length
})
const allMembersDone = computed(
  () => isMultiMember.value && memberDone.value >= memberList.value.length
)
const memberCountText = computed(() =>
  isMultiMember.value ? `${memberDone.value}/${memberList.value.length}` : ''
)

/** 重复任务计次：targetCount > 1 表示今天要做多次 */
const targetCount = computed(() => Math.max(1, Number(props.todo.targetCount) || 1))
const doneCount = computed(() => {
  const n = Number(props.todo.doneCount) || 0
  return Math.min(targetCount.value, Math.max(0, n))
})
const isMulti = computed(() => targetCount.value > 1)
// 计次做到一半、或多人里有人已完成，都算「进行中」
const isPartial = computed(
  () =>
    !isDone.value &&
    ((isMulti.value && doneCount.value > 0) || (isMultiMember.value && memberDone.value > 0))
)

const countText = computed(() =>
  isMulti.value ? `${doneCount.value}/${targetCount.value}` : ''
)

/** 多成员归属：优先用接口返回的 members，回退到主成员 */
const memberList = computed(() => {
  const t = props.todo
  if (Array.isArray(t.members) && t.members.length) return t.members
  if (t.memberId && board.memberMap[t.memberId]) return [board.memberMap[t.memberId]]
  return []
})

const memberLabel = computed(() => {
  const list = memberList.value
  if (!list.length) return ''
  if (list.length <= 2) return list.map((m) => m.name).join('、')
  return `${list[0].name} 等 ${list.length} 人`
})

const timeText = computed(() => {
  const { dueTime, endTime } = props.todo
  if (!dueTime) return ''
  return endTime ? `${dueTime}-${endTime}` : dueTime
})

const reminderText = computed(() => {
  const r = props.todo.reminder
  if (!r || !r.enabled) return ''
  const per = Math.max(1, Number(r.timesPerDay) || 1)
  const label = patternLabel(r)
  const dayPart = per === 1 ? label : `${label} ${per}次`
  const total = ruleFireCount(r)
  if (total <= 0) return `提醒 ${dayPart}`
  if (Number(r.durationDays) > 1) return `提醒 ${dayPart} · 共${total}次`
  return `提醒 ${dayPart}`
})

const dateText = computed(() => {
  const d = dayjs(props.todo.dueDate)
  const today = dayjs()
  if (d.isSame(today, 'day')) return '今天'
  if (d.isSame(today.add(1, 'day'), 'day')) return '明天'
  return d.format('M月D日')
})

function toggleMenu(e) {
  e.stopPropagation()
  if (menuOpen.value) {
    menuOpen.value = false
    return
  }
  menuMode.value = 'actions'
  menuOpen.value = true
}

/**
 * 点待办主体：
 * - 单人/无成员：直接完成或撤回（可反复）
 * - 多人：弹出「谁完成了」，逐个勾选
 */
/** 长按主体 = 撤回一次；短按 = 完成一次，两个动作彻底分开 */
let pressTimer = null
let longPressed = false

function onPressStart() {
  longPressed = false
  if (!canRestore.value) return
  clearTimeout(pressTimer)
  pressTimer = setTimeout(() => {
    longPressed = true
    emit('action', 'restore', props.todo, null)
  }, 600)
}

function onPressEnd() {
  clearTimeout(pressTimer)
}

function onBodyClick() {
  if (menuOpen.value) {
    menuOpen.value = false
    return
  }
  if (longPressed) {
    longPressed = false
    return
  }
  if (isMultiMember.value && !allMembersDone.value) {
    menuMode.value = 'members'
    menuOpen.value = true
    return
  }
  // 短按永远只做「完成」，不再根据状态来回切换
  emit('action', 'done', props.todo, null)
}

/** 有完成记录才能撤回 */
const canRestore = computed(() => {
  if (isMultiMember.value) return memberList.value.some((m) => m.status === 'done')
  return isDone.value || doneCount.value > 0
})

function pick(action, memberId = null) {
  menuOpen.value = false
  emit('action', action, props.todo, memberId)
}

/** 多人事项：点某人 = 那人完成；再点已完成的人 = 撤销他 */
function toggleMember(m) {
  const done = m.status === 'done' || m.status === 'skipped'
  pick(done ? 'restore' : 'done', m.id)
}

function onDocClick(e) {
  if (root.value && !root.value.contains(e.target)) menuOpen.value = false
}

onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div ref="root" class="todo" :class="{ 'todo--done': isDone, 'todo--partial': isPartial }">
    <button
      class="todo__circle"
      :class="{
        'todo__circle--done': isDone,
        'todo__circle--partial': isPartial
      }"
      :aria-label="isDone ? '已完成' : isMulti ? `第 ${doneCount + 1} 次，共 ${targetCount} 次` : '标记完成'"
      @click="toggleMenu"
    >
      <svg v-if="isDone" width="11" height="11" viewBox="0 0 12 12" fill="none">
        <path
          d="M2 6.3 4.7 9 10 3.2"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span v-else-if="isPartial" class="todo__circle-num">{{ doneCount }}</span>
    </button>

    <Transition name="pop">
      <div v-if="menuOpen" class="todo__menu" @click.stop>
        <!-- 多人事项：按人分别勾选 -->
        <template v-if="menuMode === 'members' && isMultiMember && !allMembersDone">
          <p class="todo__menu-tip">谁完成了？</p>
          <button
            v-for="m in memberList"
            :key="m.id"
            class="todo__menu-item todo__menu-member"
            :class="{ 'todo__menu-member--done': m.status === 'done' || m.status === 'skipped' }"
            @click="toggleMember(m)"
          >
            <img class="todo__menu-avatar" :src="avatarSrcOf(m)" :alt="m.name" />
            <span class="todo__menu-name">{{ m.name }}</span>
            <span class="todo__menu-state">
              {{ m.status === 'done' || m.status === 'skipped' ? '撤销' : '完成' }}
            </span>
          </button>
        </template>

        <button v-if="canRestore" class="todo__menu-item todo__menu-item--undo" @click="pick('restore')">
          撤回一次
        </button>
        <button class="todo__menu-item" @click="pick('edit')">编辑</button>
        <button class="todo__menu-item todo__menu-item--danger" @click="pick('delete')">
          删除
        </button>
      </div>
    </Transition>

    <div
      class="todo__main"
      :title="isMulti ? `点击完成第 ${Math.min(doneCount + 1, targetCount)} 次，长按撤回一次` : '点击完成，长按撤回'"
      @click="onBodyClick"
      @pointerdown="onPressStart"
      @pointerup="onPressEnd"
      @pointerleave="onPressEnd"
      @pointercancel="onPressEnd"
    >
      <div class="todo__title">
        <span v-if="todo.kind === 'medicine'" class="todo__pill">药</span>
        {{ todo.title }}
        <span v-if="todo.note" class="todo__note-mark" title="有备注">·</span>
      </div>
      <div class="todo__meta">
        <span v-if="isMulti" class="todo__tag todo__tag--count" :class="{ 'todo__tag--count-done': isDone }">
          {{ countText }}
        </span>
        <span v-if="showDate" class="todo__tag todo__tag--date">{{ dateText }}</span>
        <span v-if="timeText" class="todo__tag todo__tag--time">{{ timeText }}</span>
        <span v-if="reminderText" class="todo__tag todo__tag--bell">
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M6 1.4a3 3 0 0 0-3 3v2.1L1.9 8.3h8.2L9 6.5V4.4a3 3 0 0 0-3-3Z"
              stroke="currentColor"
              stroke-width="1"
              stroke-linejoin="round"
            />
            <path d="M4.8 9.7a1.3 1.3 0 0 0 2.4 0" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
          </svg>
          {{ reminderText }}
        </span>
        <span v-if="todo.kind === 'medicine' && todo.doseCount" class="todo__tag todo__tag--dose">
          每次 {{ todo.doseCount }}{{ todo.doseUnit || '' }}{{ todo.longTerm ? ' · 长期' : '' }}
        </span>
        <span v-if="memberList.length" class="todo__tag todo__tag--member">
          <span class="todo__avatars">
            <span
              v-for="m in memberList.slice(0, 3)"
              :key="m.id"
              class="todo__avatar"
              :class="{
                'todo__avatar--done': m.status === 'done' || m.status === 'skipped'
              }"
            >
              <img :src="avatarSrcOf(m)" :alt="m.name" />
            </span>
          </span>
          {{ isMultiMember ? memberCountText : memberLabel }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo {
  position: relative;
  display: flex;
  gap: 0.6rem;
  align-items: flex-start;
  padding: 0.5rem 0.55rem;
  border-radius: var(--r-md);
  transition: background 0.14s;
  cursor: pointer;
}

.todo:hover {
  background: var(--panel-2);
}

.todo__circle {
  flex: none;
  width: 1.35rem;
  height: 1.35rem;
  margin-top: 0.1rem;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  display: grid;
  place-items: center;
  color: #fff;
  transition: border-color 0.15s, background 0.15s;
}

.todo__circle:hover {
  border-color: var(--primary);
}

.todo__circle--done {
  background: var(--green);
  border-color: var(--green);
}

/* 重复任务：已勾了一部分 */
.todo__circle--partial {
  border-color: var(--primary);
  background: var(--primary-weak);
  color: var(--primary);
}

.todo__circle-num {
  font-size: 0.66rem;
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.todo__main {
  flex: 1;
  min-width: 0;
}

.todo__pill {
  display: inline-block;
  margin-right: 0.3rem;
  padding: 0 0.28rem;
  border-radius: 4px;
  font-size: 0.62rem;
  font-weight: 600;
  color: var(--purple);
  background: var(--purple-weak);
  vertical-align: 1px;
}

.todo__tag--dose {
  color: var(--purple);
  background: var(--purple-weak);
}

.todo__title {
  font-size: 0.88rem;
  line-height: 1.35;
  word-break: break-word;
}

.todo__note-mark {
  color: var(--text-3);
}

.todo--done .todo__pill {
  display: inline-block;
  margin-right: 0.3rem;
  padding: 0 0.28rem;
  border-radius: 4px;
  font-size: 0.62rem;
  font-weight: 600;
  color: var(--purple);
  background: var(--purple-weak);
  vertical-align: 1px;
}

.todo__tag--dose {
  color: var(--purple);
  background: var(--purple-weak);
}

.todo__title {
  color: var(--text-3);
  text-decoration: line-through;
}

.todo__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.22rem;
}

.todo__tag {
  display: inline-flex;
  align-items: center;
  gap: 0.18rem;
  font-size: 0.65rem;
  color: var(--text-3);
  background: var(--panel-3);
  border-radius: 999px;
  padding: 0.05rem 0.35rem;
  line-height: 1.5;
}

.todo__tag--time {
  font-variant-numeric: tabular-nums;
  color: var(--primary);
  background: var(--primary-weak);
}

.todo__tag--bell {
  color: var(--amber);
  background: var(--amber-weak);
}

/* 计次进度：2/3 */
.todo__tag--count {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--primary);
  background: var(--primary-weak);
}

.todo__tag--count-done {
  color: var(--green);
  background: var(--green-weak);
}

.todo__tag--member .todo__avatars {
  display: inline-flex;
  align-items: center;
}

.todo__tag--member .todo__avatar {
  display: block;
  position: relative;
}

.todo__tag--member .todo__avatars img {
  width: 0.85rem;
  height: 0.85rem;
  border-radius: 50%;
  display: block;
  box-shadow: 0 0 0 1px var(--panel-3);
}

/* 已完成的人：头像变淡 + 绿圈 */
.todo__avatar--done img {
  opacity: 0.45;
  box-shadow: 0 0 0 1px var(--green) !important;
}

.todo__tag--member .todo__avatars .todo__avatar + .todo__avatar {
  margin-left: -0.28rem;
}

/* ---- 多人事项的成员菜单 ---- */
.todo__menu-tip {
  font-size: 0.66rem;
  color: var(--text-3);
  padding: 0.3rem 0.55rem 0.25rem;
}

.todo__menu-member {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.todo__menu-avatar {
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  flex: none;
}

.todo__menu-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo__menu-state {
  font-size: 0.66rem;
  color: var(--text-3);
}

.todo__menu-member--done .todo__menu-name {
  color: var(--text-3);
  text-decoration: line-through;
}

.todo__menu-member--done .todo__menu-state {
  color: var(--green);
}

.todo--done .todo__tag {
  opacity: 0.6;
}

.todo__menu {
  position: absolute;
  top: 2.1rem;
  left: 0;
  z-index: 25;
  min-width: 7.2rem;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-lg);
  padding: 0.25rem;
  display: flex;
  flex-direction: column;
}

.todo__menu-item {
  text-align: left;
  padding: 0.42rem 0.55rem;
  border-radius: var(--r-sm);
  font-size: 0.78rem;
  color: var(--text-2);
}

.todo__menu-item:hover {
  background: var(--panel-2);
  color: var(--text);
}

.todo__menu-item--ok:hover {
  background: var(--green-weak);
  color: var(--green);
}

.todo__menu-item--danger:hover {
  background: var(--red-weak);
  color: var(--red);
}
</style>
