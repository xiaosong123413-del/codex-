# Video Transcript Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local workflow that takes a natural-language “提取视频文字稿 + 链接” request, downloads the no-watermark video through `hellotik`, transcribes it locally, and writes a Markdown transcript into the fixed Obsidian directory.

**Architecture:** Add an isolated `src/video-transcript/` module tree to this repository so the new workflow stays separate from the existing Feishu SDK logic. The Node entrypoint will parse user input, drive Playwright for the website flow, call local media/transcription adapters, and write a Markdown artifact; Python is used only as a thin wrapper around `faster-whisper`.

**Tech Stack:** Node.js 22, Playwright, Python 3.13, faster-whisper, ffmpeg, `node:test`

---

## File Structure

### New files

- `src/video-transcript/constants.js`
  - Centralizes the fixed source page URL, fixed Obsidian output directory, temp workspace root, and default model settings.
- `src/video-transcript/request.js`
  - Extracts and validates the user URL, rejects multi-link input, infers the platform label, and derives a short ID.
- `src/video-transcript/paths.js`
  - Creates per-run temp directories and produces deterministic Markdown filenames.
- `src/video-transcript/markdown.js`
  - Builds the final Markdown transcript body from workflow output.
- `src/video-transcript/hellotikDownloader.js`
  - Encapsulates Playwright page navigation, retries, screenshots, and video download.
- `src/video-transcript/media.js`
  - Wraps `ffmpeg` audio extraction.
- `src/video-transcript/transcriber.js`
  - Wraps the Python transcription helper and parses JSON output.
- `src/video-transcript/workflow.js`
  - Orchestrates the full flow from input text to Markdown file output.
- `scripts/video-transcript.js`
  - CLI entrypoint used by future “just run it for me” execution.
- `scripts/faster_whisper_transcribe.py`
  - Thin Python helper that runs `faster-whisper` and prints JSON.
- `tests/video-transcript/request.test.js`
  - Unit tests for input extraction and filename metadata.
- `tests/video-transcript/markdown.test.js`
  - Unit tests for Markdown output formatting.
- `tests/video-transcript/hellotik-downloader.test.js`
  - Unit tests for page interaction, retry behavior, and screenshot-on-failure logic.
- `tests/video-transcript/media.test.js`
  - Unit tests for `ffmpeg` invocation handling.
- `tests/video-transcript/transcriber.test.js`
  - Unit tests for Python wrapper invocation and JSON parsing.
- `tests/video-transcript/workflow.test.js`
  - Orchestration tests using dependency injection.
- `docs/video-transcript-runbook.md`
  - Operator notes for first-time dependency installation and manual smoke testing.

### Modified files

- `package.json`
  - Adds the CLI script and focused test script.
- `.gitignore`
  - Ignores workflow temp artifacts under `tmp/video-transcript/`.
- `README.md`
  - Adds one short section pointing to the runbook and CLI command.

## Task 1: Bootstrap the Workflow Surface

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Modify: `README.md`
- Create: `docs/video-transcript-runbook.md`

- [ ] **Step 1: Install the Node runtime dependency**

Run:

```powershell
npm install playwright
```

Expected: `package.json` and `package-lock.json` update with `playwright`.

- [ ] **Step 2: Install the Playwright browser runtime**

Run:

```powershell
npx playwright install chromium
```

Expected: Chromium download completes without an error.

- [ ] **Step 3: Install the Python transcription dependency**

Run:

```powershell
python -m pip install faster-whisper
```

Expected: pip finishes successfully and `faster_whisper` is importable.

- [ ] **Step 4: Update scripts, ignore rules, and operator docs**

Write the following updates:

```json
{
  "scripts": {
    "video:transcript": "node scripts/video-transcript.js",
    "test:video-transcript": "node --test tests/video-transcript/*.test.js"
  }
}
```

```gitignore
tmp/video-transcript/
```

````md
## Video Transcript Workflow

Run the local transcript workflow with:

```bash
npm run video:transcript -- "提取视频文字稿 https://example.com/video"
```

First-time setup notes live in `docs/video-transcript-runbook.md`.
````

````md
# Video Transcript Workflow Runbook

## First-Time Setup

