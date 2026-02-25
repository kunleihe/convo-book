# 重构计划：替换 Realtime API 为 HTTP API + 启用 VAD 实时转录

## 背景

当前 app 使用 OpenAI Realtime API（WebSocket）同时处理 AI 回复和语音转录，导致：
1. AI 回复逻辑耦合在 WebSocket 中，难以控制 2 轮对话模型
2. 无法逐字实时显示转录文字（VAD 未开启）
3. 书本数据分散在多个 YAML 文件中，不便管理

目标：用 HTTP API 替换 AI 回复生成，保留转录 WebSocket 并开启 VAD，实现严格 2 轮对话，并将 speed-racer 重构为单文件 YAML 格式。

---

## 完整数据流

```
[用户按下录音键]
  → PCM16 音频实时流向 /transcription WebSocket（VAD 已开启）
  → 服务器边收边识别 → delta 事件 → 前端实时显示逐字转录

[用户再次按下录音键结束录音]
  → commitAudioBuffer()（兜底 flush）
  → getFinalTranscript() 拼接完整文字
  → POST /api/chat  {transcript, page_text, question_text, custom_prompt, round_number, conversation_history}
  → 后端：加载 model-settings-en.yaml，构建 round1/2 系统 prompt，调用 gpt-4.1-mini
  → 返回 {response, is_final}
  → POST /api/tts  {text: response}
  → 后端：调用 gpt-4o-mini-tts（sage，instructions 控制语速），流式返回 MP3 分片
  → 前端：MediaSource API 边收分片边播放（降级：AudioContext.decodeAudioData）

[is_final=true 或第 2 轮结束]
  → questionComplete=true → VoiceButton 禁用 → BookReader Next 按钮解锁
```

---

## 关键设计细节

### `${CUSTOM_PROMPT_BLOCK}` 替换逻辑

- **有 `customPrompt`**（该问题在 YAML 里定义了预期答案）：
  ```
  the expected answer: "[customPrompt]"

  For hints, you may also refer to the reference passage below:
  ```
- **无 `customPrompt`**（纯开放性问题）：
  ```
  the reference passage below:
  ```

### 对话历史结构

**初始问题以 `assistant` 消息的形式放入对话历史**：

```js
conversation_history = [
  { role: "assistant", content: questionText },  // 初始问题（AI 问的），initialize() 时预置
  { role: "user",      content: "用户第一次回答" },
  { role: "assistant", content: "AI 第一次回复" },  // Round 1 结束后追加
  { role: "user",      content: "用户第二次回答" },  // 如果进入 Round 2
]
```

后端 `/api/chat` 接收的 `conversation_history` **不含**当前这一轮的用户输入，`transcript` 单独传递。
后端构造 messages 数组：

```python
messages = [
    {"role": "system", "content": round_N_prompt},
    *conversation_history,
    {"role": "user", "content": transcript}   # 本轮用户输入
]
```

---

## 新书本 YAML 格式（无语言区分，全英文）

```yaml
metadata:
  id: speed-racer
  title: Speed Racer
  uri_prefix: books/speed-racer/   # S3 key 前缀（非 s3:// 协议，直接是相对 bucket 的路径）
  cover_uri: images/cover.png

pages:
  - page_number: 1
    image_uri: images/page-01.png
    narration_uri: audios/narration/page-01.wav
    text: |
      It was a bright and sunny day...
    questions: []

  - page_number: 7
    image_uri: images/page-07.png
    narration_uri: audios/narration/page-07.wav
    text: |
      The three friends looked at Camilla's car...
    questions:
      - id: q1
        text: How is Camilla's car different from Elinor's car?
        audio_uri: audios/questions/page-07-q1.mp3
        # custom_prompt 缺省：纯开放性问题
      - id: q2
        text: What can Elinor and her friends do to make their car go faster?
        audio_uri: audios/questions/page-07-q2.mp3
        custom_prompt: Expected answer text here...

  - page_number: 18
    image_uri: images/page-18.png
    narration_uri: audios/narration/page-18.wav
    text: |
      Olive took out her notebook...
    questions:
      - id: q1
        text: How is the shape of Camilla's car different from Elinor's car?
        audio_uri: audios/questions/page-18-q1.mp3
        custom_prompt: Elinor's car looks like a box, but Camilla's car is round and smooth.
```

