/**
 * 数字人续播 Demo — 核心业务逻辑
 *
 * 关注点：SDK 生命周期、分句/SSML 生成、状态机、进度管理、打断与续播。
 * 不操作 DOM，不绑定事件——UI 层通过回调接入。
 */

/* ---------- 配置 ---------- */
const SDK_CONFIG = {
  appId: 'd37919f1ebf34c829f831836ce8149a9',
  appSecret: 'a3631d111a574fc28b270440c89c5eaa',
  gatewayServer: 'https://nebula-agent.xingyun3d.com/user/v1/ttsa/session',
}

const AVATAR_CONFIG = {
  layout: {
    container: { size: [1080, 1920] },
    avatar: { v_align: 'center', h_align: 'middle', scale: 0.5, offset_x: 140, offset_y: 200 },
  },
}

const COURSE_TEXT =
  "同学们好，今天我们学习一元一次方程的应用。" +
  "这节课我们来解决一类非常常见的实际问题——行程问题。" +
  "行程问题主要涉及速度、时间和路程这三个基本量。" +
  "它们之间的关系是：路程等于速度乘以时间。" +
  "我们来看一个具体的例子。" +
  "小明从家出发去学校，家到学校的距离是2400米。" +
  "小明步行的速度是每分钟80米。那么小明需要多长时间才能到达学校呢？" +
  "这个问题我们设小明需要x分钟到达学校。" +
  "根据路程等于速度乘以时间的公式，我们可以列出方程：80x等于2400。" +
  "解这个方程，两边同时除以80，得到x等于30。" +
  "所以小明需要30分钟到达学校。" +
  "同学们，你们理解了这个解题思路吗？" +
  "接下来我们再来看一个更复杂一点的例子。" +
  "小华和小红从相距3000米的两地同时相向而行，小华的速度是每分钟100米，小红的速度是每分钟50米，他们多久后相遇？" +
  "这个问题同样可以用一元一次方程来解决。"

/* ---------- 状态常量 ---------- */
const STATUS_MAP = {
  idle: '未开始', connecting: '连接中', playing: '播报中',
  interrupted: '已打断 · 可续播', finished: '课程结束',
}

/* ---------- 内部状态（外部只读） ---------- */
let sdk = null
let COURSE = []         // { id, text }[]
let currentIndex = 0    // 当前正在播的句子下标
const doneSet = new Set()

let state = 'idle'       // idle | connecting | playing | interrupted | finished
let isConnected = false
let isInitializing = false
let isDestroying = false
let isPaused = true
let isFinished = false
let hasStarted = false
let waitingForUserPause = false
let isResuming = false

/* ---------- 分句 & SSML ---------- */
function splitSentences(text) {
  return text.replace(/\s+/g, '').split(/(?<=[。！？!?])/).map(s => s.trim()).filter(Boolean)
}

function buildCourse(text) {
  COURSE = splitSentences(text).map((t, i) => ({
    id: `seg_${String(i + 1).padStart(3, '0')}`, text: t,
  }))
  return COURSE
}

function buildUserPauseEvent(segId) {
  return `<uievent><type>user_pause</type><data><seg_id>${segId}</seg_id></data></uievent>`
}

function buildFullSSML(fromIndex = 0) {
  const body = COURSE.slice(fromIndex).map(s => `${s.text}${buildUserPauseEvent(s.id)}`).join('')
  return `<speak>${body}</speak>`
}

/* ---------- 回调集（UI 层注入） ---------- */
const callbacks = {
  onStateChange: null,    // (state, detail)
  onProgressChange: null, // (doneCount, total)
  onCurrentSentence: null,// (index)
  onLog: null,            // (channel, name, msg, payload?)
  onToast: null,          // (message)
  onUpdateButtons: null,  // ()
}

/* ---------- 进度 ---------- */
function resolveUserPauseIndex(payload) {
  if (!payload || typeof payload.seg_id !== 'string') return -1
  return COURSE.findIndex(s => s.id === payload.seg_id)
}

function handleUserPause(payload) {
  if (!hasStarted || isPaused || isFinished || !waitingForUserPause) return

  const completedIndex = resolveUserPauseIndex(payload)
  if (completedIndex !== currentIndex) {
    if (completedIndex >= 0) {
      log('BUS', '回调忽略', `seg_id 非当前句：${payload.seg_id}`)
    } else {
      log('BUS', '回调无效', 'seg_id 缺失或无法解析', payload ?? null)
    }
    return
  }

  // 最后一句 → 结束
  if (completedIndex >= COURSE.length - 1) {
    doneSet.add(completedIndex)
    waitingForUserPause = false
    isFinished = true
    setState('finished')
    notifyProgress()
    log('BUS', '课程结束', '全部句子播报完成', { played: doneSet.size })
    return
  }

  doneSet.add(completedIndex)
  currentIndex = completedIndex + 1
  callbacks.onCurrentSentence?.(currentIndex)
  notifyProgress()
}

/* ---------- 动作：开始 / 打断 / 续播 ---------- */
function startClass() {
  if (!sdk || !isConnected || state === 'playing') return

  doneSet.clear()
  currentIndex = 0
  isPaused = false; isFinished = false; hasStarted = true
  waitingForUserPause = true
  setState('playing')
  callbacks.onCurrentSentence?.(0)
  notifyProgress()
  log('BUS', '开始上课', `下发 ${COURSE.length} 句`, { total: COURSE.length })
  sdk.speak(buildFullSSML(0), true, true)
}

