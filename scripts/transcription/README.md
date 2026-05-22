# 离线转录脚本（Stage 1）

把 S3 上已收集的家长 / 孩子 / AI 三方阅读 session 转成结构化对话表格。

完整设计见 `/Users/kunleihe/.claude/plans/ai-hard-code-lucky-scone.md`。

## 一次性环境准备

```bash
cd scripts/transcription
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 额外要装

1. **ffmpeg / ffprobe**（系统命令）
   ```bash
   brew install ffmpeg
   ```

2. **pyannote 模型权限**（首次使用）
   - 注册 https://huggingface.co/
   - 接受 https://huggingface.co/pyannote/speaker-diarization-3.1 的许可
   - 创建 token：https://huggingface.co/settings/tokens
   - export：`export HF_TOKEN=hf_xxx`

3. **环境变量**（自动从 `backend/app/.env` 读取）：
   - `AWS_ACCESS_KEY_ID`、`AWS_SECRET_ACCESS_KEY`、`AWS_REGION`、`S3_BUCKET_NAME`
   - `OPENAI_API_KEY`（转录时需要）

## 完整流程

### Step 1：扫 S3，搞清楚每个家庭的 condition

```bash
python audit_legacy_variants.py
```

产出：
- `audit.csv` —— 每行一个 (username, book_id)，含 `condition`、`page2_has_ai`、`max_page_reached`、`total_webm_count`、`multi_webm_pages`
- `unknown_condition.txt` —— page-2 不存在的 session，需人工标注

只处理 4 位数字的 username。

### Step 2：人工 review

打开 `audit.csv`，必要时编辑 `variant_overrides.yaml`：

```yaml
"7102": parent_ai
"8033": parent_only
```

然后重跑 `python audit_legacy_variants.py` 复核。

### Step 3：单个 page 测试（推荐先做）

```bash
python transcribe_legacy_page.py \
    --username 7102 --book-id speed-racer --page 2 \
    --condition parent_ai --engine openai-full
```

产出：`output/7102/page-02/attempt-1__{webm_filename}.{json,csv}`

可切换 engine 做 A/B 对比：
- **`openai-full` —— gpt-4o-transcribe（默认，最高准确率）**
- `openai-mini` —— gpt-4o-mini-transcribe（便宜一半，准确率略低）
- `whisper-1` —— 老版 whisper API（含 word-level timestamp，本流程用不到）
- `faster-whisper-local` —— 本地跑 large-v3，免费、私密

`--language zh` / `--language en` 可指定语言；不传则模型自动检测（中英混杂场景建议不传）。

### Step 4（可选）：把所有视频下载到本地

如果你想离线翻看原始 webm，或者发给同事 / 备份到外接硬盘：

```bash
# 先 dry-run 看会下多少
python download_videos.py --dry-run

# 全部下下来（默认 4 并发，跳过已有文件）
python download_videos.py

# 加速
python download_videos.py --parallel 8

# 缩小范围
python download_videos.py --usernames 7102,8033
python download_videos.py --conditions parent_ai
python download_videos.py --pages 2,3

# 改保存位置（默认 scripts/transcription/videos/）
python download_videos.py --out-dir ~/Desktop/videos
```

文件结构：`videos/{username}/page-{NN}/{webm_filename}`

跳过 `condition=unknown` 的 session（加 `--include-unknown` 强制下）。
**断点续传**：已存在的文件自动跳过，可以随时停下重跑。

### Step 5：批量转录

```bash
# 先 dry-run 看跑多少个 page，不执行
python batch.py --dry-run

# 小范围试
python batch.py --usernames 7102,8033 --pages 2,3 --engine openai-full

