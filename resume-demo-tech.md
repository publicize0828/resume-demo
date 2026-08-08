# 数字人续播 Demo — 打断与续播技术说明

## 1. 背景与目标

在线课程等场景中，用户可能在数字人播报过程中提问或插话，需要先打断数字人，再在问题处理完后从打断位置继续播报。

本说明以 `demo.html` 为基准，描述如何通过自定义回调机制实现打断与续播：

- 播报内容按句子拆分，每句携带唯一编号（如 `seg_001`）
- 每句播报完成时，数字人通过 `uievent` 回调把该句编号与位置通知业务系统
- 业务系统保存进度，SDK 不保存任何进度
- 打断后从被打断的当前句重播，再继续后续内容

## 2. 分句与编号

课程内容保留为一段原始文本。页面启动时调用 `splitSentences()` 按句末标点切分：

```js
function splitSentences(text) {
  const parts = text
    .replace(/\s+/g, "")
    .split(/(?<=[。！？!?])/);
  return parts.map((s) => s.trim()).filter(Boolean);
}
```

只按 `。！？!?` 这类句末标点切分，逗号、顿号、冒号等句中标点不会断句。切分结果再生成编号：

```js
COURSE = splitSentences(COURSE_TEXT).map((text, i) => ({
  id: `seg_${String(i + 1).padStart(3, "0")}`,
  text
}));
```

因此 `seg_id` 由分句结果决定，而不是人工写死。

## 3. SSML 自定义事件

生成播报 SSML 时，每句文本后追加一个 `uievent`，data 使用结构化 XML 子标签携带 `seg_id`：

```xml
<speak>
  同学们好，今天我们学习一元一次方程的应用。
  <uievent><type>user_pause</type><data><seg_id>seg_001</seg_id></data></uievent>
  这节课我们来解决一类非常常见的实际问题——行程问题。
  <uievent><type>user_pause</type><data><seg_id>seg_002</seg_id></data></uievent>
</speak>
```

对应生成函数：

```js
function buildUserPauseEvent(segId) {
  return `<uievent><type>user_pause</type><data><seg_id>${segId}</seg_id></data></uievent>`;
}

function buildFullSSML(fromIndex = 0) {
  const body = COURSE
    .slice(fromIndex)
    .map((item) => `${item.text}${buildUserPauseEvent(item.id)}`)
    .join("");
  return `<speak>${body}</speak>`;
}
```

每句播报完成后，数字人触发 `user_pause` 回调，data 中的 `seg_id` 即该句的唯一编号，位置由业务系统根据 `seg_id` 映射得到。

## 4. 回调解析

SDK 通过 `onWidgetEvent` 回传事件。收到 `user_pause` 后，业务系统解析 `data`：

```js
function handleWidgetEvent(data) {
  if (data.type === "user_pause") {
    handleUserPause(data.data);
  }
}
```

解析函数只以 `seg_id` 作为唯一判断依据：

```js
function resolveUserPauseIndex(payload) {
  if (!payload || typeof payload.seg_id !== "string") return -1;
  return COURSE.findIndex((s) => s.id === payload.seg_id);
}
```

收到回调后采用严格模式：只有完成句等于当前句（`completedIndex === currentIndex`）才推进进度，迟到或重复的旧回调会被忽略。

`demo.html` 假定 SDK 已把 `<data>` 解析为对象；若 SDK 直接返回 XML 字符串，需要在接入侧自行转换后再调用 `resolveUserPauseIndex`。`seg_id` 缺失或解析失败时，事件日志会记录“回调无效”，进度保持不变。

## 5. 进度管理

进度全部由业务系统维护：

- `currentIndex`：当前正在播报的句子下标
- `doneSet`：已播完的句子集合
- `isPaused`：是否处于打断暂停状态
- `isFinished`：是否全部播完

### 5.1 正常推进

收到 `user_pause` 后，先校验完成句是否等于当前句，通过后再把该句加入 `doneSet` 并推进到下一句：

