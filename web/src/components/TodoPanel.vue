<script setup>
import { computed, inject, ref } from 'vue'
import dayjs from 'dayjs'
import { useBoardStore } from '../stores/board'
import { useReminderStore } from '../stores/reminder'
import TodoItem from './TodoItem.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { toastError, toastOk } from '../lib/toast'

const board = useBoardStore()
const reminder = useReminderStore()
const openEditor = inject('openTodoEditor')

const QUADRANTS = [
  { key: 1, name: '重要且紧急', tone: 'urgent', hint: '立刻做' },
  { key: 2, name: '重要不紧急', tone: 'plan', hint: '计划做' },
  { key: 3, name: '不重要但紧急', tone: 'delegate', hint: '尽快做' },
  { key: 4, name: '不重要不紧急', tone: 'later', hint: '有空做' }
]

const pendingDelete = ref(null)
const deleteOpen = computed({
  get: () => !!pendingDelete.value,
  set: (v) => {
    if (!v) pendingDelete.value = null
  }
})

const unclassified = computed(() => board.quadrants.null || [])

const hasUnclassified = computed(() => unclassified.value.length > 0)

const nextReminder = computed(() => {
  const list = reminder.upcoming.filter((i) => i.status === 'pending')
  if (!list.length) return null
  const now = dayjs()
  const upcoming = list
    .map((i) => ({ ...i, at: dayjs(i.fire_at) }))
    .filter((i) => i.at.isAfter(now.subtract(1, 'minute')))
    .sort((a, b) => a.at.valueOf() - b.at.valueOf())
  if (!upcoming.length) return null
  const first = upcoming[0]
  return {
    ...first,
    timeText: first.at.format('HH:mm'),
    count: upcoming.length
  }
})

const totalCount = computed(() => board.todos.length)

function onAction(action, todo) {
  if (action === 'edit') {
    openEditor(todo)
    return
  }
  if (action === 'delete') {
    pendingDelete.value = todo
    return
  }
  board
    .setTodoStatus(todo.id, action)
    .then((updated) => {
      // 重复任务：给出「第几次 / 共几次」的即时反馈
      if (!updated || action !== 'done') return
      const target = Number(updated.targetCount) || 1
      if (target <= 1) return
      const done = Number(updated.doneCount) || 0
      if (updated.status === 'done') toastOk(`「${updated.title}」今天 ${target} 次已全部完成`)
      else toastOk(`「${updated.title}」已记录 ${done}/${target}`)
    })
    .catch((err) => toastError(err.message))
}

async function confirmDelete() {
  const todo = pendingDelete.value
  pendingDelete.value = null
  if (!todo) return
  try {
    await board.removeTodo(todo.id)
  } catch (err) {
    toastError(err.message)
  }
}

function clearFilters() {
  board.selectMember('all')
  board.goToday()
}
</script>

<template>
  <section class="td panel">
    <header class="td__head">
      <div class="td__titles">
        <h2 class="td__title">待办</h2>
        <span class="td__summary">{{ board.filterSummary }}</span>
      </div>

      <div class="td__views" role="tablist">
        <button
          class="td__view"
          :class="{ 'td__view--active': board.viewMode === 'quadrant' }"
          role="tab"
          @click="board.setViewMode('quadrant')"
        >
          四象限
        </button>
        <button
          class="td__view"
          :class="{ 'td__view--active': board.viewMode === 'list' }"
          role="tab"
          @click="board.setViewMode('list')"
        >
          清单
        </button>
      </div>
    </header>

    <div class="td__status">
      <span class="td__status-item">
        <b>{{ board.pendingCount }}</b> 项待完成
      </span>
      <span class="td__status-divider" />
      <span class="td__status-item td__status-item--muted">
        已完成 {{ board.doneCount }} / 共 {{ totalCount }}
      </span>

      <span v-if="nextReminder" class="td__next-reminder">
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M6 1.4a3 3 0 0 0-3 3v2.1L1.9 8.3h8.2L9 6.5V4.4a3 3 0 0 0-3-3Z"
            stroke="currentColor"
            stroke-width="1"
            stroke-linejoin="round"
          />
          <path d="M4.8 9.7a1.3 1.3 0 0 0 2.4 0" stroke="currentColor" stroke-width="1" stroke-linecap="round" />
        </svg>
        下次提醒 {{ nextReminder.timeText }} · {{ nextReminder.title }}
      </span>

      <button
        v-if="board.selectedMemberId !== 'all' || !board.isTodaySelected"
        class="td__clear"
        @click="clearFilters"
      >
        清除筛选
      </button>
    </div>

    <div class="td__body scroll-y">
      <div v-if="board.viewMode === 'quadrant'" class="quad" :class="{ 'quad--with-extra': hasUnclassified }">
        <div
          v-for="q in QUADRANTS"
          :key="q.key"
          class="quad__cell"
          :class="`quad__cell--${q.tone}`"
        >
          <div class="quad__head">
            <span class="quad__name">{{ q.name }}</span>
            <span class="quad__hint">{{ q.hint }}</span>
            <span class="quad__count">{{ board.quadrants[q.key].length }}</span>
          </div>
          <div class="quad__list scroll-y">
            <TodoItem
              v-for="t in board.quadrants[q.key]"
              :key="t.id"
              :todo="t"
              @action="onAction"
              @edit="openEditor(t)"
            />
            <p v-if="!board.quadrants[q.key].length" class="quad__empty">暂无事项</p>
          </div>
        </div>

        <div v-if="hasUnclassified" class="quad__cell quad__cell--extra">
          <div class="quad__head">
            <span class="quad__name">未分类</span>
            <span class="quad__hint">未设置象限</span>
            <span class="quad__count">{{ unclassified.length }}</span>
          </div>
          <div class="quad__list quad__list--row scroll-y">
            <TodoItem
              v-for="t in unclassified"
              :key="t.id"
              :todo="t"
              @action="onAction"
              @edit="openEditor(t)"
            />
          </div>
        </div>
      </div>

      <div v-else class="list">
        <TodoItem
          v-for="t in board.todos"
          :key="t.id"
          :todo="t"
          show-date
          @action="onAction"
          @edit="openEditor(t)"
        />
        <div v-if="!board.todos.length" class="empty">
          <p>这一天还没有安排</p>
          <button class="btn btn--primary btn--sm" @click="openEditor(null)">添加第一条待办</button>
        </div>
      </div>
    </div>

    <footer class="td__foot">
      <button class="td__add" @click="openEditor(null)">
        <svg width="13" height="13" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
        添加待办
      </button>
    </footer>

    <ConfirmDialog
      :open="deleteOpen"
      title="删除这条待办？"
      :message="pendingDelete ? `「${pendingDelete.title}」将被永久删除，关联的提醒规则也会一并移除。` : ''"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="pendingDelete = null"
    />
  </section>
