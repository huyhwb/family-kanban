<script setup>
import { toastState } from '../lib/toast'
</script>

<template>
  <Teleport to="body">
    <div class="toasts">
      <TransitionGroup name="pop">
        <div v-for="item in toastState.items" :key="item.id" class="toast" :class="`toast--${item.type}`">
          {{ item.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toasts {
  position: fixed;
  left: 50%;
  bottom: 1.6rem;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  z-index: 900;
  pointer-events: none;
}

.toast {
  padding: 0.6rem 1.1rem;
  border-radius: 999px;
  font-size: 0.85rem;
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow-md);
  border: 1px solid var(--border);
}

.toast--ok {
  border-color: var(--green);
  color: var(--green);
}

.toast--error {
  border-color: var(--red);
  color: var(--red);
}
</style>