function interrupt() {
  if (state !== 'playing' || !sdk) return
  try { sdk.interactiveidle() } catch (e) { log('BUS', 'interrupt 失败', String(e)); return }
  isPaused = true; waitingForUserPause = false
  setState('interrupted')
  callbacks.onCurrentSentence?.(currentIndex)
  notifyProgress()
  log('BUS', 'interrupt()', `保留 ${COURSE[currentIndex]?.id} 为续播起点`, {
    progress: currentIndex, sentenceId: COURSE[currentIndex]?.id,
  })
}

async function resume() {
  if (state !== 'interrupted' || !sdk || !isConnected || isResuming) return
  isResuming = true
  callbacks.onUpdateButtons?.()

  try {
    try { sdk.interactiveidle() } catch (_) {}
    await new Promise(r => setTimeout(r, 300))
    if (!sdk || !isConnected || state !== 'interrupted') return

    isPaused = false; isFinished = false
    waitingForUserPause = true; hasStarted = true
    setState('playing')
    callbacks.onCurrentSentence?.(currentIndex)
    notifyProgress()
    log('BUS', '续播', `从 ${COURSE[currentIndex]?.id} 重播`)
    sdk.speak(buildFullSSML(currentIndex), true, true)
  } catch (e) {
    isPaused = true; waitingForUserPause = false
    setState('interrupted')
    callbacks.onCurrentSentence?.(currentIndex)
    notifyProgress()
    log('BUS', '续播失败', '已恢复到已打断状态')
  } finally {
    isResuming = false
    callbacks.onUpdateButtons?.()
  }
}

/* ---------- SDK 生命周期 ---------- */
async function initSDK(customConfig) {
  if (isConnected || isInitializing || isDestroying) return
  if (!window.XmovAvatar) { log('SDK', 'init 失败', 'SDK 脚本未加载'); return }

  const config = customConfig || SDK_CONFIG
  if (!config.appId || !config.appSecret) {
    callbacks.onToast?.('请先填写 AppId 和 AppSecret'); return
  }

  isInitializing = true; setState('connecting')
  callbacks.onUpdateButtons?.()
  log('SDK', 'init', '开始初始化', config)

  try {
    sdk = new XmovAvatar({
      containerId: '#avatar-container',
      appId: config.appId, appSecret: config.appSecret,
      gatewayServer: config.gatewayServer,
      config: AVATAR_CONFIG, enableClientInterrupt: true,
      onWidgetEvent: handleWidgetEvent,
      onVoiceStateChange: handleVoiceState,
      onMessage: msg => log('SDK', 'message', 'SDK 消息', msg),
    })
    await sdk.init({ onDownloadProgress: p => callbacks.onDownloadProgress?.(p) })
    await sdk.start()
    isConnected = true
    setState('idle')
    log('SDK', 'connected', '数字人初始化完成')
    callbacks.onSDKReady?.()
  } catch (e) {
    console.error(e)
    setState('idle')
    log('SDK', 'init error', e.message || String(e))
    if (sdk) { try { await sdk.destroy() } catch (_) {}; sdk = null }
  } finally {
    isInitializing = false; callbacks.onUpdateButtons?.()
  }
}

async function destroySDK() {
  if (!sdk || isDestroying) return
  isDestroying = true; callbacks.onUpdateButtons?.()
  try { await sdk.stop(); await sdk.destroy(); log('SDK', 'destroyed', '已销毁') } catch (e) {
    log('SDK', 'destroy error', e.message || String(e))
  } finally {
    sdk = null; isConnected = false; isDestroying = false
    doneSet.clear(); currentIndex = 0
    isPaused = true; isFinished = false; hasStarted = false
    waitingForUserPause = false
    setState('idle'); callbacks.onReset?.(); callbacks.onUpdateButtons?.()
  }
}

/* ---------- SDK 回调 ---------- */
function handleWidgetEvent(data) {
  if (['subtitle_on', 'subtitle_off', 'user_pause', 'voice_start', 'voice_end'].includes(data.type)) {
    log('WIDGET', data.type, '数字人回调', data)
  }
  if (data.type === 'user_pause') handleUserPause(data.data)
}

function handleVoiceState(stateName) {
  log('VOICE', stateName, stateName === 'voice_start' ? '开始发声' : '结束发声')
  if (stateName === 'voice_end' && hasStarted && !isPaused && !isFinished) {
    for (let i = Math.max(0, currentIndex); i < COURSE.length; i++) doneSet.add(i)
    currentIndex = COURSE.length; isFinished = true; waitingForUserPause = false
    setState('finished'); notifyProgress()
    log('BUS', '课程结束', 'voice_end 兜底结束', { played: doneSet.size })
  }
}

/* ---------- 工具 ---------- */
function setState(next) { state = next; callbacks.onStateChange?.(next, STATUS_MAP[next]) }
function notifyProgress() { callbacks.onProgressChange?.(doneSet.size, COURSE.length, currentIndex, state) }
function log(channel, name, msg, payload) { callbacks.onLog?.(channel, name, msg, payload) }

/* ---------- 公开 API ---------- */
function getState() { return state }
function getCourse() { return COURSE }
function getCurrentIndex() { return currentIndex }
function getDoneSet() { return doneSet }
function isSDKConnected() { return isConnected }
function isSDKInitializing() { return isInitializing }
function isSDKDestroying() { return isDestroying }
function getSDK() { return sdk }
function getResumeState() { return isResuming }
function getFinished() { return isFinished }