1. Install Node dependencies with `npm install`.
2. Install Chromium with `npx playwright install chromium`.
3. Install Python dependency with `python -m pip install faster-whisper`.
4. Install `ffmpeg` and ensure `ffmpeg -version` works in PowerShell.

## Manual Smoke Test

Run:

```powershell
npm run video:transcript -- "提取视频文字稿 https://www.bilibili.com/video/BV1tf4y1s7NN"
```

Expected:

- A temp job directory appears under `tmp/video-transcript/`.
- A Markdown transcript appears in `C:\Users\Administrator\Desktop\xiaosong的知识库\raw（只读区）（按照来源分类）\视频转文字稿`.
- The CLI prints the Markdown output path.
````

- [ ] **Step 5: Commit the bootstrap changes**

Run:

```powershell
git add package.json package-lock.json .gitignore README.md docs/video-transcript-runbook.md
git commit -m "chore: bootstrap video transcript workflow"
```

Expected: a single commit with dependency and docs setup only.

## Task 2: Add Request Parsing and Path Planning

**Files:**
- Create: `src/video-transcript/constants.js`
- Create: `src/video-transcript/request.js`
- Create: `src/video-transcript/paths.js`
- Create: `tests/video-transcript/request.test.js`

- [ ] **Step 1: Write the failing request and path tests**

Create `tests/video-transcript/request.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  deriveShortId,
  extractTranscriptRequest,
  inferPlatformFromUrl,
} from '../../src/video-transcript/request.js';
import { buildJobPaths } from '../../src/video-transcript/paths.js';

test('extractTranscriptRequest parses one supported link from natural language', () => {
  const result = extractTranscriptRequest('提取视频文字稿 https://www.bilibili.com/video/BV1tf4y1s7NN');

  assert.equal(result.url, 'https://www.bilibili.com/video/BV1tf4y1s7NN');
  assert.equal(result.platform, 'bilibili');
  assert.equal(result.shortId, 'BV1tf4y1s7NN');
});

test('extractTranscriptRequest rejects messages without a link', () => {
  assert.throws(
    () => extractTranscriptRequest('提取视频文字稿'),
    /No video URL found/
  );
});

test('extractTranscriptRequest rejects multiple links in one message', () => {
  assert.throws(
    () => extractTranscriptRequest('提取视频文字稿 https://a.example/1 https://b.example/2'),
    /Only one video URL is supported/
  );
});

test('inferPlatformFromUrl falls back to unknown', () => {
  assert.equal(inferPlatformFromUrl('https://example.com/video/123'), 'unknown');
});

test('deriveShortId falls back to a stable slug when no obvious ID exists', () => {
  assert.match(deriveShortId('https://example.com/video/my-demo'), /^[a-z0-9-]{6,24}$/);
});

test('buildJobPaths creates deterministic markdown and temp paths', () => {
  const paths = buildJobPaths({
    now: new Date('2026-04-11T08:09:10Z'),
    workspaceRoot: path.resolve('tmp', 'video-transcript'),
    outputDir: 'C:\\Users\\Administrator\\Desktop\\xiaosong的知识库\\raw（只读区）（按照来源分类）\\视频转文字稿',
    platform: 'bilibili',
    shortId: 'BV1tf4y1s7NN',
  });

  assert.match(paths.jobId, /^2026-04-11_16-09-10_bilibili_BV1tf4y1s7NN$/);
  assert.match(paths.markdownPath, /2026-04-11_16-09-10_bilibili_BV1tf4y1s7NN\.md$/);
  assert.match(paths.screenshotDir, /screenshots$/);
  assert.match(paths.audioPath, /\.wav$/);
});
```

- [ ] **Step 2: Run the test file and confirm it fails**

Run:

```powershell
node --test tests/video-transcript/request.test.js
```

Expected: FAIL because the new modules do not exist yet.

- [ ] **Step 3: Implement constants, request parsing, and path planning**

Create `src/video-transcript/constants.js`:

```js
import path from 'node:path';

export const HELLOTIK_SOURCE_PAGE = 'https://www.hellotik.app/zh/douyin#google_vignette';
export const DEFAULT_OUTPUT_DIR = 'C:\\Users\\Administrator\\Desktop\\xiaosong的知识库\\raw（只读区）（按照来源分类）\\视频转文字稿';
export const DEFAULT_WORKSPACE_ROOT = path.resolve(process.cwd(), 'tmp', 'video-transcript');
export const DEFAULT_TRANSCRIBE_MODEL = 'small';
export const DEFAULT_RETRY_COUNT = 2;
```

