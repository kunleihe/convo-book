# Interactive Panel 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Interactive Panel 从聊天气泡历史列表改为以 Avatar 为中心的状态驱动界面，移除用户转录显示。

**Architecture:** InteractivePanel 维护 `isUserRecording` 本地状态，通过三路条件渲染决定 avatar 上方展示声波/loading/文字气泡，avatar 图片在 speak.gif 和 listen.gif 之间切换。无需改动 VoiceButton、useHTTPChat、useTranscriptionWebSocket 的内部逻辑。

**Tech Stack:** React 18, CSS animations (no external libraries)

> **注意：** 前端无测试基础设施，本计划以手动浏览器验证代替自动化测试。验证步骤均在 `http://localhost:5173` 执行，需先启动 dev server（`cd frontend && npm run dev`）。

---

## 文件影响范围

| 文件 | 操作 |
|------|------|
| `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx` | 修改（主要逻辑 + 渲染） |
| `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.css` | 修改（移除旧样式，新增 avatar/bubble/wave/dots 样式） |

---

## Task 1: 添加 `isUserRecording` 状态并接入 VoiceButton 回调

**Files:**
- Modify: `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx`

- [ ] **Step 1: 在 InteractivePanel.jsx 的 state 声明区新增 isUserRecording**

  在第 25 行 `const [silentHint, setSilentHint] = useState(false);` 之后，添加：

  ```jsx
  const [isUserRecording, setIsUserRecording] = useState(false);
  ```

- [ ] **Step 2: 在生命周期 effect 中重置 isUserRecording（问题/页面切换时）**

  修改第 38-51 行的 `useEffect`，在 `setCurrentUserTranscript('')` 后添加 `setIsUserRecording(false)`:

  ```jsx
  useEffect(() => {
      if (question && bookId && pageNumber) {
          transcriptionWS.clearAccumulatedTranscript();
          setCurrentUserTranscript('');
          setIsUserRecording(false);
          setSilentHint(false);
          httpChat.initialize(bookId, pageNumber, question, pageText);
          transcriptionWS.connect();
      }
      return () => {
          transcriptionWS.disconnect();
          if (silentHintTimerRef.current) clearTimeout(silentHintTimerRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question?.id, bookId, pageNumber]);
  ```

- [ ] **Step 3: 在 handleRecordingComplete 开头重置 isUserRecording**

  修改第 110 行 `handleRecordingComplete` 函数，在第一行加 `setIsUserRecording(false)`:

  ```jsx
  const handleRecordingComplete = useCallback((options = {}) => {
      setIsUserRecording(false);
      setIsProcessingTranscript(true);
      try {
          transcriptionWS.commitAudioBuffer();
          const text = transcriptionWS.getFinalTranscript();
          setCurrentUserTranscript('');
          if (options.isSilent || !text) {
              transcriptionWS.clearAccumulatedTranscript();
              setSilentHint(true);
              if (silentHintTimerRef.current) clearTimeout(silentHintTimerRef.current);
              silentHintTimerRef.current = setTimeout(() => setSilentHint(false), 3000);
          } else {
              httpChat.submitTranscript(text);
          }
      } finally {
          setIsProcessingTranscript(false);
      }
  }, [transcriptionWS, httpChat]);
  ```

- [ ] **Step 4: 在 VoiceButton 的 onRecordingStart 回调中设置 isUserRecording**

  找到第 213 行 `onRecordingStart={() => setCurrentUserTranscript('')}`，改为同时设置两个状态：

  ```jsx
  onRecordingStart={() => {
      setCurrentUserTranscript('');
      setIsUserRecording(true);
  }}
  ```

