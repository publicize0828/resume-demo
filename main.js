/**
 * 数字人续播 Demo — UI 绑定 & 初始化
 *
 * 依赖：core.js（先加载）
 * 职责：DOM 操作、事件绑定
 */

/* ---------- DOM 引用 ---------- */
const $ = id => document.getElementById(id)
const els = {
  appIdInput: $('appIdInput'), appSecretInput: $('appSecretInput'),
  secretToggle: $('secretToggle'),
  statusChip: $('statusChip'), statusText: $('statusText'),
  progressText: $('progressText'), miniBar: $('miniBar'),
  sdkBadge: $('sdkBadge'),
  avatarScene: $('avatarScene'), questionPill: $('questionPill'),
  bubbleTag: $('bubbleTag'), anchorNote: $('anchorNote'),
  speechText: $('speechText'), segTrack: $('segTrack'),
  sentenceList: $('sentenceList'), eventLog: $('eventLog'), logCount: $('logCount'),
  loadingMask: $('loading-mask'), progressBar: $('progress-bar'), loadingText: $('loading-text'),
  toast: $('toast'), toastText: $('toastText'),
  btnInit: $('btnInit'), btnDestroy: $('btnDestroy'),
  btnStart: $('btnStart'), btnInterrupt: $('btnInterrupt'), btnResume: $('btnResume'),
}

/* ---------- SVG 图标 ---------- */
const EYE_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`
const EYE_OFF_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
const CHECK_ICON  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`
const PLAY_ICON   = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>`
const CROSS_ICON  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`

/* ---------- Toast ---------- */
let toastTimer = null
function showToast(msg) {
  els.toastText.textContent = msg; els.toast.classList.add('show')
  clearTimeout(toastTimer); toastTimer = setTimeout(() => els.toast.classList.remove('show'), 3200)
}