Create `src/video-transcript/request.js`:

```js
import crypto from 'node:crypto';

const URL_REGEX = /https?:\/\/[^\s]+/g;

export function extractTranscriptRequest(input) {
  const matches = input.match(URL_REGEX) ?? [];

  if (matches.length === 0) {
    throw new Error('No video URL found in the request.');
  }

  if (matches.length > 1) {
    throw new Error('Only one video URL is supported per request.');
  }

  const [url] = matches;
  return {
    url,
    platform: inferPlatformFromUrl(url),
    shortId: deriveShortId(url),
  };
}

export function inferPlatformFromUrl(rawUrl) {
  const host = new URL(rawUrl).hostname.toLowerCase();

  if (host.includes('bilibili')) return 'bilibili';
  if (host.includes('douyin')) return 'douyin';
  if (host.includes('xiaohongshu')) return 'xiaohongshu';
  if (host.includes('tiktok')) return 'tiktok';
  return 'unknown';
}

export function deriveShortId(rawUrl) {
  const url = new URL(rawUrl);
  const pathnameParts = url.pathname.split('/').filter(Boolean);
  const obviousId = pathnameParts.at(-1)?.replace(/\.[a-z0-9]+$/i, '');

  if (obviousId && /^[A-Za-z0-9_-]{6,32}$/.test(obviousId)) {
    return obviousId;
  }

  const queryId = url.searchParams.get('vid') ?? url.searchParams.get('v') ?? url.searchParams.get('id');
  if (queryId && /^[A-Za-z0-9_-]{4,32}$/.test(queryId)) {
    return queryId;
  }

  return crypto
    .createHash('sha1')
    .update(rawUrl)
    .digest('hex')
    .slice(0, 12);
}
```

Create `src/video-transcript/paths.js`:

```js
import path from 'node:path';

function formatLocalTimestamp(now) {
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const hour = String(local.getUTCHours()).padStart(2, '0');
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  const second = String(local.getUTCSeconds()).padStart(2, '0');

  return `${year}-${month}-${day}_${hour}-${minute}-${second}`;
}

export function buildJobPaths({ now, workspaceRoot, outputDir, platform, shortId }) {
  const timestamp = formatLocalTimestamp(now);
  const jobId = `${timestamp}_${platform}_${shortId}`;
  const jobDir = path.join(workspaceRoot, jobId);

  return {
    jobId,
    jobDir,
    screenshotDir: path.join(jobDir, 'screenshots'),
    downloadPath: path.join(jobDir, 'video.mp4'),
    audioPath: path.join(jobDir, 'audio.wav'),
    logPath: path.join(jobDir, 'workflow.log'),
    markdownPath: path.join(outputDir, `${jobId}.md`),
  };
}
```

- [ ] **Step 4: Run the request/path tests until they pass**

Run:

```powershell
node --test tests/video-transcript/request.test.js
```

Expected: PASS with 6 passing tests.

- [ ] **Step 5: Commit the request/path layer**

Run:

```powershell
git add src/video-transcript/constants.js src/video-transcript/request.js src/video-transcript/paths.js tests/video-transcript/request.test.js
git commit -m "feat: add video transcript request parsing"
```

Expected: one focused commit for request parsing and path generation.

## Task 3: Generate Markdown Output

**Files:**
- Create: `src/video-transcript/markdown.js`
- Create: `tests/video-transcript/markdown.test.js`

- [ ] **Step 1: Write the failing Markdown tests**

