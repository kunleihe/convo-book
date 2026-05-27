# 离线转录脚本

把 S3 上收集的家长 / 孩子 / AI 三方阅读 session 转成结构化对话表格（xlsx）。

## 快速开始

```bash
cd scripts/transcription
python audit.py                          # Step 1：扫 S3，生成 audit.csv
python batch.py --dry-run                # Step 2：预览会跑多少 page
caffeinate -i .venv/bin/python batch.py --skip-done &   # Step 3：全量跑
tail -f batch.log                        # 看进度
```

---

## 一次性环境准备

```bash
cd scripts/transcription
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 系统依赖

**ffmpeg / ffprobe**（音频转换 + 时长读取）：

```bash
brew install ffmpeg
```

### 环境变量

自动从 `backend/app/.env` 读取，无需额外配置：

| 变量 | 用途 |
|------|------|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | S3 访问 |
| `S3_BUCKET_NAME` | 目标 bucket |
| `OPENAI_API_KEY` | 转录 API 调用 |
| `HF_TOKEN` | pyannote 说话人分离模型（仅 legacy 路径需要） |

**HF_TOKEN 获取**（首次使用 legacy 路径时需要）：
1. 注册 https://huggingface.co/
2. 接受 https://huggingface.co/pyannote/speaker-diarization-3.1 的使用许可
3. 在 https://huggingface.co/settings/tokens 创建 Access Token
4. 写入 `backend/app/.env`：`HF_TOKEN=hf_xxx`

---

## 完整流程

### Step 1：Audit — 扫 S3，确定每个 session 的 condition

```bash
python audit.py
```

产出：
- **`audit.csv`** — 每行一个 `(username, book_id)`，包含 `condition`、`max_page_reached`、`total_webm_count` 等
- **`unknown_condition.txt`** — 在 S3 有数据但 `tracker.csv` 里找不到的 session

只处理 4 位数字的 username（测试账号等非标 username 自动跳过）。

**Condition 来源**：直接从 `tracker.csv` 读取（`id` 列对应 username，`condition` 列为 ground truth）。S3 里有数据但 tracker 里没有记录的 username 会出现在 `unknown_condition.txt`。

---

### Step 2（可选）：单页测试

批量跑之前建议先用单个 session/page 验证输出质量。

**Legacy 数据**（无 events.json）：

```bash
python transcribe_legacy_page.py \
    --username 7102 --book-id speed-racer --page 2 \
    --condition parent_ai --engine openai-full
```

**新数据**（有 events.json）：

```bash
python transcribe_page.py \
    --username 7102 --book-id speed-racer --page 2 \
    --condition parent_ai --engine openai-full
```

**Engine 选项**：

| Engine | 模型 | 说明 |
|--------|------|------|
| `openai-full`（默认） | gpt-4o-transcribe | 最高准确率 |
| `openai-mini` | gpt-4o-mini-transcribe | 约便宜一半，准确率略低 |
| `whisper-1` | whisper-1 API | 支持 word-level timestamp（本流程暂不使用） |
| `faster-whisper-local` | large-v3（本地） | 免费、完全离线、数据不出本机 |

`--language zh` / `--language en` 可指定语言；不传则自动检测（中英混杂建议不传）。

---

### Step 3：批量转录

`batch.py` 读取 `audit.csv`，对每个 `(username, book_id)` 遍历所有 page 并转录。

**自动路由**：每个 page 会检查 S3 是否存在 `events/` 目录：
- 有 `events/`（新数据）→ 使用 `transcribe_page.py`
- 无 `events/`（legacy 数据）→ 使用 `transcribe_legacy_page.py`

```bash
# 预览：看会跑多少个 page，不执行任何转录
python batch.py --dry-run

# 小范围测试
python batch.py --usernames 7102,8033 --pages 2,3

