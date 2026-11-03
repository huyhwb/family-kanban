<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import api from '../api/client'
import { useMedicineStore } from '../stores/medicine'
import MedicineScanner from './MedicineScanner.vue'
import { toastError, toastOk } from '../lib/toast'

const props = defineProps({
  open: { type: Boolean, default: false },
  item: { type: Object, default: null }
})
const emit = defineEmits(['update:open', 'saved'])

const store = useMedicineStore()

const MODES = [
  { key: 'manual', name: '手动录入' },
  { key: 'scan', name: '扫条码' },
  { key: 'ai', name: '拍照识别' }
]

const PACK_UNITS = ['盒', '瓶', '袋', '罐', '支', '板']
const LOOSE_UNITS = ['片', '粒', '袋', '支', '包', 'ml', 'g']

const mode = ref('manual')
const saving = ref(false)
const aiBusy = ref(false)
const aiPreview = ref('')
const errorMsg = ref('')
const titleEl = ref(null)

const form = reactive({
  brand: '',
  name: '',
  spec: '',
  expiryDate: '',
  manufacturer: '',
  // 整件 + 散装两栏：1 盒 + 5 片
  packCount: 1,
  packUnit: '盒',
  looseCount: 0,
  looseUnit: '片',
  barcode: '',
  note: ''
})

const isEdit = computed(() => !!props.item)

function bump(kind, delta) {
  const key = kind === 'pack' ? 'packCount' : 'looseCount'
  form[key] = Math.max(0, Number(form[key] || 0) + delta)
}

function reset() {
  const t = props.item
  form.brand = t?.brand || ''
  form.name = t?.name || ''
  form.spec = t?.spec || ''
  form.expiryDate = t?.expiryDate || ''
  form.manufacturer = t?.manufacturer || ''
  form.packCount = t ? t.packCount ?? 0 : 1
  form.packUnit = t?.packUnit || '盒'
  form.looseCount = t?.looseCount ?? 0
  form.looseUnit = t?.looseUnit || '片'
  form.barcode = t?.barcode || ''
  form.note = t?.note || ''
  mode.value = 'manual'
  errorMsg.value = ''
  aiPreview.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    reset()
    nextTick(() => titleEl.value && titleEl.value.focus())
  }
)

function close() {
  emit('update:open', false)
}

/** 条码识别结果：已存在同条码的药品时提示补货 */
function onDetected(code) {
  const text = String(code || '').trim()
  if (!text) return
  const exists = store.items.find((m) => m.barcode && m.barcode === text)
  form.barcode = text
  mode.value = 'manual'
  if (exists && (!props.item || exists.id !== props.item.id)) {
    toastOk(`已有「${exists.name}」，当前剩余 ${exists.amountText}`)
  } else {
    toastOk('已读取条码，继续补充药品信息')
  }
}

/* ---- 拍照识别 ---- */
const fileInput = ref(null)

function pickImage() {
  if (fileInput.value) fileInput.value.click()
}

