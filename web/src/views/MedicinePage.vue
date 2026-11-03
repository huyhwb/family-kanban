<script setup>
import { computed, onMounted, ref } from 'vue'
import { useMedicineStore } from '../stores/medicine'
import MedicineEditor from '../components/MedicineEditor.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import { toastError } from '../lib/toast'

const emit = defineEmits(['back'])

const store = useMedicineStore()

const FILTERS = [
  { key: 'all', name: '全部' },
  { key: 'soon', name: '临期' },
  { key: 'expired', name: '已过期' },
  { key: 'empty', name: '已用完' }
]

const keyword = ref('')
const editorOpen = ref(false)
const editorItem = ref(null)
const pendingDelete = ref(null)

let searchTimer = null
function onSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => store.setKeyword(keyword.value.trim()), 250)
}

const deleteOpen = computed({
  get: () => !!pendingDelete.value,
  set: (v) => {
    if (!v) pendingDelete.value = null
  }
})

function openEditor(item = null) {
  editorItem.value = item
  editorOpen.value = true
}

async function adjust(m, delta) {
  try {
    await store.adjust(m.id, delta)
  } catch (err) {
    toastError(err.message)
  }
}

async function doDelete() {
  const item = pendingDelete.value
  pendingDelete.value = null
  if (!item) return
  try {
    await store.remove(item.id)
  } catch (err) {
    toastError(err.message)
  }
}

const statCards = computed(() => [
  { key: 'total', name: '药品品种', value: store.stats.total, tone: 'primary' },
  { key: 'soon', name: `临期（${store.stats.warnDays || 30} 天内）`, value: store.stats.soon, tone: 'amber' },
  { key: 'expired', name: '已过期', value: store.stats.expired, tone: 'red' },
  { key: 'empty', name: '已用完', value: store.stats.empty, tone: 'gray' }
])

onMounted(() => store.load())
</script>

<template>
  <section class="med">
    <header class="med__head">
      <button class="med__back" @click="emit('back')">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M10 3.2 5.2 8 10 12.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        返回看板
      </button>

      <div class="med__titles">
        <h1 class="med__title">家庭药箱</h1>
        <span class="med__sub">按有效期排序 · 过期与临期优先</span>
      </div>

      <div class="med__search">
        <input v-model="keyword" class="field" placeholder="搜索药品 / 品牌 / 厂家 / 条码" @input="onSearch" />
      </div>

      <button class="med__add" @click="openEditor(null)">＋ 添加药品</button>
    </header>

    <div class="med__stats">
      <div v-for="c in statCards" :key="c.key" class="mstat" :class="`mstat--${c.tone}`">
        <b class="mstat__num">{{ c.value }}</b>
        <span class="mstat__name">{{ c.name }}</span>
      </div>
    </div>

    <div class="med__filters">
      <button
        v-for="f in FILTERS"
        :key="f.key"
        class="mfilter"
        :class="{ 'mfilter--on': store.filter === f.key }"
        @click="store.setFilter(f.key)"
      >
        {{ f.name }}
      </button>
      <span class="med__count">{{ store.items.length }} 条</span>
    </div>

    <div class="med__list scroll-y">
      <div v-for="m in store.items" :key="m.id" class="mrow" :class="`mrow--${m.status}`">
        <div class="mrow__pool">
          <div class="mrow__nameline">
            <span class="mrow__name">{{ m.name }}</span>
            <span v-if="m.brand" class="mrow__brand">{{ m.brand }}</span>
          </div>
          <div class="mrow__meta">
            <span v-if="m.spec">{{ m.spec }}</span>
            <span v-if="m.manufacturer" class="mrow__maker">{{ m.manufacturer }}</span>
            <span v-if="!m.spec && !m.manufacturer" class="mrow__muted">未填规格与厂家</span>
          </div>
        </div>

        <div class="mrow__exp">
          <span class="mrow__expdate">{{ m.expiryDate || '未填' }}</span>
          <span class="mrow__left" :class="`is-${m.status}`">{{ store.statusText(m) }}</span>
        </div>

        <div class="mrow__qty">
          <button
            class="mstep"
            title="取用：先扣散装，散装用完再扣整件"
            :disabled="m.packCount <= 0 && m.looseCount <= 0"
            @click="adjust(m, -1)"
          >
            −
          </button>
          <span class="mrow__qtynum">{{ m.amountText }}</span>
          <button class="mstep" title="补货：整件 +1" @click="adjust(m, 1)">＋</button>
        </div>

        <div class="mrow__ops">
          <button class="mop" @click="openEditor(m)">编辑</button>
          <button class="mop mop--danger" @click="pendingDelete = m">删除</button>
        </div>
      </div>

      <div v-if="store.loading && !store.items.length" class="med__hint">正在加载…</div>
      <div v-else-if="!store.items.length" class="med__empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect x="3" y="7" width="18" height="13" rx="2.5" stroke="currentColor" stroke-width="1.3" />
          <path d="M8.5 7V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V7M12 11v5M9.5 13.5h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
        </svg>
        <p class="med__empty-title">{{ store.keyword ? '没有匹配的药品' : '药箱还是空的' }}</p>
        <p class="med__empty-desc">
          {{ store.keyword ? '换个关键词试试' : '点右上角「添加药品」，可以手动填、扫条码，或拍张药盒照片让 AI 自动识别' }}
        </p>
        <button v-if="!store.keyword" class="btn btn--primary btn--sm" @click="openEditor(null)">
          添加第一种药品
        </button>
      </div>
    </div>

    <MedicineEditor v-model:open="editorOpen" :item="editorItem" @saved="store.load()" />

    <ConfirmDialog
      :open="deleteOpen"
      title="从药箱删除？"
      :message="pendingDelete ? `「${pendingDelete.name}」将被移除，此操作不可撤销。` : ''"
      confirm-text="删除"
      danger
      @confirm="doDelete"
      @cancel="pendingDelete = null"
    />
  </section>