**字段映射**（新格式 → 前端期望）：

| 新格式字段 | 前端字段 | 备注 |
|-----------|---------|------|
| `metadata.cover_uri` + `uri_prefix` | `coverImageUrl` | 预签名 URL |
| `len(pages)` | `totalPages` | 动态计算 |
| `page.page_number` | `pageNumber` | |
| `page.image_uri` + `uri_prefix` | `imageUrl` | 预签名 URL |
| `page.narration_uri` + `uri_prefix` | `narrationAudioUrl` | 预签名 URL |
| `page.text` | `storyText` | |
| `page.questions[]` | `questions[]` | |
| `question.text` | `questionText` | |
| `question.audio_uri` + `uri_prefix` | `audioUrl` | 预签名 URL |
| `question.custom_prompt` | `customPrompt` | 可选，无则 null |

---

## 需要创建/修改的文件

### 新建

| 文件 | 说明 |
|------|------|
| `backend/data/model-settings-en.yaml` | 从 `references/model-settings-en.yaml` 复制后修改 |
| `backend/data/books/speed-racer.yaml` | speed-racer 单文件 YAML（30 页合并） |
| `backend/app/routes/chat.py` | `POST /api/chat` 端点 |
| `backend/app/routes/tts.py` | `POST /api/tts` 端点 |
| `frontend/src/hooks/useHTTPChat.js` | 新 HTTP 聊天 hook，替换 `usePageVoiceChat` |

### 修改

| 文件 | 修改内容 |
|------|---------|
| `backend/app/config.py` | `TRANSCRIPTION_CONFIG["turn_detection"]` 改为 server_vad |
| `backend/app/routes/books.py` | 重写为仅支持新单文件 YAML 格式，删除旧格式相关代码 |
| `backend/data/books/speed-racer/` | **删除**整个旧格式目录 |
| `backend/app/main.py` | 注册 `chat_router`, `tts_router` |
| `frontend/src/hooks/useTranscriptionWebSocket.js` | 开启 VAD + `onTranscriptionDelta` 回调 + `getFinalTranscript()` + `clearAccumulatedTranscript()` |
| `frontend/src/components/BookReader/BookReader.jsx` | 传 `pageText` prop + `questionComplete` 锁定 Next 按钮 |
| `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx` | 接线 `useHTTPChat`，实时显示转录幽灵气泡 |

---

## 详细实现

### 步骤 1：`backend/data/books/speed-racer.yaml`

将 30 个分散 YAML 合并为单文件：
- `uri_prefix: books/speed-racer/`（对应现有 S3 key 前缀）
- 旧路径 `/speed-racer/images/page-01.png` → 新相对路径 `images/page-01.png`
- 旧路径 `/speed-racer/audios/narration/page-01.wav` → `audios/narration/page-01.wav`
- 旧字段 `answerText` → 新字段 `custom_prompt`
- 旧字段 `follow-up`、`promptTemplate`、`questionType` → **删除**（新模型 AI 自行生成 follow-up）
- 无问题页面使用 `questions: []`
- 旧格式目录 `backend/data/books/speed-racer/` **删除**（不再需要旧格式）

### 步骤 2：`backend/data/model-settings-en.yaml`

从 `references/model-settings-en.yaml` 复制，然后分别在两个模板末尾追加 JSON 格式说明（OpenAI `json_object` mode 要求 prompt 中必须出现 "JSON" 字样，两轮都需要）：

```yaml
round1PromptTemplate: |
  ... （原有内容不变）

  Respond in JSON: {"response": "<your feedback text>", "is_final": true/false}

round2PromptTemplate: |
  ... （原有内容不变）

  Respond in JSON: {"response": "<your feedback text>"}
```

后端对 round 2 强制 `is_final = True`，模型只需返回 `response` 字段。

### 步骤 3：`backend/app/config.py`