Create `tests/video-transcript/markdown.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildTranscriptMarkdown } from '../../src/video-transcript/markdown.js';

test('buildTranscriptMarkdown renders all required metadata fields', () => {
  const markdown = buildTranscriptMarkdown({
    sourceUrl: 'https://www.bilibili.com/video/BV1tf4y1s7NN',
    downloadTime: '2026-04-11T16:09:10+08:00',
    transcriptTime: '2026-04-11T16:12:55+08:00',
    sourcePage: 'https://www.hellotik.app/zh/douyin#google_vignette',
    localVideoPath: 'C:\\tmp\\video.mp4',
    transcriptionMethod: 'faster-whisper',
    warning: '',
    transcriptText: '第一句。\n第二句。',
  });

  assert.match(markdown, /^# 视频转文字稿/m);
  assert.match(markdown, /- 原始链接: https:\/\/www\.bilibili\.com\/video\/BV1tf4y1s7NN/);
  assert.match(markdown, /- 下载时间: 2026-04-11T16:09:10\+08:00/);
  assert.match(markdown, /- 转写方式: faster-whisper/);
  assert.match(markdown, /## 正文/);
  assert.match(markdown, /第一句。/);
});

test('buildTranscriptMarkdown emits a warning block when transcript quality is uncertain', () => {
  const markdown = buildTranscriptMarkdown({
    sourceUrl: 'https://example.com/video/1',
    downloadTime: '2026-04-11T16:09:10+08:00',
    transcriptTime: '2026-04-11T16:12:55+08:00',
    sourcePage: 'https://www.hellotik.app/zh/douyin#google_vignette',
    localVideoPath: 'C:\\tmp\\video.mp4',
    transcriptionMethod: 'faster-whisper',
    warning: '转写内容可能不完整',
    transcriptText: '内容。',
  });

  assert.match(markdown, /> 注意: 转写内容可能不完整/);
});
```

- [ ] **Step 2: Run the Markdown test file and confirm it fails**

Run:

```powershell
node --test tests/video-transcript/markdown.test.js
```

Expected: FAIL because `buildTranscriptMarkdown` does not exist yet.

- [ ] **Step 3: Implement the Markdown builder**

Create `src/video-transcript/markdown.js`:

```js
export function buildTranscriptMarkdown({
  sourceUrl,
  downloadTime,
  transcriptTime,
  sourcePage,
  localVideoPath,
  transcriptionMethod,
  warning,
  transcriptText,
}) {
  const warningBlock = warning ? `> 注意: ${warning}\n\n` : '';

  return [
    '# 视频转文字稿',
    '',
    `- 原始链接: ${sourceUrl}`,
    `- 下载时间: ${downloadTime}`,
    `- 转写时间: ${transcriptTime}`,
    `- 来源页面: ${sourcePage}`,
    `- 本地视频: ${localVideoPath}`,
    `- 转写方式: ${transcriptionMethod}`,
    '',
    '## 正文',
    '',
    `${warningBlock}${transcriptText}`.trimEnd(),
    '',
  ].join('\n');
}
```

- [ ] **Step 4: Run the Markdown tests until they pass**

Run:

```powershell
node --test tests/video-transcript/markdown.test.js
```

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the Markdown builder**

Run:

```powershell
git add src/video-transcript/markdown.js tests/video-transcript/markdown.test.js
git commit -m "feat: add transcript markdown generator"
```

Expected: one focused commit for Markdown generation only.

## Task 4: Implement the Hellotik Download Adapter

**Files:**
- Create: `src/video-transcript/hellotikDownloader.js`
- Create: `tests/video-transcript/hellotik-downloader.test.js`

- [ ] **Step 1: Write the failing downloader tests**