</template>

<style scoped>
.td {
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: 0.9rem 0.85rem 0.8rem;
  overflow: hidden;
}

.td__head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0 0.15rem;
}

.td__titles {
  display: flex;
  align-items: baseline;
  gap: 0.55rem;
  min-width: 0;
}

.td__title {
  margin: 0;
  font-size: 1.05rem;
  font-weight: 500;
  flex: none;
}

.td__summary {
  font-size: 0.75rem;
  color: var(--text-3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.td__views {
  margin-left: auto;
  display: flex;
  background: var(--panel-2);
  border-radius: var(--r-sm);
  padding: 0.15rem;
  flex: none;
}

.td__view {
  height: 1.85rem;
  padding: 0 0.7rem;
  border-radius: 0.45rem;
  font-size: 0.76rem;
  color: var(--text-2);
  transition: background 0.15s, color 0.15s;
}

.td__view--active {
  background: var(--panel);
  color: var(--primary);
  font-weight: 500;
  box-shadow: var(--shadow-sm);
}

.td__status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.15rem 0.55rem;
  font-size: 0.72rem;
  color: var(--text-2);
  flex-wrap: wrap;
}

.td__status-item b {
  font-weight: 500;
  color: var(--primary);
  font-size: 0.85rem;
}

.td__status-item--muted {
  color: var(--text-3);
}

.td__status-divider {
  width: 1px;
  height: 0.7rem;
  background: var(--border);
}

.td__next-reminder {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-left: auto;
  color: var(--amber);
  background: var(--amber-weak);
  border-radius: 999px;
  padding: 0.1rem 0.5rem;
  font-size: 0.68rem;
  max-width: 55%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.td__clear {
  font-size: 0.7rem;
  color: var(--primary);
  background: var(--primary-weak);
  border-radius: 999px;
  padding: 0.12rem 0.5rem;
}

.td__body {
  flex: 1;
  min-height: 0;
  padding-right: 0.15rem;
}

/* ---- 四象限 ---- */
.quad {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0.5rem;
  height: 100%;
  min-height: 0;
}

.quad--with-extra {
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr) auto;
}

.quad__cell {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-radius: var(--r-md);
  background: var(--panel-2);
  border: 1px solid var(--border);
  padding: 0.45rem 0.4rem 0.35rem;
}

.quad__head {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.25rem 0.35rem;
  flex: none;
}

.quad__name {
  font-size: 0.76rem;
  font-weight: 500;
}

.quad__hint {
  font-size: 0.62rem;
  color: var(--text-3);
}

.quad__count {
  margin-left: auto;
  font-size: 0.64rem;
  color: var(--text-2);
  background: var(--panel);
  border-radius: 999px;
  padding: 0 0.34rem;
  min-width: 1.1rem;
  text-align: center;
}

.quad__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.quad__list--row {
  max-height: 9rem;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 0.4rem;
}

.quad__empty {
  margin: 0.5rem 0.3rem;
  font-size: 0.7rem;
  color: var(--text-3);
}

/* 象限配色 */
.quad__cell--urgent {
  background: var(--red-weak);
  border-color: transparent;
}

.quad__cell--urgent .quad__name {
  color: var(--red);
}

.quad__cell--plan {
  background: var(--primary-weak);
  border-color: transparent;
}

.quad__cell--plan .quad__name {
  color: var(--primary);
}

.quad__cell--delegate {
  background: var(--amber-weak);
  border-color: transparent;
}

.quad__cell--delegate .quad__name {
  color: var(--amber);
}

.quad__cell--later {
  background: var(--panel-2);
}

.quad__cell--extra {
  grid-column: 1 / -1;
}

/* ---- 清单 ---- */
.list {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.6rem;
  padding: 2.5rem 0;
  color: var(--text-3);
  font-size: 0.82rem;
}

.empty p {
  margin: 0;
}

/* ---- 底部添加 ---- */
.td__foot {
  flex: none;
  padding-top: 0.6rem;
}

.td__add {
  width: 100%;
  height: var(--tap);
  border-radius: var(--r-md);
  background: var(--primary);
  color: var(--on-primary);
  font-size: 0.85rem;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  transition: background 0.15s, transform 0.08s;
}

.td__add:hover {
  background: var(--primary-hover);
}

.td__add:active {
  transform: scale(0.99);
}
</style>