```python
TRANSCRIPTION_CONFIG = {
    "input_audio_format": "pcm16",
    "input_audio_transcription": {
        "model": "gpt-4o-transcribe",
        "prompt": "",
        "language": "en"
    },
    "turn_detection": {          # 从 None 改为 server_vad
        "type": "server_vad",
        "threshold": 0.5,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 500
    },
    "input_audio_noise_reduction": {"type": "near_field"},
    "include": ["item.input_audio_transcription.logprobs"]
}
```

### 步骤 4：`backend/app/routes/chat.py`

```python
POST /api/chat

class ChatRequest(BaseModel):
    transcript: str
    page_text: str
    question_text: str
    custom_prompt: Optional[str] = None
    round_number: int = 1
    conversation_history: List[dict] = []
```

- 用 `functools.lru_cache` 缓存 `model-settings-en.yaml`
- 根据 `round_number` 选择模板：
  ```python
  template = settings["round1PromptTemplate"] if round_number == 1 else settings["round2PromptTemplate"]
  ```
- 替换模板变量：**必须用 `str.replace()`，不能用 `.format()`**（占位符是 `${}` 语法，Python `.format()` 会报 `KeyError`）：
  ```python
  system_prompt = template \
      .replace('${pageText}', page_text) \
      .replace('${questionText}', question_text) \
      .replace('${CUSTOM_PROMPT_BLOCK}', custom_prompt_block)
  ```
- `CUSTOM_PROMPT_BLOCK` 替换逻辑：
  ```python
  if custom_prompt:
      block = f'the expected answer: "{custom_prompt}"\n\nFor hints, you may also refer to the reference passage below:'
  else:
      block = 'the reference passage below:'
  ```
- 构造 messages 数组（`conversation_history` 不含本轮 `transcript`，后端追加）：
  ```python
  messages = [
      {"role": "system", "content": system_prompt},
      *conversation_history,
      {"role": "user", "content": transcript}
  ]
  ```
- 从 yaml 读取 temperature：`settings["textModel"]["temperature"]`（0.1）
- 调用 `openai.AsyncOpenAI().chat.completions.create()` with `response_format={"type": "json_object"}`
- `round_number == 2` 时强制 `is_final = True`（无论模型返回什么）
- `is_final` 归一化（字符串 `"true"/"True"` → `True`，字段缺失 → `True`，其他 → `False`）
- 返回 `{"response": str, "is_final": bool}`

### 步骤 5：`backend/app/routes/tts.py`

```python
POST /api/tts  body: {"text": str}
→ 流式返回 MP3（gpt-4o-mini-tts, voice=sage）
→ StreamingResponse(generate(), media_type="audio/mpeg")
```

```python
async def generate():
    async with client.audio.speech.with_streaming_response.create(
        model="gpt-4o-mini-tts", voice="sage",
        input=text, response_format="mp3",
        # ⚠️ speed 参数对 gpt-4o-mini-tts 无效（已知 OpenAI bug），
        # 用 instructions 控制语速：
        instructions="Speak slowly and clearly, suitable for young children aged 6-8."
    ) as r:
        async for chunk in r.iter_bytes(1024):
            yield chunk
```

### 步骤 6：`backend/app/main.py`

```python
from app.routes.chat import chat_router
from app.routes.tts import tts_router
app.include_router(chat_router, prefix="/api")
app.include_router(tts_router, prefix="/api")
```

### 步骤 7：`backend/app/routes/books.py`

旧格式全部废弃，只保留新单文件 YAML 格式。删除 `load_legacy_format()`、`process_urls_in_data()` 等旧逻辑。

**`scan_available_books()`**：只扫描 `.yaml` 文件：
```python
return sorted(
    item.stem
    for item in LOCAL_BOOKS_DIR.iterdir()
    if item.suffix in ('.yaml', '.yml') and item.is_file()
)
```

**`load_book_data(book_id)`**：直接加载单文件 YAML：
```python
yaml_file = LOCAL_BOOKS_DIR / f"{book_id}.yaml"
if not yaml_file.exists():
    raise HTTPException(status_code=404, detail=f"Book '{book_id}' not found")
return load_book_from_yaml(book_id, yaml_file)
```