Create `tests/video-transcript/hellotik-downloader.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHellotikDownloader } from '../../src/video-transcript/hellotikDownloader.js';

function createFakePage({ failDownloadButton = false } = {}) {
  const events = [];
  const download = {
    suggestedFilename() {
      return 'clip.mp4';
    },
    async saveAs(targetPath) {
      events.push(['saveAs', targetPath]);
    },
  };

  const page = {
    events,
    async goto(url) {
      events.push(['goto', url]);
    },
    async waitForLoadState(state) {
      events.push(['waitForLoadState', state]);
    },
    locator(selector) {
      return {
        async fill(value) {
          events.push(['fill', selector, value]);
        },
      };
    },
    getByRole(role, options) {
      return {
        async click() {
          if (failDownloadButton && String(options.name).includes('下载无水印视频')) {
            throw new Error('download button missing');
          }
          events.push(['click', role, String(options.name)]);
        },
      };
    },
    async waitForEvent(name) {
      events.push(['waitForEvent', name]);
      return download;
    },
    async screenshot(options) {
      events.push(['screenshot', options.path]);
    },
    async close() {
      events.push(['page.close']);
    },
  };

  return { page, events };
}

test('createHellotikDownloader drives parse and download flow', async () => {
  const { page, events } = createFakePage();
  const downloader = createHellotikDownloader({
    createPage: async () => page,
  });

  const result = await downloader.download({
    pageUrl: 'https://www.hellotik.app/zh/douyin#google_vignette',
    videoUrl: 'https://www.bilibili.com/video/BV1tf4y1s7NN',
    downloadPath: 'C:\\tmp\\video.mp4',
    screenshotDir: 'C:\\tmp\\screenshots',
  });

  assert.equal(result.videoPath, 'C:\\tmp\\video.mp4');
  assert.deepEqual(
    events.filter((event) => event[0] === 'click').map((event) => event[2]),
    ['解析视频', '下载无水印视频']
  );
});

test('createHellotikDownloader captures a screenshot when the flow fails', async () => {
  const { page, events } = createFakePage({ failDownloadButton: true });
  const downloader = createHellotikDownloader({
    createPage: async () => page,
  });

  await assert.rejects(
    () =>
      downloader.download({
        pageUrl: 'https://www.hellotik.app/zh/douyin#google_vignette',
        videoUrl: 'https://www.bilibili.com/video/BV1tf4y1s7NN',
        downloadPath: 'C:\\tmp\\video.mp4',
        screenshotDir: 'C:\\tmp\\screenshots',
      }),
    /download button missing/
  );

  assert.equal(events.some((event) => event[0] === 'screenshot'), true);
});
```

- [ ] **Step 2: Run the downloader test file and confirm it fails**

Run:

```powershell
node --test tests/video-transcript/hellotik-downloader.test.js
```

Expected: FAIL because the downloader module does not exist yet.

- [ ] **Step 3: Implement the downloader with retries and screenshots**

Create `src/video-transcript/hellotikDownloader.js`:

```js
import fs from 'node:fs/promises';

import { DEFAULT_RETRY_COUNT } from './constants.js';

async function attemptDownload(page, { pageUrl, videoUrl, downloadPath }) {
  await page.goto(pageUrl);
  await page.waitForLoadState('networkidle');

  await page.locator('input[type="text"], input:not([type]), textarea').fill(videoUrl);
  await page.getByRole('button', { name: '解析视频' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载无水印视频' }).click();
  const download = await downloadPromise;
  await download.saveAs(downloadPath);

  return {
    videoPath: downloadPath,
    suggestedFilename: download.suggestedFilename(),
  };
}

export function createHellotikDownloader({ createPage, retryCount = DEFAULT_RETRY_COUNT }) {
  return {
    async download({ pageUrl, videoUrl, downloadPath, screenshotDir }) {
      await fs.mkdir(screenshotDir, { recursive: true });

      let lastError;
      for (let attempt = 1; attempt <= retryCount + 1; attempt += 1) {
        const page = await createPage();

        try {
          const result = await attemptDownload(page, { pageUrl, videoUrl, downloadPath });
          await page.close();
          return result;
        } catch (error) {
          lastError = error;
          await page.screenshot({ path: `${screenshotDir}\\attempt-${attempt}.png`, fullPage: true });
          await page.close();
        }
      }

      throw lastError;
    },
  };
}
```

- [ ] **Step 4: Run the downloader tests until they pass**

Run:

```powershell
node --test tests/video-transcript/hellotik-downloader.test.js
```

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the downloader layer**

Run:

```powershell
git add src/video-transcript/hellotikDownloader.js tests/video-transcript/hellotik-downloader.test.js
git commit -m "feat: add hellotik video downloader"
```

Expected: one focused commit for the Playwright download adapter.

## Task 5: Add ffmpeg and faster-whisper Adapters

**Files:**
- Create: `src/video-transcript/media.js`
- Create: `src/video-transcript/transcriber.js`
- Create: `scripts/faster_whisper_transcribe.py`
- Create: `tests/video-transcript/media.test.js`
- Create: `tests/video-transcript/transcriber.test.js`

- [ ] **Step 1: Write the failing media and transcription tests**