</template>

<style scoped>
.med {
  grid-column: 1 / -1;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-height: 0;
  padding: 0.2rem 0.1rem 0;
}

.med__head {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  flex: none;
}

.med__back {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.65rem;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  background: var(--panel);
  font-size: 0.75rem;
  color: var(--text-2);
  flex: none;
}

.med__back:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.med__titles {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.med__title {
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.med__sub {
  font-size: 0.66rem;
  color: var(--text-3);
}

.med__search {
  margin-left: auto;
  width: 16rem;
  flex: none;
}

.med__add {
  flex: none;
  padding: 0.45rem 0.9rem;
  border-radius: var(--r-md);
  background: var(--primary);
  color: var(--on-primary);
  font-size: 0.78rem;
  font-weight: 500;
}

.med__add:hover {
  background: var(--primary-hover);
}

/* 统计卡 */
.med__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.5rem;
  flex: none;
}

.mstat {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.55rem 0.8rem;
  border-radius: var(--r-md);
  background: var(--panel);
  border: 1px solid var(--border);
}

.mstat__num {
  font-size: 1.3rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}

.mstat__name {
  font-size: 0.68rem;
  color: var(--text-3);
}

.mstat--primary .mstat__num {
  color: var(--primary);
}
.mstat--amber .mstat__num {
  color: var(--amber);
}
.mstat--red .mstat__num {
  color: var(--red);
}
.mstat--gray .mstat__num {
  color: var(--text-3);
}

/* 过滤 */
.med__filters {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex: none;
}

.mfilter {
  padding: 0.3rem 0.7rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.72rem;
  color: var(--text-2);
  background: var(--panel);
}

.mfilter--on {
  background: var(--primary-weak);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 500;
}

.med__count {
  margin-left: auto;
  font-size: 0.68rem;
  color: var(--text-3);
}

/* 列表 */
.med__list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-right: 0.2rem;
}

.mrow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 8rem 9.5rem auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.75rem;
  border-radius: var(--r-md);
  background: var(--panel);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border);
}

.mrow--expired {
  border-left-color: var(--red);
  background: var(--red-weak);
}
.mrow--soon {
  border-left-color: var(--amber);
  background: var(--amber-weak);
}
.mrow--empty {
  opacity: 0.72;
}

.mrow__nameline {
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  min-width: 0;
}

.mrow__name {
  font-size: 0.86rem;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mrow__brand {
  font-size: 0.68rem;
  padding: 0.05rem 0.35rem;
  border-radius: 999px;
  background: var(--panel-3);
  color: var(--text-2);
  flex: none;
}

.mrow__meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.68rem;
  color: var(--text-3);
  margin-top: 0.15rem;
  min-width: 0;
}

.mrow__maker {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mrow__muted {
  color: var(--text-3);
}

.mrow__exp {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.mrow__expdate {
  font-size: 0.76rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-2);
}

.mrow__left {
  font-size: 0.66rem;
  color: var(--text-3);
}

.mrow__left.is-expired {
  color: var(--red);
  font-weight: 600;
}
.mrow__left.is-soon {
  color: var(--amber);
  font-weight: 600;
}

.mrow__qty {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.mstep {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text-2);
  font-size: 0.85rem;
  line-height: 1;
  display: grid;
  place-items: center;
}

.mstep:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.mstep:disabled {
  opacity: 0.35;
}

.mrow__qtynum {
  min-width: 4.6rem;
  white-space: nowrap;
  text-align: center;
  font-size: 0.86rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.mrow__qtynum em {
  font-style: normal;
  font-size: 0.66rem;
  font-weight: 400;
  color: var(--text-3);
  margin-left: 0.15rem;
}

.mrow__ops {
  display: flex;
  gap: 0.3rem;
}

.mop {
  padding: 0.25rem 0.55rem;
  border-radius: var(--r-sm);
  font-size: 0.7rem;
  color: var(--text-2);
  border: 1px solid transparent;
}

.mop:hover {
  background: var(--panel-3);
  color: var(--text);
}

.mop--danger:hover {
  background: var(--red-weak);
  color: var(--red);
}

/* 空态 */
.med__empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  color: var(--text-3);
  padding: 2rem 1rem;
}

.med__empty-title {
  font-size: 0.88rem;
  color: var(--text);
  font-weight: 500;
}

.med__empty-desc {
  font-size: 0.7rem;
  max-width: 26rem;
  text-align: center;
  line-height: 1.6;
  margin-bottom: 0.3rem;
}

.med__hint {
  padding: 1rem;
  text-align: center;
  font-size: 0.75rem;
  color: var(--text-3);
}
</style>