**`load_book_from_yaml()`** 内部逻辑：
- `uri_prefix` 是 S3 key 前缀（如 `books/speed-racer/`）
- 相对路径 → S3 key = `uri_prefix + relative_path` → `s3_client.generate_download_url(s3_key)`
- `pages[]` 字段映射（`page_number`→`pageNumber`, `text`→`storyText` 等）
- `questions[]` 字段映射（`text`→`questionText`, `audio_uri`→`audioUrl`, `custom_prompt` 透传）
- `totalPages = len(pages)`
- **注意**：`metadata.id` 必须等于 YAML 文件名 stem（`speed-racer.yaml` → `id: speed-racer`）

**`get_all_books()`**：
```python
for book_id in scan_available_books():
    yaml_file = LOCAL_BOOKS_DIR / f"{book_id}.yaml"
    raw = read_local_yaml(yaml_file)
    meta = raw.get("metadata", {})
    uri_prefix = meta.get("uri_prefix", "")
    cover_uri = meta.get("cover_uri", "")
    cover_s3_key = uri_prefix + cover_uri
    cover_url = s3_client.generate_download_url(cover_s3_key) if cover_s3_key else ""
    books_metadata.append({
        "id": book_id,   # 用文件名 stem，与 load_book_data 保持一致
        "title": meta.get("title", "Unknown Title"),
        "coverImageUrl": cover_url,
        "totalPages": len(raw.get("pages", []))
    })
```

### 步骤 8：`frontend/src/hooks/useTranscriptionWebSocket.js`

修改点：
1. **签名变更**：移除旧参数 `bookId`、`pageNumber`、`onTranscriptionComplete`，新签名：
   ```js
   export const useTranscriptionWebSocket = (onTranscriptionDelta = null) => {
   ```
2. `configureTranscriptionSession()` 开启 VAD：
   ```js
   turn_detection: {
     type: "server_vad",
     threshold: 0.5,
     prefix_padding_ms: 300,
     silence_duration_ms: 500
   }
   ```
3. 增加 `accumulatedTranscriptRef = useRef('')`
4. `conversation.item.input_audio_transcription.delta` 事件：
   - **只**调用 `onTranscriptionDelta?.(message.delta)`（更新幽灵气泡）
   - **不**写入 `accumulatedTranscriptRef`（避免与 `completed` 重复计数）
5. `conversation.item.input_audio_transcription.completed` 事件：
   - 累积：`accumulatedTranscriptRef.current += message.transcript`（VAD 可多次触发，每次 completed 是该段权威来源）
6. 新增 `getFinalTranscript()`：返回并重置 `accumulatedTranscriptRef.current`：
   ```js
   const getFinalTranscript = useCallback(() => {
     const text = accumulatedTranscriptRef.current;
     accumulatedTranscriptRef.current = '';
     return text;
   }, []);
   ```
7. 新增 `clearAccumulatedTranscript()`：仅清空 ref（切题时调用，不取用）：
   ```js
   const clearAccumulatedTranscript = useCallback(() => {
     accumulatedTranscriptRef.current = '';
   }, []);
   ```
8. `disconnect()` 时清空 ref
9. `commitAudioBuffer()` 的错误处理：VAD 启用后服务器可能已自动 commit，手动再次 commit 时服务端会返回 error 事件（"buffer is empty"）。在 `case 'error':` 处理中，对 `message.error?.message` 包含 `"buffer"` 的错误静默忽略，不影响后续流程。
10. 完整返回值列表（明确列出，避免遗漏）：
    ```js
    return {
      // 保留
      isConnected,
      connectionStatus,
      connect,
      disconnect,
      sendAudioData,
      commitAudioBuffer,
      // 新增
      getFinalTranscript,
      clearAccumulatedTranscript,
      // 移除：transcriptions, isTranscribing（新流程不再需要）
    };
    ```

### 步骤 9：`frontend/src/hooks/useHTTPChat.js`（新建）