- [ ] **Step 5: 手动验证状态切换**

  启动 dev server（`cd frontend && npm run dev`），打开任意书籍进入问答面板：
  - 点击 "Start Speaking"，确认 `isUserRecording` 逻辑无报错（console 无 error）
  - 点击 "Finish Speaking"，确认无崩溃

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx
  git commit -m "feat: add isUserRecording state wired to VoiceButton callbacks"
  ```

---

## Task 2: 替换渲染为 Avatar 驱动的状态界面

**Files:**
- Modify: `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx`

- [ ] **Step 1: 在 voiceButtonDisabled 声明之前，计算 displayText 和 avatarSrc**

  在第 146 行 `const voiceButtonDisabled = ...` 之前插入：

  ```jsx
  // 气泡文字：优先显示最后一条 AI 消息，否则显示问题文字
  const lastAiMessage = httpChat.conversationMessages
      .filter((m) => m.role === 'assistant')
      .at(-1);
  const displayText = lastAiMessage?.content || question?.questionText || '';

  // Avatar 图片：录音中或加载中显示 listen，其余显示 speak
  const avatarSrc = (isUserRecording || httpChat.isLoading) ? '/listen.gif' : '/speak.gif';
  ```

- [ ] **Step 2: 将 return 中的 panel-content 内容替换为新的 Avatar 驱动布局**

  将整个 `<div className="panel-content">...</div>` 块（第 170-217 行）替换为：

  ```jsx
  <div className="panel-content">
      <div className="avatar-section">
          {/* Content above avatar — three exclusive states */}
          {isUserRecording ? (
              <div className="sound-wave">
                  {[...Array(7)].map((_, i) => (
                      <div key={i} className="wave-bar" />
                  ))}
              </div>
          ) : httpChat.isLoading ? (
              <div className="ai-bubble">
                  <div className="loading-dots">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                  </div>
              </div>
          ) : (
              <div className="ai-bubble">{displayText}</div>
          )}

          <img src={avatarSrc} alt="AI" className="avatar-image" />
      </div>

      <div className="voice-controls">
          {silentHint && (
              <p className="silent-hint">No speech detected. Please try again.</p>
          )}
          <VoiceButton
              disabled={voiceButtonDisabled}
              sharedStream={sharedStream}
              onAudioChunk={(pcm16Data) => {
                  if (transcriptionWS.isConnected) {
                      transcriptionWS.sendAudioData(pcm16Data);
                  }
              }}
              onRecordingStart={() => {
                  setCurrentUserTranscript('');
                  setIsUserRecording(true);
              }}
              onRecordingComplete={handleRecordingComplete}
          />
      </div>
  </div>
  ```

- [ ] **Step 3: 手动验证新布局加载**

  刷新 `http://localhost:5173`，进入一本书的问答面板：
  - 确认面板内显示问题文字气泡 + speak.gif avatar
  - 确认无 console error

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx
  git commit -m "feat: replace chat history with avatar-driven state render"
  ```

---

## Task 3: 更新 CSS — 移除旧聊天样式，新增 avatar/bubble/wave/dots 样式

**Files:**
- Modify: `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.css`

- [ ] **Step 1: 将 InteractivePanel.css 完整替换为新版本**

  完整新内容如下（保留 panel 外壳 + drag handle + header，移除聊天气泡，新增新组件样式）：

  ```css
  .interactive-panel {
      width: 500px;
      max-height: 60vh;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(5px);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.3);
  }

  .drag-handle {
      height: 24px;
      background: rgba(248, 249, 250, 0.8);
      cursor: grab;
      display: flex;
      justify-content: center;
      align-items: center;
      border-bottom: 1px solid rgba(0, 0, 0, 0.05);
      flex-shrink: 0;
  }

  .drag-handle:active {
      cursor: grabbing;
  }

  .drag-handle-bar {
      width: 40px;
      height: 4px;
      background-color: #cbd3da;
      border-radius: 2px;
  }

  .panel-header {
      padding: 0.2rem 1rem;
      flex-shrink: 0;
      color: #333;
  }

  .panel-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 0.5rem 1rem 1rem;
      min-height: 0;
      gap: 12px;
  }

  /* ── Avatar section ── */
  .avatar-section {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      gap: 16px;
      min-height: 0;
  }

  .avatar-image {
      width: 120px;
      height: 120px;
      border-radius: 12px;
      object-fit: contain;
  }

  /* ── AI speech bubble ── */
  .ai-bubble {
      background: #f2f2f7;
      border: 1px solid #e5e5ea;
      border-radius: 16px;
      border-bottom-left-radius: 4px;
      padding: 14px 18px;
      font-size: 18px;
      color: #333;
      line-height: 1.5;
      width: 100%;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  }

  /* ── Loading dots ── */
  .loading-dots {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 4px 2px;
  }

  .dot {
      width: 10px;
      height: 10px;
      background: #9ca3af;
      border-radius: 50%;
      animation: dotBounce 1.2s infinite ease-in-out;
  }

  .dot:nth-child(2) { animation-delay: 0.2s; }
  .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes dotBounce {
      0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
      40% { transform: scale(1); opacity: 1; }
  }

  /* ── Sound wave (recording) ── */
  .sound-wave {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      height: 60px;
      width: 100%;
  }

  .wave-bar {
      width: 6px;
      border-radius: 3px;
      background: linear-gradient(180deg, #60a5fa, #3b82f6);
      animation: waveBounce 0.8s ease-in-out infinite;
  }

  .wave-bar:nth-child(1) { height: 16px; animation-delay: 0s; }
  .wave-bar:nth-child(2) { height: 28px; animation-delay: 0.1s; }
  .wave-bar:nth-child(3) { height: 44px; animation-delay: 0.2s; }
  .wave-bar:nth-child(4) { height: 56px; animation-delay: 0.3s; }
  .wave-bar:nth-child(5) { height: 44px; animation-delay: 0.15s; }
  .wave-bar:nth-child(6) { height: 28px; animation-delay: 0.05s; }
  .wave-bar:nth-child(7) { height: 16px; animation-delay: 0.25s; }

  @keyframes waveBounce {
      0%, 100% { transform: scaleY(0.4); opacity: 0.6; }
      50% { transform: scaleY(1); opacity: 1; }
  }

  /* ── Voice controls ── */
  .voice-controls {
      text-align: center;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
  }

  .silent-hint {
      color: #e53e3e;
      font-size: 0.85rem;
      margin: 0 0 8px 0;
      animation: fadeIn 0.3s ease-in;
  }

  @keyframes fadeIn {
      from { opacity: 0; transform: translateY(5px); }
      to { opacity: 1; transform: translateY(0); }
  }
  ```

- [ ] **Step 2: 手动验证全部三个状态的视觉效果**

  在 `http://localhost:5173` 进入问答面板：

  | 操作 | 预期 |
  |------|------|
  | 面板初始打开（问题 TTS 播放中） | speak.gif + 文字气泡（问题文字） |
  | AI 说完后，idle 状态 | speak.gif + 文字气泡（问题文字） |
  | 点击 Start Speaking | listen.gif + 蓝色声波均衡器动效 |
  | 点击 Finish Speaking，等待 API | listen.gif + 三点 loading 气泡 |
  | AI 回复播放中 | speak.gif + AI 回复文字气泡 |

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/src/components/BookReader/InteractivePanel/InteractivePanel.css
  git commit -m "style: replace chat bubble styles with avatar/wave/dots layout"
  ```

---

## Task 4: 移除死代码

**Files:**
- Modify: `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx`

- [ ] **Step 1: 移除 currentUserTranscript state、delta 回调及所有 setter 调用**

  删除 state 声明：
  ```jsx
  // 删除这行
  const [currentUserTranscript, setCurrentUserTranscript] = useState('');
  ```

  将 `useTranscriptionWebSocket` 的 delta 回调改为 no-op：
  ```jsx
  const transcriptionWS = useTranscriptionWebSocket(
      useCallback(() => {}, [])
  );
  ```

  删除生命周期 effect 中的调用：
  ```jsx
  // 删除这行（位于 transcriptionWS.clearAccumulatedTranscript() 之后）
  setCurrentUserTranscript('');
  ```

  删除 `handleRecordingComplete` 中的调用：
  ```jsx
  // 删除这行（位于 getFinalTranscript() 之后）
  setCurrentUserTranscript('');
  ```

  删除 VoiceButton `onRecordingStart` 回调中的调用，简化为：
  ```jsx
  onRecordingStart={() => setIsUserRecording(true)}
  ```

- [ ] **Step 2: 移除 messagesEndRef 和 auto-scroll effect**

  删除：
  ```jsx
  const messagesEndRef = useRef(null);
  ```

  删除整个 auto-scroll effect（第 72-74 行）：
  ```jsx
  // 删除这段
  useEffect(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [httpChat.conversationMessages, currentUserTranscript]);
  ```

- [ ] **Step 3: 移除 renderMessage 函数**

  删除第 130-144 行整个 `renderMessage` 函数。

- [ ] **Step 4: 确认 import 无遗留**

  检查顶部 import，若 `useRef` 或 `useState` 已无用处则可移除，但通常仍被其他逻辑使用——不强制删。确认无 lint error：

  ```bash
  cd frontend && npm run lint
  ```

  预期：无新增 error（原有 eslint-disable 注释可保留）。

- [ ] **Step 5: 手动验证功能完整**

  完整走一遍问答流程：
  1. 打开书本，进入有问题的页面
  2. 等 AI 问题 TTS 播完
  3. 点 Start Speaking → 说一句话 → 点 Finish Speaking
  4. 等 AI loading → AI 回复播放
  5. 确认 console 无 error，三个状态视觉效果均正确

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx
  git commit -m "refactor: remove dead transcription display code"
  ```
