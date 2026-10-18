<script setup>
import { computed, inject } from 'vue'
import { useBoardStore } from '../stores/board'
import { useDisplayStore } from '../stores/display'
import { avatarSrcOf } from '../lib/avatars'

const board = useBoardStore()
const display = useDisplayStore()
const openSettings = inject('openSettings')

const members = computed(() => board.visibleMembers)

const orientLabel = computed(() => (display.orientation === 'landscape' ? '横屏' : '竖屏'))
const orientTitle = computed(
  () =>
    `切换为${display.orientation === 'landscape' ? '竖屏' : '横屏'}（当前${orientLabel.value}` +
    `${display.locked ? '，已锁定' : '，跟随设备'}）`
)

function select(id) {
  board.selectMember(id)
}

function badgeOf(id) {
  return board.memberCounts[id] || 0
}

const allBadge = computed(() => {
  const sum = Object.values(board.memberCounts).reduce((a, b) => a + b, 0)
  return sum + (board.unassignedCount || 0)
})
</script>

<template>
  <aside class="rail panel">
    <button
      class="rail__item rail__item--all"
      :class="{ 'rail__item--active': board.selectedMemberId === 'all' }"
      @click="select('all')"
    >
      <span class="rail__avatar rail__avatar--all">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3.2" y="3.2" width="7.4" height="7.4" rx="2.2" fill="currentColor" opacity="0.9" />
          <rect x="13.4" y="3.2" width="7.4" height="7.4" rx="2.2" fill="currentColor" opacity="0.55" />
          <rect x="3.2" y="13.4" width="7.4" height="7.4" rx="2.2" fill="currentColor" opacity="0.55" />
          <rect x="13.4" y="13.4" width="7.4" height="7.4" rx="2.2" fill="currentColor" opacity="0.9" />
        </svg>
        <span v-if="allBadge" class="rail__badge">{{ allBadge > 99 ? '99+' : allBadge }}</span>
      </span>
      <span class="rail__name">全部</span>
    </button>

    <div class="rail__divider" />

    <div class="rail__list scroll-y">
      <button
        v-for="m in members"
        :key="m.id"
        class="rail__item"
        :class="{ 'rail__item--active': board.selectedMemberId === m.id }"
        @click="select(m.id)"
      >
        <span class="rail__avatar">
          <img :src="avatarSrcOf(m)" :alt="m.name" draggable="false" />
          <span v-if="badgeOf(m.id)" class="rail__badge">{{ badgeOf(m.id) > 99 ? '99+' : badgeOf(m.id) }}</span>
        </span>
        <span class="rail__name">{{ m.name }}</span>
      </button>

      <p v-if="!members.length" class="rail__empty">还没有成员</p>
    </div>

    <div class="rail__tools">
      <button class="rail__tool" :title="orientTitle" @click="display.toggleOrientation()">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          />
          <path
            d="M20.4 3.6v3.6h-3.6"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
          <rect
            x="8.7"
            y="7.4"
            width="6.6"
            height="9.2"
            rx="1.7"
            stroke="currentColor"
            stroke-width="1.4"
          />
        </svg>
        <span>{{ orientLabel }}</span>
      </button>

      <button
        class="rail__tool"
        :class="{ 'rail__tool--on': display.locked }"
        :title="display.locked ? '已锁定方向，点击改为跟随设备旋转' : '跟随设备旋转，点击锁定当前方向'"
        @click="display.toggleLock()"
      >
        <svg v-if="display.locked" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="4.6"
            y="10.2"
            width="14.8"
            height="10"
            rx="2.6"
            fill="currentColor"
            opacity="0.16"
          />
          <rect
            x="4.6"
            y="10.2"
            width="14.8"
            height="10"
            rx="2.6"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M8.2 10.2V7.7a3.8 3.8 0 0 1 7.6 0v2.5"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect
            x="4.6"
            y="10.2"
            width="14.8"
            height="10"
            rx="2.6"
            stroke="currentColor"
            stroke-width="1.7"
          />
          <path
            d="M8.2 10.2V7.7a3.8 3.8 0 0 1 7.3-1.4"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
          />
        </svg>
        <span>{{ display.locked ? '锁定' : '跟随' }}</span>
      </button>
    </div>

    <button class="rail__settings" @click="openSettings">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
          stroke="currentColor"
          stroke-width="1.5"
        />
        <path
          d="M19.3 13.4a1.4 1.4 0 0 0 .3 1.5l.1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.4 1.4 0 0 0-1.5-.3 1.4 1.4 0 0 0-.9 1.3v.3a1.7 1.7 0 1 1-3.4 0v-.2a1.4 1.4 0 0 0-.9-1.3 1.4 1.4 0 0 0-1.5.3l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.4 1.4 0 0 0 .3-1.5 1.4 1.4 0 0 0-1.3-.9h-.3a1.7 1.7 0 1 1 0-3.4h.2a1.4 1.4 0 0 0 1.3-.9 1.4 1.4 0 0 0-.3-1.5l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.4 1.4 0 0 0 1.5.3h.1a1.4 1.4 0 0 0 .9-1.3v-.3a1.7 1.7 0 1 1 3.4 0v.2a1.4 1.4 0 0 0 .9 1.3 1.4 1.4 0 0 0 1.5-.3l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.4 1.4 0 0 0-.3 1.5v.1a1.4 1.4 0 0 0 1.3.9h.3a1.7 1.7 0 1 1 0 3.4h-.2a1.4 1.4 0 0 0-1.3.9Z"
          stroke="currentColor"
          stroke-width="1.3"
        />
      </svg>
      <span>设置</span>
    </button>
  </aside>