依赖导入：
```js
import { storeConversationMessage } from '../utils/conversationStorage';
```

暴露接口：
```js
const {
  isLoading,         // HTTP 请求中（替代原 isConnected 状态门控）
  isAiSpeaking,      // TTS 音频播放中
  error,
  conversationMessages,
  roundNumber,       // 仅供 UI 显示，逻辑判断用 roundNumberRef
  questionComplete,
  initialize,        // (bookId, pageNumber, question, pageText)
  submitTranscript,  // (text) 主入口
  sendSilenceMessage,
  reset,
} = useHTTPChat();
```

**`initialize(bookId, pageNumber, question, pageText)`**：
- 保存上下文到 refs（bookId, pageNumber, questionId, questionText, customPrompt, pageText）
- `conversationHistoryRef.current = [{role: "assistant", content: question.questionText}]`
- 重置 `roundNumberRef.current = 1`，同步 `setRoundNumber(1)`
- 重置 `questionComplete=false`, `conversationMessages=[]`

**`roundNumber` 的实现**：使用 ref 持有逻辑值，避免 stale closure 问题：
```js
const roundNumberRef = useRef(1);
const [roundNumber, setRoundNumber] = useState(1); // 仅供 UI 显示
```
读取和递增均操作 `roundNumberRef.current`，每次更新后再同步 `setRoundNumber`。

**`conversationMessages` 每条消息的结构**（供 UI 渲染）：
```js
{ id: Date.now(), role: 'user' | 'assistant', content: '...' }
```

**`submitTranscript(text)`** 流程（整体包在 `try/catch/finally` 中）：
```js
const submitTranscript = async (text) => {
  setIsLoading(true);
  try {
    // 1. 快照当前历史（⚠️ 必须在追加用户消息之前，保证不含本轮输入）
    const historySnapshot = [...conversationHistoryRef.current];
    // 2. 追加 user 消息到 state 和 conversationHistoryRef
    // 3. storeConversationMessage(text, 'user', ...)
    // 4. POST /api/chat，传 historySnapshot 作为 conversation_history
    // 5. 追加 AI 回复到 state + conversationHistoryRef
    // 6. storeConversationMessage(aiResponse, 'ai', ...)
    // 7. POST /api/tts → 流式播放（见下方）
    // 8. 判断是否结束（见下方）
  } catch (err) {
    setError(err.message);
  } finally {
    setIsLoading(false);
  }
};
```

TTS 流式播放（步骤 7）：
```js
const mediaSource = new MediaSource();
const audio = new Audio();
audio.src = URL.createObjectURL(mediaSource);
audio.onended = () => setIsAiSpeaking(false);
audio.onerror = () => setIsAiSpeaking(false);  // 播放中断时也重置
await new Promise(r => mediaSource.addEventListener('sourceopen', r, {once: true}));
audio.play();
setIsAiSpeaking(true);
const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
const ttsResponse = await fetch('/api/tts', { method: 'POST', ... });
const reader = ttsResponse.body.getReader();
while (true) {
  const { done, value } = await reader.read();
  if (done) { mediaSource.endOfStream(); break; }
  if (sourceBuffer.updating)
    await new Promise(r => sourceBuffer.addEventListener('updateend', r, {once: true}));
  sourceBuffer.appendBuffer(value);
}
// 降级：若 !window.MediaSource → arrayBuffer() + AudioContext.decodeAudioData()
```

判断是否结束（步骤 8，读 `roundNumberRef.current`，无 stale closure 风险）：
```js
if (is_final || roundNumberRef.current >= 2) {
  setQuestionComplete(true);
} else {
  roundNumberRef.current += 1;
  setRoundNumber(roundNumberRef.current);  // round 1 → 2，等待用户第二次回答
}
```

**`sendSilenceMessage()`**：以 `"[silence]"` 调用 `submitTranscript`。

**`reset()`**：
```js
const reset = useCallback(() => {
  roundNumberRef.current = 1;
  setRoundNumber(1);
  setQuestionComplete(false);
  setConversationMessages([]);
  conversationHistoryRef.current = [];
  setIsLoading(false);
  setIsAiSpeaking(false);
  setError(null);
}, []);
```