# 跑全部（前台，能看实时输出）
python batch.py --skip-done --engine openai-full
```

`batch.py` 调用 `transcribe_legacy_page.py` 处理 audit.csv 里的每个 (user, page)。

**可选参数**：
- `--usernames 7102,8033` —— 只跑这些用户
- `--pages 2,3,4` —— 只跑这些 page
- `--conditions parent_ai,parent_only` —— 只跑指定 condition
- `--skip-done` —— 跳过已有输出的 page（中途断了重跑必加）
- `--dry-run` —— 只打印命令，不执行

#### 全量跑：挂后台 + 防睡眠（推荐）

`batch.py` 自己处理日志写文件 + 屏蔽 tty 信号，**不需要 `nohup` / `disown` / shell 重定向**：

```bash
cd scripts/transcription
caffeinate -i .venv/bin/python batch.py --skip-done &
```

- `.venv/bin/python` 用绝对路径，避免激活错 venv 导致 import 失败
- `caffeinate -i` 防止系统 idle sleep（屏幕可以关、电脑可以锁屏）
- 后台运行（`&`），日志自动写入 `batch.log`
- 关 terminal **会** SIGHUP 子进程；如果你要关窗口跑，加 `nohup` 前缀

最稳妥的关 terminal 也能继续跑的版本：

```bash
nohup caffeinate -i .venv/bin/python batch.py --skip-done &
```

**为什么不用 disown 了**：旧版需要 `disown` 是因为 pyannote 内部偶尔会写 `/dev/tty`，zsh 默认会因此挂起后台进程。新版 batch.py 在启动时 `signal.signal(SIGTTOU, SIG_IGN)`，从根本上屏蔽了这个挂起源。

**注意事项**：
- 电脑要**保持开机 + 接电源 + 联 Wi-Fi**
- 合盖默认会睡眠（脚本停），如需合盖跑请接外接显示器进 Clamshell mode
- 关机/重启会丢进度，但 `--skip-done` 重启后能接上

**管理后台任务**：
```bash
# 看实时滚屏
tail -f batch.log

# 看最近 N 行
tail -50 batch.log

# 确认进程还在跑（看 PID）
ps aux | grep batch.py | grep -v grep

# 停掉后台任务
kill <PID>

# 看处理了多少用户 / page
ls output/ | wc -l
find output/ -name "*.csv" | wc -l
```

#### 关键性能改进（v2）

新版 `batch.py` **在单进程内跑所有 page**，pyannote 模型只加载一次，对比旧版每个 page 都 spawn 子进程要省 1.5-2 小时（576 webm × 10-15s 模型加载）。

## 输出结构

```
scripts/transcription/
├── audit.csv                                            # Step 1 输出
├── unknown_condition.txt                                # Step 1 输出（仅 unknown）
├── variant_overrides.yaml                               # 人工覆盖
├── videos/{username}/page-{N}/                          # Step 4 下载的原始 webm
├── .cache/{user}/{book}/page-{N}/                       # 转录过程中的 webm/wav/segments 缓存（可删）
└── output/{username}/page-{N}/                          # Step 5 转录产物
    ├── {username}_{condition}_page-{N}_video-{i}__{webm_stem}.json   # 完整 turn 数据
    └── {username}_{condition}_page-{N}_video-{i}__{webm_stem}.csv    # 扁平表
```

## CSV / JSON 字段

| 字段 | 含义 |
|------|------|
| `username` | 4 位数字 |
| `condition` | parent_ai / parent_only / ai_only |
| `page_number` | 页码 |
| `attempt_index` | 同页内多 webm 的序号，1, 2... |
| `webm_file` | 原始 webm 文件名 |
| `webm_duration_sec` | 该 attempt 音频长度 |
| `turn_index` | 该 attempt 内 turn 序号 |
| `t_start` / `t_end` | webm 内相对秒数 |
| `speaker` | parent / child / ai |
| `text` | 转录文本（AI 段用 conversations.json 原文） |
| `source` | 文本来源（engine 名 / conversations.json） |
| `f0_median` | 该 cluster 的中位基频（Hz） |
| `needs_review` | parent vs child 区分置信度低（F0 margin < 60Hz） |
| `realtime_transcript` | 老 JSON 的 user 文本（参考） |
| `ai_orphan_warning` | AI 消息时间落在所有 webm 区间外 |
| `ai_timing_approximate` | 老数据 AI timestamp 是绝对时间反推，精度 ±1-3s |

## 评估建议

跑完 2-3 个代表性 session 后，人工对照真实对话核对：
1. **WER**：感官评估转录准确率（含中英混杂、孩子嘟囔）
2. **Parent / Child 区分**：看 `speaker` 标签是否正确，留意 `needs_review=true` 的行
3. **AI 段时间**：看 AI 段在时间线上的位置是否合理（应该是 user 段之间）
4. **F0 margin**：跑 5-10 个家庭看分布，普遍 > 80Hz 说明启发式可靠

评估结果决定是否推进阶段 2（前端录 AI TTS + events.json）。