Create `tests/video-transcript/media.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { extractAudioTrack } from '../../src/video-transcript/media.js';

test('extractAudioTrack invokes ffmpeg with the expected arguments', async () => {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push([command, args]);
    return {
      on(event, handler) {
        if (event === 'close') handler(0);
      },
      stderr: { on() {} },
    };
  };

  await extractAudioTrack({
    spawnImpl,
    inputPath: 'C:\\tmp\\video.mp4',
    outputPath: 'C:\\tmp\\audio.wav',
  });

  assert.equal(calls[0][0], 'ffmpeg');
  assert.deepEqual(calls[0][1], [
    '-y',
    '-i',
    'C:\\tmp\\video.mp4',
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    'C:\\tmp\\audio.wav',
  ]);
});
```

Create `tests/video-transcript/transcriber.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { transcribeAudio } from '../../src/video-transcript/transcriber.js';

test('transcribeAudio parses JSON returned by the Python helper', async () => {
  const spawnImpl = () => {
    return {
      stdout: {
        on(event, handler) {
          if (event === 'data') {
            handler(Buffer.from(JSON.stringify({
              text: '第一句。第二句。',
              language: 'zh',
              warning: '',
            })));
          }
        },
      },
      stderr: { on() {} },
      on(event, handler) {
        if (event === 'close') handler(0);
      },
    };
  };

  const result = await transcribeAudio({
    spawnImpl,
    pythonPath: 'python',
    scriptPath: 'scripts/faster_whisper_transcribe.py',
    audioPath: 'C:\\tmp\\audio.wav',
    model: 'small',
  });

  assert.equal(result.language, 'zh');
  assert.equal(result.text, '第一句。第二句。');
});
```

- [ ] **Step 2: Run the media/transcriber tests and confirm they fail**

Run:

```powershell
node --test tests/video-transcript/media.test.js tests/video-transcript/transcriber.test.js
```

Expected: FAIL because neither adapter exists yet.

- [ ] **Step 3: Implement the Node adapters and Python helper**

Create `src/video-transcript/media.js`:

```js
import { spawn } from 'node:child_process';

export function extractAudioTrack({ spawnImpl = spawn, inputPath, outputPath }) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl('ffmpeg', [
      '-y',
      '-i',
      inputPath,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      outputPath,
    ]);

    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ audioPath: outputPath });
        return;
      }

      reject(new Error(`ffmpeg failed with exit code ${code}: ${stderr}`));
    });
  });
}
```

Create `src/video-transcript/transcriber.js`:

```js
import { spawn } from 'node:child_process';

export function transcribeAudio({
  spawnImpl = spawn,
  pythonPath,
  scriptPath,
  audioPath,
  model,
}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(pythonPath, [scriptPath, '--audio', audioPath, '--model', model]);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`faster-whisper helper failed with exit code ${code}: ${stderr}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Failed to parse transcription JSON: ${error.message}`));
      }
    });
  });
}
```

Create `scripts/faster_whisper_transcribe.py`:

```python
import argparse
import json
from faster_whisper import WhisperModel


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="small")
    args = parser.parse_args()

    model = WhisperModel(args.model)
    segments, info = model.transcribe(args.audio)

    text = "".join(segment.text for segment in segments).strip()
    warning = ""
    if not text:
        warning = "转写内容可能不完整"

    print(json.dumps({
        "text": text,
        "language": info.language,
        "warning": warning,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the media/transcriber tests until they pass**

Run:

```powershell
node --test tests/video-transcript/media.test.js tests/video-transcript/transcriber.test.js
```

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the media and transcription layer**

Run:

```powershell
git add src/video-transcript/media.js src/video-transcript/transcriber.js scripts/faster_whisper_transcribe.py tests/video-transcript/media.test.js tests/video-transcript/transcriber.test.js
git commit -m "feat: add local transcript adapters"
```

Expected: one focused commit for ffmpeg and faster-whisper integration.

## Task 6: Wire the End-to-End Workflow and CLI

**Files:**
- Create: `src/video-transcript/workflow.js`
- Create: `scripts/video-transcript.js`
- Create: `tests/video-transcript/workflow.test.js`

- [ ] **Step 1: Write the failing workflow orchestration tests**

Create `tests/video-transcript/workflow.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import { runVideoTranscriptWorkflow } from '../../src/video-transcript/workflow.js';