### 步骤 10：`frontend/src/components/BookReader/BookReader.jsx`

增加 `questionComplete` 状态管理：
```jsx
const [currentQuestionComplete, setCurrentQuestionComplete] = useState(false);

// 切题/切页时重置
useEffect(() => {
  setCurrentQuestionComplete(false);
}, [activeQuestion?.id, pageNumber]);

// canPerformAction：chat panel 打开时必须完成当前问题才允许 Next
const canPerformAction = () => {
  if (isQuestionAudioPlaying) return false;
  if (showChatPanel && !currentQuestionComplete) return false;
  return true;
};
```

传递新 props 给 InteractivePanel：
```jsx
<InteractivePanel
  ...
  pageText={currentPage?.storyText}                          // 新增
  onQuestionComplete={() => setCurrentQuestionComplete(true)} // 新增
/>
```

### 步骤 11：`frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx`

1. 用 `useHTTPChat` 替换 `usePageVoiceChat`（删除 `usePageVoiceChat` 的所有调用）
2. 增加两个 state：
   - `currentUserTranscript`（录音中实时显示幽灵气泡）
   - `isProcessingTranscript`（按下结束录音键 → 提交完成之间的门控，防止重复录音）
3. `transcriptionWS` 使用新签名，传入 delta 回调：
   ```js
   const transcriptionWS = useTranscriptionWebSocket(
     (delta) => setCurrentUserTranscript(prev => prev + delta)
   );
   ```
4. 问题/页面变化 `useEffect` 中同时初始化两个 hook，并管理 WS 连接生命周期：
   ```js
   useEffect(() => {
     if (question && bookId && pageNumber) {
       transcriptionWS.clearAccumulatedTranscript(); // 清空上一题残留
       httpChat.initialize(bookId, pageNumber, question, pageText);
       transcriptionWS.connect();
     }
     return () => {
       transcriptionWS.disconnect();
     };
   }, [question?.id, bookId, pageNumber]);
   // ⚠️ 依赖数组必须包含 bookId 和 pageNumber：
   // question?.id 在不同页可能相同（如都叫 q1），单独用 question?.id 会导致换页时 WS 不重连。
   ```
5. `onRecordingStart`（**第一次按下**录音键时）：`setCurrentUserTranscript('')`
6. `onRecordingComplete`（**再次按下**录音键结束录音时）：
   ```js
   const handleRecordingComplete = (options) => {
     setIsProcessingTranscript(true);
     try {
       transcriptionWS.commitAudioBuffer(); // 兜底 flush
       const text = transcriptionWS.getFinalTranscript();
       setCurrentUserTranscript('');
       if (options.isSilent || !text) httpChat.sendSilenceMessage();
       else httpChat.submitTranscript(text);
       // submitTranscript 内部设置 isLoading=true，此后由 isLoading 接管 disable
     } finally {
       setIsProcessingTranscript(false);
     }
   };
   ```
7. 录音中把 `currentUserTranscript` 渲染为幽灵气泡（与已发送消息视觉区分）
8. VoiceButton 禁用条件：
   ```js
   disabled={
     httpChat.isAiSpeaking ||
     httpChat.isLoading ||
     httpChat.questionComplete ||
     isAudioPlaying ||
     isProcessingTranscript  // 新增：结束录音到提交完成之间的窗口
   }
   ```
9. `httpChat.questionComplete` 变为 `true` 时调用 `onQuestionComplete()` prop
10. 移除旧逻辑：`pageVoiceChat.websocketRef`、`updateQuestionPrompt`、`handleTranscriptionComplete`、`/realtime` WebSocket
11. WS 连接生命周期由步骤 4 的 `useEffect` 统一管理（connect/disconnect 不再单独调用）
12. VoiceButton 回调配置（明确保留/删除）：
    ```jsx
    <VoiceButton
      disabled={...}
      sharedStream={sharedStream}         // ✅ 保留：BookReader 传入的共享音频流
      onAudioRecorded={undefined}         // ❌ 删除：新流程不需要完整 PCM16
      onAudioChunk={(pcm16Data) => {      // ✅ 保留：流式送入转录 WS
        if (transcriptionWS.isConnected) {
          transcriptionWS.sendAudioData(pcm16Data);
        }
      }}
      onRecordingStart={() => setCurrentUserTranscript('')}
      onRecordingComplete={...}
    />
    ```

