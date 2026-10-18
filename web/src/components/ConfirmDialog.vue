<script setup>
defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '确认操作' },
  message: { type: String, default: '' },
  confirmText: { type: String, default: '确定' },
  cancelText: { type: String, default: '取消' },
  danger: { type: Boolean, default: false }
})

const emit = defineEmits(['confirm', 'cancel'])
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="cd" @click.self="emit('cancel')">
        <div class="cd__box">
          <h3 class="cd__title">{{ title }}</h3>
          <p class="cd__msg">{{ message }}</p>
          <div class="cd__actions">
            <button class="btn" @click="emit('cancel')">{{ cancelText }}</button>
            <button
              class="btn"
              :class="danger ? 'btn--danger' : 'btn--primary'"
              @click="emit('confirm')"
            >
              {{ confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.cd {
  position: fixed;
  inset: 0;
  z-index: 700;
  background: rgba(12, 20, 30, 0.42);
  display: grid;
  place-items: center;
  padding: 1.5rem;
}

.cd__box {
  width: min(26rem, 100%);
  background: var(--panel);
  border-radius: var(--r-lg);
  padding: 1.2rem 1.3rem 1rem;
  box-shadow: var(--shadow-lg);
}

.cd__title {
  margin: 0 0 0.4rem;
  font-size: 1rem;
  font-weight: 500;
}

.cd__msg {
  margin: 0 0 1.1rem;
  font-size: 0.84rem;
  color: var(--text-2);
  line-height: 1.6;
}

.cd__actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
