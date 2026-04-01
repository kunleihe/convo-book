# Interactive Panel 重构设计

**日期:** 2026-03-31  
**状态:** 已批准

## 目标

将 Interactive Panel 从聊天气泡历史列表改为以 Avatar 为中心的状态驱动界面。移除用户转录显示，聚焦当前交互状态，提升儿童用户的感知清晰度。

## 三种 UI 状态

### 状态 1：AI 说话（问题播放 / AI 回复播放）

- **Avatar**: `speak.gif`
- **气泡**: avatar 上方，显示当前文字内容
  - 初始：问题文字（`question.questionText`）
  - AI 回复后：`httpChat.conversationMessages` 中最后一条 AI 消息
- **按钮**: Start Speaking（置灰，`disabled`）
- **触发条件**: `isAudioPlaying || httpChat.isAiSpeaking`，或默认 idle 状态

### 状态 2：用户录音中

- **Avatar**: `listen.gif`
- **动效**: avatar 上方显示声波动效（7 根竖条均衡器风格，蓝色渐变，CSS 动画交错反弹）
- **按钮**: Finish Speaking（红色，激活）
- **触发条件**: `isUserRecording === true`

### 状态 3：AI 思考中（等待响应）

- **Avatar**: `listen.gif`
- **气泡**: avatar 上方，内含三点 loading 动效（三个圆点交错弹跳）
- **按钮**: Start Speaking（置灰，`disabled`）
- **触发条件**: `httpChat.isLoading === true`

### 优先级（有冲突时）

```
isUserRecording > httpChat.isLoading > 默认(AI 说话/idle)
```

## 状态数据来源

| UI 状态 | 触发字段 |
|---------|---------|
| AI 说话 | `isAudioPlaying \|\| httpChat.isAiSpeaking` 或 idle |
| 用户录音 | `isUserRecording`（本地 state，由 `onRecordingStart`/`onRecordingComplete` 驱动）|
| AI 思考 | `httpChat.isLoading` |

`isUserRecording` 是 InteractivePanel 本地新增 state，通过已有的 `onRecordingStart` 回调设为 `true`，通过 `onRecordingComplete` 回调设为 `false`。无需改动 VoiceButton 内部逻辑。

## 移除内容

- 聊天历史列表（`httpChat.conversationMessages.map(renderMessage)`）
- 用户气泡（`user-message` 样式类）
- Ghost transcription 气泡（`currentUserTranscript` 状态及其渲染）
- `messagesEndRef` 及 auto-scroll 逻辑
- `renderMessage` 函数
- `currentUserTranscript` state 及相关 transcription delta 回调

`useTranscriptionWebSocket` 和 `useHTTPChat` 的数据流逻辑保持不变，只移除展示层。

## 保留内容

- `useHTTPChat` 和 `useTranscriptionWebSocket` hooks（逻辑不变）
- `handleRecordingComplete`（提交转录逻辑不变）
- question counter（`Question X of Y`）
- `silentHint`（未检测到语音的提示）
- drag handle、panel header、panel-content 整体结构
- VoiceButton 组件（无需修改）

## 气泡文字来源

```
显示文字 = 
  最后一条 AI conversationMessage（如有）
  否则 question.questionText
```

## 文件影响范围

- `InteractivePanel.jsx` — 主要改动（状态逻辑 + 渲染）
- `InteractivePanel.css` — 移除聊天气泡样式，新增声波和 loading 样式
- `VoiceButton.jsx` — 不改动