---

## 实现顺序

1. `backend/data/books/speed-racer.yaml` — 合并 30 个页面 YAML
2. `backend/data/model-settings-en.yaml` — 复制并在 round1 和 round2 两个模板末尾各追加 JSON 指令行
3. `backend/app/config.py` — 开启 VAD
4. `backend/app/routes/chat.py` + `main.py` 注册 — 用 FastAPI `/docs` 测试
5. `backend/app/routes/tts.py` + `main.py` 注册 — 用 FastAPI `/docs` 测试
6. `backend/app/routes/books.py` — 重写为纯新格式，同时删除 `backend/data/books/speed-racer/` 旧目录
7. `frontend/src/hooks/useTranscriptionWebSocket.js` — VAD + delta + getFinalTranscript + clearAccumulatedTranscript
8. `frontend/src/hooks/useHTTPChat.js` — 新建，暂不接线
9. `frontend/src/components/BookReader/BookReader.jsx` — pageText prop + Next 锁定
10. `frontend/src/components/BookReader/InteractivePanel/InteractivePanel.jsx` — 接线完成

---

## 主要风险

| 风险 | 缓解措施 |
|------|---------|
| VAD 在录音中途触发多个 `completed` 事件 | 全部累积到 `accumulatedTranscriptRef`，录音结束时拼接取用 |
| `getFinalTranscript()` 调用后 VAD 又来一个 `completed`（极罕见） | toggle 键模式下用户说完再按键，VAD 已有足够时间 flush；若测试发现丢字可加 50ms |
| VAD 已自动 commit，手动再发 commit 触发 empty buffer 错误 | WS error 处理中检查 message.error?.message 含 "buffer"，静默忽略该类错误 |
| gpt-4.1-mini 返回 `is_final: "true"`（字符串）| 后端显式归一化：字符串 `"true"/"True"` → `True`，字段缺失 → `True`，其他 → `False` |
| gpt-4o-mini-tts `speed` 参数被忽略（已知 OpenAI bug）| 改用 `instructions` 参数控制语速 |
| iOS Safari 自动播放限制 | 已知风险，当前目标平台为桌面/Android；后续可在 VoiceButton click 内预创建 Audio 对象传给 hook |
| MediaSource API 兼容性问题 | Feature detection 降级为 `arrayBuffer()` → `AudioContext.decodeAudioData()` |

---

## 验收测试

### 后端（FastAPI /docs 或 curl）

```bash
# 1. Chat 接口
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"transcript":"The car is yellow","page_text":"...","question_text":"How is Camilla car different?","round_number":1,"conversation_history":[]}'
# 期望：{"response":"...","is_final":true/false}

# 2. TTS 接口
curl -X POST http://localhost:8000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Great job!"}' --output test.mp3
# 期望：可播放的 MP3 文件

# 3. 新格式书本 API
curl http://localhost:8000/api/books/speed-racer
# 期望：pages 数组，所有 URL 为预签名 S3 链接
```

### 前端端到端

1. **实时转录**：按下录音键慢速说话 → 聊天框中逐字出现幽灵气泡文字
2. **Round 1**：再次按下结束录音后 → AI 回复播放 → 若 `is_final=false`，VoiceButton 重新激活
3. **Round 2**：再次回答 → AI 给出最终答案 → VoiceButton 永久禁用
4. **Next 锁定**：`questionComplete=false` 时"下一题/下一页"按钮灰色不可点；`questionComplete=true` 后可点
5. **书库显示**：speed-racer 在书库中正常显示（通过新格式单文件 YAML）
6. **新格式书本页面**：图片、旁白音频、问题音频均可正常加载
