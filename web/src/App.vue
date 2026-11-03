<script setup>
import { computed, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useBoardStore } from './stores/board'
import { useDisplayStore } from './stores/display'
import { useReminderStore } from './stores/reminder'
import { playChime, unlock } from './lib/sound'

import CalendarPanel from './components/CalendarPanel.vue'
import TodoPanel from './components/TodoPanel.vue'
import MemberRail from './components/MemberRail.vue'
import ReminderOverlay from './components/ReminderOverlay.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import TodoEditor from './components/TodoEditor.vue'
import ToastHost from './components/ToastHost.vue'
import MedicinePage from './views/MedicinePage.vue'
import { toast } from './lib/toast'

const board = useBoardStore()
const display = useDisplayStore()
const reminder = useReminderStore()

// 首帧前就量好视口、写好根字号，避免闪烁
display.init()

const settingsOpen = ref(false)
const editorOpen = ref(false)
const editorTodo = ref(null)

/** 当前页面：board 看板 / medicine 药箱，用 hash 保持刷新后仍在原页 */
const view = ref(location.hash === '#medicine' ? 'medicine' : 'board')

function syncView() {
  view.value = location.hash === '#medicine' ? 'medicine' : 'board'
}

function openMedicine() {
  location.hash = '#medicine'
}

function backToBoard() {
  location.hash = ''
}

provide('openMedicine', openMedicine)

let clockTimer = null

const soundEnabled = computed(() => String(board.settings['ui.soundEnabled'] ?? '1') !== '0')

provide('openSettings', () => {
  settingsOpen.value = true
})
provide('openTodoEditor', (todo = null) => {
  editorTodo.value = todo
  editorOpen.value = true
})

function onFirstInteract() {
  unlock()
  window.removeEventListener('pointerdown', onFirstInteract)
  window.removeEventListener('keydown', onFirstInteract)
}

onMounted(async () => {
  window.addEventListener('pointerdown', onFirstInteract, { once: true })
  window.addEventListener('keydown', onFirstInteract, { once: true })
  window.addEventListener('hashchange', syncView)

  await board.bootstrap()
  reminder.start()

  const q = new URLSearchParams(window.location.search)
  if (q.get('open') === 'settings') settingsOpen.value = true
  if (q.get('open') === 'editor') editorOpen.value = true

  clockTimer = setInterval(() => {
    board.checkDateRollover()
  }, 30000)
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', syncView)
  reminder.stop()
  if (clockTimer) clearInterval(clockTimer)
})

watch(
  () => reminder.active,
  (next, prev) => {
    if (next && next.id !== (prev && prev.id) && soundEnabled.value) {
      playChime({ repeat: 1 })
    }
  }
)

watch(
  () => board.theme,
  () => board.applyTheme()
)

function reloadAll() {
  board.bootstrap()
  reminder.poll()
}
</script>

<template>
  <div class="board" :class="`board--${display.orientation}`">
    <div v-if="!board.ready && board.loading" class="boot">
      <div class="boot__dot" />
      <p>正在载入看板…</p>
    </div>

    <div v-else-if="!board.ready" class="boot boot--error">
      <h2>无法连接到看板服务</h2>
      <p>{{ board.error || '请确认后端服务已启动' }}</p>
      <button class="btn btn--primary" @click="reloadAll">重试</button>
    </div>

    <template v-else>
      <MedicinePage v-if="view === 'medicine'" @back="backToBoard" />

      <template v-else>
        <CalendarPanel class="board__col board__col--calendar" />
        <TodoPanel class="board__col board__col--todos" />
        <MemberRail class="board__col board__col--rail" />
      </template>
    </template>

    <Transition name="fade">
      <div v-if="board.ready && !board.online" class="offline-bar">
        与看板服务的连接已中断，正在自动重试…
      </div>
    </Transition>

    <ReminderOverlay />

    <TodoEditor
      v-model:open="editorOpen"
      :todo="editorTodo"
      @saved="reloadAll"
    />

    <SettingsDialog v-model:open="settingsOpen" @changed="reloadAll" />

    <ToastHost />
  </div>
</template>

<style scoped>
.board {
  height: 100%;
  display: grid;
  /* 左右两栏按比例分配，右侧成员栏固定为「头像宽度 × 1.5」 */
  grid-template-columns: minmax(0, 34fr) minmax(0, 46fr) var(--rail-w);
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: 'cal todo rail';
  gap: var(--gap);
  padding: var(--gap);
  position: relative;
  overflow: hidden;
}

/* 竖屏：日历在上、待办在下，成员栏占满右侧整列 */
.board--portrait {
  grid-template-columns: minmax(0, 1fr) var(--rail-w);
  grid-template-rows: minmax(0, 42fr) minmax(0, 58fr);
  grid-template-areas:
    'cal rail'
    'todo rail';
}

.board__col--calendar {
  grid-area: cal;
}

.board__col--todos {
  grid-area: todo;
}

.board__col--rail {
  grid-area: rail;
}

.board__col {
  min-width: 0;
  min-height: 0;
}

.boot {
  grid-column: 1 / -1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-2);
}

.boot h2 {
  font-size: 1.2rem;
  font-weight: 500;
  color: var(--text);
  margin: 0;
}

.boot p {
  margin: 0;
  font-size: 0.9rem;
}

.boot__dot {
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 50%;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.offline-bar {
  position: absolute;
  left: 50%;
  bottom: 0.4rem;
  transform: translateX(-50%);
  background: var(--amber-weak);
  color: var(--amber);
  border: 1px solid currentColor;
  border-radius: 999px;
  padding: 0.35rem 1rem;
  font-size: 0.78rem;
  z-index: 40;
}
</style>