# 全量跑（前台，能看实时输出）
python batch.py --skip-done
```

**常用参数**：

| 参数 | 说明 |
|------|------|
| `--skip-done` | 跳过已有输出文件的 page（中断后重跑必加） |
| `--dry-run` | 只打印，不执行 |
| `--usernames 7102,8033` | 只处理指定用户 |
| `--pages 2,3,4` | 只处理指定页码 |
| `--conditions parent_ai` | 只处理指定 condition |
| `--engine openai-full` | 转录引擎（默认 openai-full） |
| `--language zh` | 语言提示（默认自动检测） |

#### 全量跑推荐命令（挂后台 + 防睡眠）

```bash
caffeinate -i .venv/bin/python batch.py --skip-done &
```

关 terminal 也不中断的版本：

```bash
nohup caffeinate -i .venv/bin/python batch.py --skip-done &
```

- `.venv/bin/python` 用绝对路径，避免 venv 未激活导致 import 失败
- `caffeinate -i` 防止系统 idle sleep（屏幕可以关、电脑可以锁屏，但不能合盖）
- 日志自动写入 `batch.log`，不需要 shell 重定向

**注意事项**：
- 电脑需**保持开机 + 接电源 + 联网**
- 合盖默认会睡眠；如需合盖跑，接外接显示器使用 Clamshell 模式
- 关机/重启会中断，但 `--skip-done` 重启后可接续

**监控后台任务**：

```bash
tail -f batch.log                          # 实时进度
ps aux | grep batch.py | grep -v grep      # 确认进程在跑
kill <PID>                                 # 停止
find output/ -name "*.xlsx" | wc -l        # 已完成的 page 数
```

---

## 输出结构

```
scripts/transcription/
├── tracker.csv                    # ground truth：每个 username 的 condition
├── audit.csv                      # audit 产出（session 列表 + condition）
├── unknown_condition.txt          # audit 产出（S3 有数据但 tracker 里没有的 session）
├── batch.log                      # batch 运行日志
├── .cache/                        # 转录过程的中间缓存（可整个删除）
│   └── {username}/{book_id}/page-{NN}/
│       ├── webm/                  # 下载的原始录音
│       ├── wav/                   # 转换后的 16kHz wav
│       ├── segments/              # 按 turn 切割的音频片段
│       └── events/                # 下载的 events.json（新数据路径）
└── output/
    └── {username}/
        └── {username}_{condition}_page-{NN}_video-{i}__{webm_stem}.xlsx
```

每个 webm 生成一个 xlsx 文件。一个 page 可能对应多个 webm（多次录制尝试）。

---

## 输出 xlsx 字段

| 字段 | 含义 |
|------|------|
| `username` | 4 位数字 ID |
| `condition` | `parent_ai` / `parent_only` / `ai_only` |
| `page_number` | 书页页码 |
| `video_index` | 同页内多 webm 的序号（1, 2, ...） |
| `webm_file` | 原始 webm 文件名 |
| `webm_duration_sec` | 该 webm 的音频时长（秒） |
| `turn_index` | 该 webm 内的 turn 序号 |
| `t_start` / `t_end` | Turn 在 webm 内的相对时间（秒） |
| `speaker` | `parent` / `child` / `ai` |
| `text` | 转录文本（AI turn 使用原始文本，非转录） |
| `source` | 文本来源：engine 名 / `conversations.json`（legacy）/ `events.json`（新） |
| `f0_median` | 该说话人 cluster 的中位基频（Hz），用于 parent/child 区分 |
| `needs_review` | `True` 表示 F0 margin < 60Hz，parent/child 区分置信度低，需人工核查 |
| `realtime_transcript` | 保留字段（旧 Realtime API 路径，当前流程为空） |
| `ai_orphan_warning` | AI 消息时间戳落在所有 webm 录制窗口之外（legacy 路径） |
| `ai_timing_approximate` | AI 时间戳由绝对时间反推，精度 ±1-3s（legacy 路径） |

---

## Legacy vs 新数据的区别

| 对比项 | Legacy 数据 | 新数据 |
|--------|------------|--------|
| 识别方式 | S3 无 `events/` 目录 | S3 有 `events/` 目录 |
| AI 文本来源 | `conversations/*.json`（存储的对话记录） | `events/*.json`（实时事件日志） |
| AI 时间戳 | 绝对时间戳反推，精度 ±1-3s | 精确相对时间（音频内偏移量） |
| AI 音频处理 | 无法从 webm 中区分 AI 声音，diarize 所有声音 | 先将 AI TTS 区间静音，再 diarize |
| 输出标记 | `ai_timing_approximate=True` | 无此标记 |

---

## 各脚本说明

| 脚本 | 用途 |
|------|------|
| `audit.py` | 扫 S3，从 tracker.csv 读 condition，生成 `audit.csv` |
| `batch.py` | 批量入口，读 audit.csv，自动路由两条转录路径 |
| `transcribe_no_ai_events.py` | 处理无 events.json 的 session（pyannote + F0 + OpenAI） |
| `transcribe_with_ai_events.py` | 处理有 events.json 的 session（AI 区间静音后再 diarize） |
| `openai_transcribe.py` | OpenAI / 本地 whisper 转录引擎封装 |
| `speaker_label.py` | 基于 F0 判断哪个 cluster 是 parent / child |
| `download_videos.py` | 把 S3 上的 webm 批量下载到本地 |
| `migrate_csv_to_xlsx.py` | 将旧版 csv 输出迁移为 xlsx |