/* ---------- 日志 ---------- */
function nowTime() {
  const d = new Date(); const p = n => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function appendLog(channel, name, msg, payload) {
  const line = document.createElement('div'); line.className = 'log-line'
  const time = document.createElement('span'); time.className = 'log-time'; time.textContent = nowTime()
  const badge = document.createElement('span'); badge.className = `log-type ${channel.toLowerCase()}`; badge.textContent = channel.toUpperCase()
  const body = document.createElement('span'); body.className = 'log-msg'; body.textContent = `${name} · ${msg}`
  if (payload !== undefined) { const json = document.createElement('span'); json.className = 'log-json'; json.textContent = JSON.stringify(payload); body.appendChild(json) }
  line.append(time, badge, body)
  els.eventLog.appendChild(line); els.logCount.textContent = els.eventLog.children.length
  els.eventLog.scrollTop = els.eventLog.scrollHeight
}

/* ---------- 句子列表 & 进度条 ---------- */
function buildSentenceList(course) {
  const frag = document.createDocumentFragment()
  course.forEach(s => {
    const row = document.createElement('div'); row.className = 'sent-row'
    const badge = document.createElement('span'); badge.className = 'seg-badge'; badge.textContent = s.id
    const main = document.createElement('div'); main.className = 'sent-main'
    const text = document.createElement('div'); text.className = 'sent-text'; text.textContent = s.text
    const stateEl = document.createElement('span'); stateEl.className = 'sent-state'; stateEl.textContent = '待播报'
    main.append(text, stateEl); row.append(badge, main); frag.appendChild(row)
  })
  els.sentenceList.appendChild(frag)
}

function buildProgressTrack(total) {
  const frag = document.createDocumentFragment()
  for (let i = 0; i < total; i++) { const cell = document.createElement('div'); cell.className = 'seg-cell'; cell.title = `seg_${String(i+1).padStart(3,'0')}`; frag.appendChild(cell) }
  els.segTrack.appendChild(frag)
}

/* ---------- UI 刷新 ---------- */
function updateButtons() {
  els.btnInit.disabled = isSDKConnected() || isSDKInitializing() || isSDKDestroying()
  els.btnDestroy.disabled = !isSDKConnected() || isSDKDestroying()
  els.btnStart.disabled = !isSDKConnected() || getState() === 'playing'
  els.btnInterrupt.disabled = getState() !== 'playing'
  els.btnResume.disabled = getState() !== 'interrupted' || getResumeState()
}

function onProgressChange(done, total, currentIdx, st) {
  els.progressText.textContent = `${done}/${total}`
  els.miniBar.style.width = `${(done / total) * 100}%`

  document.querySelectorAll('.seg-cell').forEach((cell, i) => {
    cell.className = 'seg-cell'
    if (doneSet.has(i)) cell.classList.add('is-done')
    if (i === currentIdx && (st === 'playing' || st === 'interrupted')) cell.classList.add('is-current')
    if (i === currentIdx && st === 'interrupted') cell.classList.add('is-break')
  })

  Array.from(els.sentenceList.children).forEach((row, i) => {
    row.className = 'sent-row'
    if (doneSet.has(i)) row.classList.add('is-done')
    if (i === currentIdx && (st === 'playing' || st === 'interrupted')) row.classList.add('is-current')
    if (i === currentIdx && st === 'interrupted') row.classList.add('is-break')
    const se = row.querySelector('.sent-state')
    if (i === currentIdx && st === 'interrupted') se.innerHTML = `${CROSS_ICON}打断点`
    else if (i === currentIdx && st === 'playing') se.innerHTML = `${PLAY_ICON}播报中`
    else if (doneSet.has(i)) se.innerHTML = `${CHECK_ICON}已播报`
    else se.textContent = '待播报'
  })
}

function onStateChange(st, label) {
  els.statusChip.dataset.state = st; els.statusText.textContent = label
  if (isSDKConnected()) els.sdkBadge.textContent = { idle: 'SDK 已就绪', connecting: 'SDK 连接中', playing: 'SDK 播报中', interrupted: 'SDK 已暂停', finished: 'SDK 播报完成' }[st] || 'SDK 已就绪'
  els.avatarScene.classList.remove('is-connecting', 'is-speaking', 'is-interrupted', 'is-finished')
  if (st !== 'idle') els.avatarScene.classList.add(`is-${st}`)
}

function onCurrentSentence(idx) {
  if (idx < 0) { els.bubbleTag.textContent = '--'; els.speechText.textContent = '课程内容已就绪'; return }
  const course = getCourse()
  els.bubbleTag.textContent = course[idx].id; els.speechText.textContent = course[idx].text
  els.anchorNote.textContent = getState() === 'interrupted' ? `已保留进度：${course[idx].id}` : `正在播报：${course[idx].id}`
  const row = els.sentenceList.children[idx]; if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

function onReset() {
  els.questionPill.classList.remove('show')
  els.bubbleTag.textContent = '--'; els.speechText.textContent = '课程内容已就绪'; els.anchorNote.textContent = '等待开始播报'
  els.sdkBadge.textContent = 'SDK 未连接'; els.statusText.textContent = '未初始化'
  els.loadingMask.classList.add('hidden')
}

function onDownloadProgress(p) {
  els.progressBar.style.width = `${p}%`; els.loadingText.textContent = `正在加载资源 ${p}%`
}
function onSDKReady() { els.loadingMask.classList.add('hidden') }

/* ---------- 注册回调 & 事件绑定 ---------- */
function init() {
  callbacks.onStateChange = onStateChange
  callbacks.onProgressChange = onProgressChange
  callbacks.onCurrentSentence = onCurrentSentence
  callbacks.onLog = appendLog
  callbacks.onToast = showToast
  callbacks.onUpdateButtons = updateButtons
  callbacks.onDownloadProgress = onDownloadProgress
  callbacks.onSDKReady = onSDKReady
  callbacks.onReset = onReset

  // 按钮事件
  els.btnInit.addEventListener('click', () => {
    const appId = els.appIdInput.value.trim()
    const appSecret = els.appSecretInput.value.trim()
    if (!appId || !appSecret) {
      els.appIdInput.classList.toggle('is-invalid', !appId)
      els.appSecretInput.classList.toggle('is-invalid', !appSecret)
      showToast('请先填写 AppId 和 AppSecret'); return
    }
    els.appIdInput.classList.remove('is-invalid'); els.appSecretInput.classList.remove('is-invalid')
    els.loadingMask.classList.remove('hidden')
    els.loadingText.textContent = '正在连接数字人...'; els.progressBar.style.width = '0%'
    initSDK({ appId, appSecret, gatewayServer: SDK_CONFIG.gatewayServer })
  })
  els.btnDestroy.addEventListener('click', destroySDK)
  els.btnStart.addEventListener('click', startClass)
  els.btnInterrupt.addEventListener('click', interrupt)
  els.btnResume.addEventListener('click', resume)

  // 凭据输入校验
  els.appIdInput.addEventListener('input', () => els.appIdInput.classList.remove('is-invalid'))
  els.appSecretInput.addEventListener('input', () => els.appSecretInput.classList.remove('is-invalid'))
  els.secretToggle.addEventListener('click', () => {
    const show = els.appSecretInput.type === 'password'
    els.appSecretInput.type = show ? 'text' : 'password'
    els.secretToggle.innerHTML = show ? EYE_OFF_ICON : EYE_ICON
  })

  // 页面卸载清理
  window.addEventListener('pagehide', () => destroySDK())
  window.addEventListener('beforeunload', () => destroySDK())

  // 初始化课程数据 & UI
  const course = buildCourse(COURSE_TEXT)
  buildSentenceList(course); buildProgressTrack(course.length)
  updateButtons()

  appendLog('BUS', 'Demo 就绪', '业务系统已注册数字人回调，SDK 不保存进度')
  appendLog('BUS', '分句完成', `按句末标点切分为 ${course.length} 句`, { segIds: course.map(s => s.id) })
}

document.addEventListener('DOMContentLoaded', init)