</template>

<style scoped>
.rail {
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-sm);
  padding: 0.6rem 0.3rem 0.5rem;
  overflow: hidden;
}

.rail__divider {
  height: 1px;
  background: var(--border);
  margin: 0.4rem 0.2rem;
  flex: none;
}

.rail__list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}

.rail__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.35rem 0 0.4rem;
  border-radius: var(--r-md);
  transition: background 0.15s;
  flex: none;
}

.rail__item:hover {
  background: var(--panel-2);
}

.rail__avatar {
  position: relative;
  width: var(--avatar);
  height: var(--avatar);
  border-radius: 50%;
  overflow: visible;
  display: grid;
  place-items: center;
  border: 2px solid transparent;
  transition: border-color 0.16s, transform 0.16s, box-shadow 0.16s;
}

.rail__avatar img,
.rail__avatar svg {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
  display: block;
}

.rail__avatar--all {
  background: var(--panel-3);
  color: var(--text-2);
}

.rail__avatar--all svg {
  width: 58%;
  height: 58%;
}

.rail__item--active .rail__avatar {
  border-color: var(--primary);
  transform: scale(1.06);
  box-shadow: 0 0 0 3px var(--primary-weak);
}

.rail__item--active .rail__avatar--all {
  background: var(--primary-weak);
  color: var(--primary);
}

.rail__name {
  font-size: 0.66rem;
  color: var(--text-2);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.25;
  text-align: center;
}

.rail__item--active .rail__name {
  color: var(--primary);
  font-weight: 500;
}

.rail__badge {
  position: absolute;
  top: -0.15rem;
  right: -0.2rem;
  min-width: 1.05rem;
  height: 1.05rem;
  padding: 0 0.2rem;
  border-radius: 999px;
  background: var(--red);
  color: #fff;
  font-size: 0.6rem;
  line-height: 1.05rem;
  text-align: center;
  border: 2px solid var(--panel);
  box-sizing: content-box;
}

.rail__empty {
  font-size: 0.7rem;
  color: var(--text-3);
  text-align: center;
  margin: 0.8rem 0;
}

.rail__tools {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.35rem;
}

.rail__tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.05rem;
  padding: 0.28rem 0;
  border-radius: var(--r-md);
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 0.6rem;
  line-height: 1.2;
  transition: background 0.15s, color 0.15s;
}

.rail__tool svg {
  width: 1.1rem;
  height: 1.1rem;
}

.rail__tool:hover {
  background: var(--panel-3);
  color: var(--text);
}

.rail__tool--on {
  background: var(--primary-weak);
  color: var(--primary);
}

.rail__settings {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.1rem;
  padding: 0.32rem 0;
  border-radius: var(--r-md);
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 0.62rem;
  margin-top: 0.35rem;
  transition: background 0.15s, color 0.15s;
}

.rail__settings:hover {
  background: var(--panel-3);
  color: var(--text);
}

.rail__settings svg {
  width: 1.15rem;
  height: 1.15rem;
}
</style>
