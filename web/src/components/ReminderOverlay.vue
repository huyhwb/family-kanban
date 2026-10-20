<script setup>
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import { useReminderStore } from '../stores/reminder'
import { useBoardStore } from '../stores/board'
import { avatarSrcOf } from '../lib/avatars'

const reminder = useReminderStore()
const board = useBoardStore()

const busy = ref(false)

const active = computed(() => reminder.active)

const member = computed(() => {
  const a = active.value
  if (!a || !a.member_names) return null
  return {
    name: a.member_names,
    avatarPreset: a.avatar_preset,
    avatarFile: a.avatar_file
  }
})

const fireTime = computed(() => (active.value ? dayjs(active.value.fire_at).format('HH:mm') : ''))

/** 每天多次的重复任务：这次是第几次 */
const countInfo = computed(() => {
  const a = active.value
  if (!a) return null
  const target = Math.max(1, Number(a.target_count) || 1)
  if (target <= 1) return null
  const done = Math.min(target, Math.max(0, Number(a.done_count) || 0))
  return { target, done, next: Math.min(target, done + 1) }
})

const queueText = computed(() => {
  const n = reminder.due.length
  return n > 1 ? `还有 ${n - 1} 条待处理提醒` : ''
})

async function act(action, memberId = null) {
  if (busy.value) return
  busy.value = true
  try {
    await reminder.handle(action, memberId)
    board.refreshTodos()
  } finally {
    busy.value = false
  }
}

/** 多人事项：浮层里直接按人点完成 */
const dueMembers = computed(() => {
  const list = active.value && Array.isArray(active.value.members) ? active.value.members : []
  return list.length > 1 ? list : []
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="active" class="ro">
        <div class="ro__card">
          <div class="ro__pulse">
            <span class="ro__pulse-ring" />
            <svg class="ro__bell" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3a5.6 5.6 0 0 0-5.6 5.6v4.1L4.4 16h15.2l-2-3.3V8.6A5.6 5.6 0 0 0 12 3Z"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linejoin="round"
              />
              <path d="M9.6 18.6a2.6 2.6 0 0 0 4.8 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
            </svg>
          </div>

          <div class="ro__time">提醒时间 {{ fireTime }}</div>

          <h2 class="ro__title">{{ active.title }}</h2>

          <p v-if="active.note" class="ro__note">{{ active.note }}</p>

          <div class="ro__meta">
            <span v-if="member" class="ro__member">
              <img :src="avatarSrcOf(member, active.avatar_preset)" alt="" />
              {{ member.name }}
            </span>
            <span class="ro__date">{{ dayjs(active.due_date).format('M月D日') }}</span>
            <span v-if="countInfo" class="ro__count">
              第 {{ countInfo.next }} 次 / 共 {{ countInfo.target }} 次
            </span>
          </div>

          <!-- 多人事项：按人分别点完成 -->
          <div v-if="dueMembers.length" class="ro__members">
            <p class="ro__members-tip">谁完成了？</p>
            <div class="ro__members-row">
              <button
                v-for="m in dueMembers"
                :key="m.id"
                class="ro__member-btn"
                :disabled="busy"
                @click="act('done', m.id)"
              >
                <img :src="avatarSrcOf(m, m.avatar_preset)" alt="" />
                <span>{{ m.name }}</span>
              </button>
            </div>
          </div>

          <div class="ro__actions" :class="{ 'ro__actions--pair': dueMembers.length }">
            <button class="ro__btn ro__btn--ghost" :disabled="busy" @click="act('skip')">
              跳过本次
            </button>
            <button class="ro__btn ro__btn--snooze" :disabled="busy" @click="act('snooze')">
              稍后提醒
            </button>
            <button
              v-if="!dueMembers.length"
              class="ro__btn ro__btn--done"
              :disabled="busy"
              @click="act('done')"
            >
              {{ countInfo ? `完成第 ${countInfo.next} 次` : '已完成' }}
            </button>
          </div>

          <p v-if="queueText" class="ro__queue">{{ queueText }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ro {
  position: fixed;
  inset: 0;
  z-index: 800;
  background: rgba(10, 18, 28, 0.62);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: center;
  padding: 2rem;
}

.ro__card {
  width: min(34rem, 100%);
  background: var(--panel);
  border-radius: var(--r-xl);
  padding: 2rem 2rem 1.5rem;
  box-shadow: var(--shadow-lg);
  text-align: center;
  border: 2px solid var(--amber);
}

.ro__pulse {
  position: relative;
  width: 4.2rem;
  height: 4.2rem;
  margin: 0 auto 0.9rem;
  display: grid;
  place-items: center;
  color: var(--amber);
}

.ro__pulse-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: var(--amber-weak);
  animation: pulse 1.8s ease-out infinite;
}

@keyframes pulse {
  0% {
    transform: scale(0.85);
    opacity: 0.9;
  }
  70% {
    transform: scale(1.25);
    opacity: 0;
  }
  100% {
    opacity: 0;
  }
}

.ro__bell {
  position: relative;
  width: 2.2rem;
  height: 2.2rem;
}

.ro__time {
  font-size: 0.78rem;
  color: var(--text-3);
  letter-spacing: 0.04em;
}

.ro__title {
  margin: 0.35rem 0 0;
  font-size: 1.75rem;
  font-weight: 500;
  line-height: 1.3;
  word-break: break-word;
}

.ro__note {
  margin: 0.5rem 0 0;
  font-size: 0.85rem;
  color: var(--text-2);
  line-height: 1.6;
}

.ro__meta {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.7rem;
  margin-top: 0.7rem;
  font-size: 0.78rem;
  color: var(--text-3);
}

.ro__member {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.ro__member img {
  width: 1.3rem;
  height: 1.3rem;
  border-radius: 50%;
  object-fit: cover;
}

/* 重复任务：第 N 次 / 共 M 次 */
.ro__count {
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  background: var(--primary-weak);
  color: var(--primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.ro__actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr;
  gap: 0.55rem;
  margin-top: 1.5rem;
}

.ro__actions--pair {
  grid-template-columns: 1fr 1fr;
}

/* 多人事项：按人点完成 */
.ro__members {
  margin-top: 1.1rem;
}

.ro__members-tip {
  font-size: 0.7rem;
  color: var(--text-3);
  margin-bottom: 0.4rem;
}

.ro__members-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.ro__member-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 0.8rem;
  transition: border-color 0.15s, background 0.15s;
}

.ro__member-btn img {
  width: 1.2rem;
  height: 1.2rem;
  border-radius: 50%;
  object-fit: cover;
}

.ro__member-btn:hover {
  border-color: var(--green);
  background: var(--green-weak);
  color: var(--green);
}

.ro__btn {
  height: 3.1rem;
  border-radius: var(--r-md);
  font-size: 0.95rem;
  font-weight: 500;
  transition: transform 0.08s, background 0.15s;
}

.ro__btn:active {
  transform: scale(0.98);
}

.ro__btn--ghost {
  background: var(--panel-3);
  color: var(--text-2);
}

.ro__btn--snooze {
  background: var(--amber-weak);
  color: var(--amber);
  border: 1px solid var(--amber);
}

.ro__btn--done {
  background: var(--green);
  color: #fff;
}

.ro__queue {
  margin: 0.8rem 0 0;
  font-size: 0.72rem;
  color: var(--text-3);
}
</style>