test('runVideoTranscriptWorkflow executes the downloader, transcription, and markdown writer in order', async () => {
  const calls = [];

  const result = await runVideoTranscriptWorkflow({
    input: '提取视频文字稿 https://www.bilibili.com/video/BV1tf4y1s7NN',
    clock: () => new Date('2026-04-11T08:09:10Z'),
    ensureDir: async (target) => calls.push(['ensureDir', target]),
    writeFile: async (target, content) => calls.push(['writeFile', target, content]),
    downloader: {
      async download(args) {
        calls.push(['download', args.videoUrl]);
        return { videoPath: args.downloadPath };
      },
    },
    media: {
      async extractAudioTrack(args) {
        calls.push(['extractAudioTrack', args.inputPath]);
        return { audioPath: args.outputPath };
      },
    },
    transcriber: {
      async transcribeAudio(args) {
        calls.push(['transcribeAudio', args.audioPath]);
        return { text: '第一句。', language: 'zh', warning: '' };
      },
    },
  });

  assert.equal(result.platform, 'bilibili');
  assert.equal(calls[1][0], 'download');
  assert.equal(calls[2][0], 'extractAudioTrack');
  assert.equal(calls[3][0], 'transcribeAudio');
  assert.equal(calls.at(-1)[0], 'writeFile');
});
```

- [ ] **Step 2: Run the workflow test file and confirm it fails**

Run:

```powershell
node --test tests/video-transcript/workflow.test.js
```

Expected: FAIL because the workflow module does not exist yet.

- [ ] **Step 3: Implement the workflow and CLI entrypoint**

Create `src/video-transcript/workflow.js`:

```js
import fs from 'node:fs/promises';

import {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_TRANSCRIBE_MODEL,
  DEFAULT_WORKSPACE_ROOT,
  HELLOTIK_SOURCE_PAGE,
} from './constants.js';
import { buildTranscriptMarkdown } from './markdown.js';
import { buildJobPaths } from './paths.js';
import { extractTranscriptRequest } from './request.js';

export async function runVideoTranscriptWorkflow({
  input,
  clock = () => new Date(),
  ensureDir = (target) => fs.mkdir(target, { recursive: true }),
  writeFile = (target, content) => fs.writeFile(target, content, 'utf8'),
  downloader,
  media,
  transcriber,
  outputDir = DEFAULT_OUTPUT_DIR,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
}) {
  const request = extractTranscriptRequest(input);
  const now = clock();
  const paths = buildJobPaths({
    now,
    workspaceRoot,
    outputDir,
    platform: request.platform,
    shortId: request.shortId,
  });

  await ensureDir(paths.jobDir);
  await ensureDir(paths.screenshotDir);
  await ensureDir(outputDir);

  const downloadResult = await downloader.download({
    pageUrl: HELLOTIK_SOURCE_PAGE,
    videoUrl: request.url,
    downloadPath: paths.downloadPath,
    screenshotDir: paths.screenshotDir,
  });

  await media.extractAudioTrack({
    inputPath: downloadResult.videoPath,
    outputPath: paths.audioPath,
  });

  const transcript = await transcriber.transcribeAudio({
    audioPath: paths.audioPath,
    model: DEFAULT_TRANSCRIBE_MODEL,
  });

  const markdown = buildTranscriptMarkdown({
    sourceUrl: request.url,
    downloadTime: now.toISOString(),
    transcriptTime: clock().toISOString(),
    sourcePage: HELLOTIK_SOURCE_PAGE,
    localVideoPath: downloadResult.videoPath,
    transcriptionMethod: 'faster-whisper',
    warning: transcript.warning,
    transcriptText: transcript.text,
  });

  await writeFile(paths.markdownPath, markdown);

  return {
    ...request,
    markdownPath: paths.markdownPath,
    videoPath: downloadResult.videoPath,
  };
}
```

Create `scripts/video-transcript.js`:

```js
import { chromium } from 'playwright';

import { createHellotikDownloader } from '../src/video-transcript/hellotikDownloader.js';
import { extractAudioTrack } from '../src/video-transcript/media.js';
import { transcribeAudio } from '../src/video-transcript/transcriber.js';
import { runVideoTranscriptWorkflow } from '../src/video-transcript/workflow.js';