/** 压到长边 1280、JPEG 0.85，避免请求过大 */
function compress(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const max = 1280
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

async function onImage(e) {
  const file = e.target.files && e.target.files[0]
  e.target.value = ''
  if (!file) return
  errorMsg.value = ''
  aiBusy.value = true
  try {
    const dataUrl = await compress(file)
    aiPreview.value = dataUrl
    const res = await api.ai.recognizeMedicine(dataUrl)
    const d = res.data || {}
    form.brand = d.brand || form.brand
    form.name = d.name || form.name
    form.spec = d.spec || form.spec
    form.expiryDate = d.expiryDate || form.expiryDate
    form.manufacturer = d.manufacturer || form.manufacturer
    if (d.packUnit && PACK_UNITS.includes(d.packUnit)) form.packUnit = d.packUnit
    if (d.looseUnit && LOOSE_UNITS.includes(d.looseUnit)) form.looseUnit = d.looseUnit
    mode.value = 'manual'
    toastOk('识别完成，请核对后再保存')
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    aiBusy.value = false
  }
}

async function submit() {
  const name = form.name.trim()
  if (!name) {
    errorMsg.value = '药品名不能为空'
    return
  }
  saving.value = true
  errorMsg.value = ''
  try {
    await store.save(
      {
        brand: form.brand.trim(),
        name,
        spec: form.spec.trim(),
        expiryDate: form.expiryDate || null,
        manufacturer: form.manufacturer.trim(),
        packCount: Number(form.packCount) || 0,
        packUnit: form.packUnit || '盒',
        looseCount: Number(form.looseCount) || 0,
        looseUnit: form.looseUnit || '片',
        barcode: form.barcode.trim(),
        note: form.note.trim()
      },
      props.item?.id || null
    )
    toastOk(isEdit.value ? '已保存修改' : '已加入药箱')
    emit('saved')
    close()
  } catch (err) {
    errorMsg.value = err.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="me" @click.self="close">
        <div class="me__card">
          <header class="me__head">
            <h3>{{ isEdit ? '编辑药品' : '添加药品' }}</h3>
            <button class="me__close" aria-label="关闭" @click="close">
              <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
              </svg>
            </button>
          </header>

          <div class="me__tabs">
            <button
              v-for="m in MODES"
              :key="m.key"
              class="me__tab"
              :class="{ 'me__tab--on': mode === m.key }"
              @click="mode = m.key"
            >
              {{ m.name }}
            </button>
          </div>

          <div class="me__body scroll-y">
            <!-- 扫条码 -->
            <div v-if="mode === 'scan'" class="me__pane">
              <MedicineScanner @detected="onDetected" />
              <div class="me__field">
                <span class="me__label">或手动输入条码</span>
                <input v-model="form.barcode" class="field" inputmode="numeric" placeholder="扫码后会自动填入" />
              </div>
            </div>

            <!-- 拍照识别 -->
            <div v-else-if="mode === 'ai'" class="me__pane">
              <div class="me__ai" :class="{ 'me__ai--busy': aiBusy }">
                <img v-if="aiPreview" :src="aiPreview" alt="待识别图片" class="me__ai-img" />
                <svg v-else width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M4 7.5h3l1.4-2h7.2L17 7.5h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.4" />
                  <circle cx="12" cy="13" r="3.4" stroke="currentColor" stroke-width="1.4" />
                </svg>
                <p class="me__ai-title">{{ aiBusy ? '正在识别…' : '拍一张药盒正面' }}</p>
                <p class="me__ai-desc">品牌、药名、规格、有效期、厂家会尽量自动填好，识别完记得核对</p>
                <button class="btn btn--primary btn--sm" :disabled="aiBusy" @click="pickImage">
                  {{ aiBusy ? '识别中…' : '拍照 / 选择图片' }}
                </button>
              </div>
            </div>

            <!-- 表单 -->
            <div class="me__form">
              <div class="me__row">
                <label class="me__field">
                  <span class="me__label">品牌</span>
                  <input v-model="form.brand" class="field" placeholder="如 同仁堂" />
                </label>
                <label class="me__field">
                  <span class="me__label">药品名 <em>*</em></span>
                  <input ref="titleEl" v-model="form.name" class="field" placeholder="如 布洛芬缓释胶囊" />
                </label>
              </div>

              <div class="me__row">
                <label class="me__field">
                  <span class="me__label">规格</span>
                  <input v-model="form.spec" class="field" placeholder="如 0.3g×20粒/盒" />
                </label>
                <label class="me__field">
                  <span class="me__label">保质期（有效期至）</span>
                  <input v-model="form.expiryDate" type="date" class="field" />
                </label>
              </div>

              <label class="me__field">
                <span class="me__label">生产厂家</span>
                <input v-model="form.manufacturer" class="field" placeholder="如 华北制药股份有限公司" />
              </label>

              <div class="me__field">
                <span class="me__label">剩余量</span>
                <div class="me__amount">
                  <div class="me__amount-row">
                    <span class="me__amount-tag">整件</span>
                    <button class="me__step" type="button" @click="bump('pack', -1)">−</button>
                    <input v-model.number="form.packCount" type="number" min="0" step="1" class="field me__stepnum" />
                    <select v-model="form.packUnit" class="field me__unit">
                      <option v-for="u in PACK_UNITS" :key="u" :value="u">{{ u }}</option>
                    </select>
                    <button class="me__step" type="button" @click="bump('pack', 1)">＋</button>
                  </div>
                  <div class="me__amount-row">
                    <span class="me__amount-tag">散装</span>
                    <button class="me__step" type="button" @click="bump('loose', -1)">−</button>
                    <input v-model.number="form.looseCount" type="number" min="0" step="1" class="field me__stepnum" />
                    <select v-model="form.looseUnit" class="field me__unit">
                      <option v-for="u in LOOSE_UNITS" :key="u" :value="u">{{ u }}</option>
                    </select>
                    <button class="me__step" type="button" @click="bump('loose', 1)">＋</button>
                  </div>
                  <p class="me__amount-hint">例如「1 盒 + 5 片」；整盒未拆就只填整件，只剩散装就把整件填 0</p>
                </div>
              </div>

              <label class="me__field">
                <span class="me__label">条码</span>
                <input v-model="form.barcode" class="field" placeholder="扫不出来可留空" />
              </label>

              <label class="me__field">
                <span class="me__label">备注</span>
                <input v-model="form.note" class="field" placeholder="如 饭后服用 / 放在冰箱" />
              </label>
            </div>

            <p v-if="errorMsg" class="me__error">{{ errorMsg }}</p>
          </div>

          <footer class="me__foot">
            <button class="btn btn--sm" @click="close">取消</button>
            <button class="btn btn--primary btn--sm" :disabled="saving" @click="submit">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </footer>

          <input ref="fileInput" type="file" accept="image/*" capture="environment" hidden @change="onImage" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.me {
  position: fixed;
  inset: 0;
  z-index: 820;
  background: rgba(0, 0, 0, 0.45);
  display: grid;
  place-items: center;
  padding: 0.8rem;
}

.me__card {
  width: min(34rem, var(--stage-w, 100%));
  max-height: 92%;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--r-lg, 1rem);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.me__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1rem 0.6rem;
}

.me__head h3 {
  font-size: 0.98rem;
  font-weight: 600;
}

.me__close {
  width: 1.6rem;
  height: 1.6rem;
  border-radius: var(--r-sm);
  color: var(--text-3);
  display: grid;
  place-items: center;
}

.me__close:hover {
  background: var(--panel-2);
  color: var(--text);
}

.me__tabs {
  display: flex;
  gap: 0.35rem;
  padding: 0 1rem 0.65rem;
}

.me__tab {
  flex: 1;
  padding: 0.4rem 0.3rem;
  border-radius: var(--r-md);
  border: 1px solid var(--border);
  font-size: 0.75rem;
  color: var(--text-2);
  background: var(--panel-2);
}

.me__tab--on {
  background: var(--primary-weak);
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 500;
}

.me__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 1rem 0.6rem;
}

.me__pane {
  margin-bottom: 0.75rem;
}

.me__form {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.me__row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.55rem;
}

.me__field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.me__label {
  font-size: 0.7rem;
  color: var(--text-3);
}

.me__label em {
  color: var(--red);
  font-style: normal;
}

.me__amount {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 0.5rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: var(--r-md);
  background: var(--panel-2);
}

.me__amount-row {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.me__amount-tag {
  font-size: 0.68rem;
  color: var(--text-3);
  width: 2.1rem;
  flex: none;
}

.me__step {
  width: 1.6rem;
  height: 1.6rem;
  flex: none;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text-2);
  font-size: 0.9rem;
  line-height: 1;
  display: grid;
  place-items: center;
}

.me__step:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.me__stepnum {
  width: 3.6rem;
  flex: none;
  text-align: center;
}

.me__amount-hint {
  font-size: 0.66rem;
  color: var(--text-3);
  line-height: 1.5;
}

.me__unit {
  width: 4.2rem;
  flex: none;
}

.me__ai {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  padding: 1rem;
  border: 1px dashed var(--border);
  border-radius: var(--r-md);
  background: var(--panel-2);
  color: var(--text-3);
  text-align: center;
}

.me__ai-img {
  width: 100%;
  max-height: 9rem;
  object-fit: contain;
  border-radius: var(--r-sm);
}

.me__ai-title {
  font-size: 0.8rem;
  color: var(--text);
  font-weight: 500;
}

.me__ai-desc {
  font-size: 0.68rem;
  line-height: 1.5;
  max-width: 20rem;
}

.me__error {
  margin-top: 0.5rem;
  font-size: 0.72rem;
  color: var(--red);
}

.me__foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.7rem 1rem 0.9rem;
  border-top: 1px solid var(--border);
}
</style>