```js
const completedIndex = resolveUserPauseIndex(payload);
if (completedIndex !== currentIndex) return; // 严格模式：忽略非当前句回调
doneSet.add(completedIndex);
currentIndex = completedIndex + 1;
```

### 5.2 打断

```js
sdk.interactiveidle();
isPaused = true;
waitingForUserPause = false;
// currentIndex 保持不变，作为续播起点
```

### 5.3 续播

```js
sdk.speak(buildFullSSML(currentIndex), true, true);
// 从 currentIndex 对应句子重新下发，重播该句并继续
```

`buildFullSSML(fromIndex)` 只把当前句及其后的句子拼进 SSML，所以续播内容天然从打断点开始。

续播入口使用 `isResuming` 锁防止重复触发：点击后立即禁用“继续上课”按钮，等待 300ms 后复查 SDK 与状态，再下发 SSML；下发失败会恢复到“已打断”状态，可再次点击续播。

## 6. 完整流程时序

### 6.1 正常播报

1. 点击“开始上课”
2. 业务系统调用 `sdk.speak(buildFullSSML(0), true, true)`
3. 数字人逐句播报，每句完成后回调 `user_pause`，data 携带 `seg_id`
4. 业务系统校验 `seg_id` 等于当前句后，把该句标记为已播完，并高亮下一句
5. 最后一句完成后，状态置为“课程结束”

### 6.2 打断

1. 点击“打断（提问）”
2. 业务系统调用 `sdk.interactiveidle()`
3. 数字人停止播报，`voice_end` 可能随后回调
4. 业务系统保留 `currentIndex`，状态置为“已打断”

### 6.3 续播

1. 点击“继续上课（续播）”
2. 业务系统再次调用 `sdk.interactiveidle()` 确保已停止
3. 调用 `sdk.speak(buildFullSSML(currentIndex), true, true)`
4. 数字人重播被打断的当前句，再继续后续句子

### 6.4 兜底与异常处理

- 最后一句的 `user_pause` 到达后，业务系统立即调用 `updateButtons()`，保证“开始上课”可用、“打断”禁用。
- 若 `voice_end` 先于最后一句 `user_pause` 到达，业务系统会把 `currentIndex` 及之后的句子补入 `doneSet`，避免出现“课程结束但进度 15/16”的状态。
- `interactiveidle()` 调用失败时保持“播报中”，不会误切到“已打断”。
- 回调中 `seg_id` 缺失、无法解析或不是当前句时，事件日志记录“回调无效 / 回调忽略”，进度保持不变。

## 7. 真实 SDK 接入要点

参考 `demo.html`。

### 7.1 初始化

```js
sdk = new XmovAvatar({
  containerId: "#avatar-container",
  appId: SDK_CONFIG.appId,
  appSecret: SDK_CONFIG.appSecret,
  gatewayServer: SDK_CONFIG.gatewayServer,
  config: AVATAR_CONFIG,
  enableClientInterrupt: true,
  onWidgetEvent: handleWidgetEvent,
  onVoiceStateChange: handleVoiceState,
  onMessage: (msg) => log("SDK", "message", "收到 SDK 消息", msg)
});

await sdk.init({ onDownloadProgress });
await sdk.start();
```

### 7.2 播报与暂停

```js
// 开始或续播：第二个参数表示可打断，第三个参数表示可边下边播
sdk.speak(ssml, true, true);

// 打断
sdk.interactiveidle();
```

### 7.3 凭证与网关

```js
const SDK_CONFIG = {
  appId: "",
  appSecret: "",
  gatewayServer: "https://nebula-agent.xingyun3d.com/user/v1/ttsa/session"
};
```

## 8. 验收对照

- 初始化后数字人正常展示
- 页面按句末标点切分出 16 句，并生成 `seg_001 ~ seg_016`
- 点击“开始上课”后逐句播报，进度随 `user_pause` 回调推进
- 事件日志中 `user_pause` 回调携带 `seg_id`
- 播报中可打断，打断后当前句保持为续播起点
- 续播后从当前句重播并继续
- 全部播完后状态为“课程结束”
- 全部播完后按钮自动刷新为“开始上课”可用、“打断”禁用