const input = process.argv.slice(2).join(' ').trim();

if (!input) {
  console.error('Usage: npm run video:transcript -- "提取视频文字稿 https://example.com/video"');
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });

try {
  const downloader = createHellotikDownloader({
    createPage: async () => browser.newPage({ acceptDownloads: true }),
  });

  const result = await runVideoTranscriptWorkflow({
    input,
    downloader,
    media: { extractAudioTrack },
    transcriber: {
      transcribeAudio(args) {
        return transcribeAudio({
          pythonPath: 'python',
          scriptPath: 'scripts/faster_whisper_transcribe.py',
          ...args,
        });
      },
    },
  });

  console.log(`Markdown written to: ${result.markdownPath}`);
} finally {
  await browser.close();
}
```

- [ ] **Step 4: Run the focused tests and then the full workflow test suite**

Run:

```powershell
node --test tests/video-transcript/workflow.test.js
npm run test:video-transcript
```

Expected:

- First command: PASS with the workflow orchestration test.
- Second command: PASS with all `tests/video-transcript/*.test.js` files.

- [ ] **Step 5: Commit the workflow entrypoint**

Run:

```powershell
git add src/video-transcript/workflow.js scripts/video-transcript.js tests/video-transcript/workflow.test.js
git commit -m "feat: wire video transcript workflow"
```

Expected: one focused commit that wires the full local flow together.

## Task 7: Verify the Real Workflow End to End

**Files:**
- No new source files expected unless a defect is found during verification

- [ ] **Step 1: Verify ffmpeg is available before running the smoke test**

Run:

```powershell
ffmpeg -version
```

Expected: prints the installed ffmpeg version. If PowerShell says the command is missing, stop and install ffmpeg before continuing.

- [ ] **Step 2: Run the real workflow against one known test link**

Run:

```powershell
npm run video:transcript -- "提取视频文字稿 https://www.bilibili.com/video/BV1tf4y1s7NN"
```

Expected:

- Chromium opens headlessly and closes cleanly.
- A temp job directory is created under `tmp/video-transcript/`.
- The CLI prints `Markdown written to: ...`.
- A Markdown file appears in `C:\Users\Administrator\Desktop\xiaosong的知识库\raw（只读区）（按照来源分类）\视频转文字稿`.

- [ ] **Step 3: Open the generated Markdown file and verify the required fields**

Run:

```powershell
Get-ChildItem "C:\Users\Administrator\Desktop\xiaosong的知识库\raw（只读区）（按照来源分类）\视频转文字稿" -Filter *.md | Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content
```

Expected: the file contains the original URL, source page, local video path, transcription method, and transcript body.

- [ ] **Step 4: Run the repository test suite segments impacted by this feature**

Run:

```powershell
npm run test:video-transcript
npm run test:integration
```

Expected:

- `test:video-transcript`: PASS
- `test:integration`: either PASS or, if unrelated failures already exist, capture them explicitly before merging

- [ ] **Step 5: Commit any verification fixes or finish cleanly**

Run:

```powershell
git status --short
```

Expected: no unexpected modified files beyond intentional fixes. If a verification fix was needed, commit it separately with a focused message such as `fix: harden video transcript workflow retries`.

## Self-Review Notes

### Spec coverage

- Trigger phrase and single-link validation: Task 2, Task 6
- Fixed `hellotik` page flow and button clicks: Task 4
- Download to local temp directory: Task 2, Task 4, Task 6
- Local ffmpeg extraction and local faster-whisper transcription: Task 5
- Markdown generation and fixed Obsidian output path: Task 3, Task 6
- Screenshots and retry behavior on failure: Task 4
- Real-world smoke test and verification: Task 7

### Placeholder scan

- No `TODO`, `TBD`, or “implement later” placeholders remain.
- Each code-writing step includes exact file paths and concrete code blocks.

### Type consistency

- Request object fields: `url`, `platform`, `shortId`
- Path object fields: `jobId`, `jobDir`, `screenshotDir`, `downloadPath`, `audioPath`, `logPath`, `markdownPath`
- Adapter method names stay consistent: `download`, `extractAudioTrack`, `transcribeAudio`
