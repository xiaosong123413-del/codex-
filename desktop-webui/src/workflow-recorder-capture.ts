/**
 * Desktop workflow-recorder quick window markup.
 *
 * This data-url page is opened directly by the workflow-recorder shortcut. It
 * keeps execution logging independent from the main workspace route while
 * submitting records into task-pool tasks.
 */
const STYLES = `
  :root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; overflow: hidden; background: transparent; color: #142344; }
  button, textarea { font: inherit; }
  main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .window {
    width: 100%; height: 100%; display: grid; grid-template-rows: auto auto auto auto auto 1fr auto;
    gap: 16px; padding: 28px; border: 1px solid rgba(180, 193, 216, 0.72);
    border-radius: 28px; background: rgba(255, 255, 255, 0.96);
    box-shadow: 0 30px 90px rgba(39, 68, 118, 0.20);
    -webkit-app-region: drag;
  }
  header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 18px; -webkit-app-region: drag; }
  .app-icon {
    width: 56px; height: 56px; border-radius: 14px; display: grid; place-items: center;
    background: linear-gradient(135deg, #1b67ff, #0b48f0); color: white;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.35), 0 12px 30px rgba(27,103,255,.30);
  }
  h1 { margin: 0; font-size: 28px; line-height: 1.15; letter-spacing: 0; color: #102040; }
  .subtitle { margin-top: 6px; color: #7a86a0; font-size: 15px; }
  .close { width: 40px; height: 40px; border: 0; background: transparent; color: #7b859b; cursor: pointer; }
  .input-wrap { position: relative; }
  textarea {
    width: 100%; min-height: 166px; resize: none; border: 1.5px solid #1d67ff; border-radius: 14px;
    outline: none; padding: 22px 24px 44px; color: #1b2948; background: #ffffff;
    box-shadow: 0 0 0 3px rgba(29,103,255,0.06);
  }
  textarea::placeholder { color: #8a95aa; }
  .counter { position: absolute; right: 24px; bottom: 16px; color: #8b96ad; font-size: 14px; }
  .section-title { font-size: 17px; font-weight: 750; color: #17233f; }
  .section-title small { margin-left: 8px; color: #8792a8; font-weight: 500; }
  .task-title { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .task-actions { display: flex; gap: 8px; flex: 0 0 auto; }
  .task-action {
    min-height: 32px; padding: 0 12px; border: 1px solid #dbe3ef; border-radius: 8px;
    background: #fff; color: #2458b8; font-size: 13px; cursor: pointer;
  }
  .chips {
    display: flex; flex-wrap: nowrap; gap: 12px; min-height: 48px; overflow-x: auto;
    padding-bottom: 4px; scroll-snap-type: x proximity;
  }
  .chip {
    flex: 0 0 auto; min-width: 118px; max-width: 260px; min-height: 40px; padding: 8px 20px;
    border: 1px solid #dbe3ef; border-radius: 9px; background: #fbfdff; color: #53617c;
    cursor: pointer; scroll-snap-align: start; text-align: center;
  }
  .chip.active { border-color: #1d67ff; color: #135bea; background: #f4f8ff; }
  .chip strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 650; }
  .chip span { display: block; font-size: 12px; color: #8490a8; margin-top: 2px; }
  .types { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
  .type {
    min-height: 132px; padding: 22px 24px; text-align: left; border: 1px solid #dbe3ef; border-radius: 14px;
    background: #fff; color: #17233f; cursor: pointer;
  }
  .type.active { border-color: #1d67ff; background: linear-gradient(180deg, #f8fbff, #ffffff); box-shadow: 0 0 0 3px rgba(29,103,255,0.06); }
  .type strong { display: flex; align-items: center; gap: 12px; color: #17233f; font-size: 20px; }
  .type.active strong { color: #135bea; }
  .type p { margin: 12px 0 0; color: #7a86a0; line-height: 1.55; }
  .hint { display: flex; gap: 12px; align-items: flex-start; padding: 14px 16px; border: 1px solid #cfe0ff; border-radius: 10px; background: #f6f9ff; color: #617498; line-height: 1.55; }
  .footer { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 18px; }
  .more { border: 0; background: transparent; color: #64708a; cursor: pointer; }
  .submit { min-width: 170px; min-height: 52px; border: 0; border-radius: 10px; background: #1464ff; color: #fff; font-weight: 800; cursor: pointer; box-shadow: 0 14px 30px rgba(20,100,255,.25); }
  .status { min-height: 22px; color: #64708a; font-size: 14px; align-self: end; }
  .status.error { color: #b42318; }
  .status.success { color: #1f8f58; }
  button, textarea, .input-wrap, .chips, .types, .hint, .footer { -webkit-app-region: no-drag; }
  button:focus-visible, textarea:focus-visible { outline: 3px solid rgba(29,103,255,.28); outline-offset: 2px; }
`;

const SCRIPT = `
  const MAX_LENGTH = 1000;
  const state = { marker: "normal", taskId: "", attachments: [], tasks: [], searchQuery: "" };
  const input = document.getElementById("record-input");
  const counter = document.getElementById("counter");
  const statusNode = document.getElementById("status");
  const chips = document.getElementById("recent-flows");

  const icons = {
    normal: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M7 3h7l4 4v14H7V3Z" stroke="currentColor" stroke-width="1.8"/><path d="M14 3v5h5M10 13h6M10 17h4" stroke="currentColor" stroke-width="1.8"/></svg>',
    issue: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 4 3 20h18L12 4Z" stroke="#f5a623" stroke-width="1.8"/><path d="M12 9v5M12 17h.01" stroke="#f5a623" stroke-width="2"/></svg>',
    resolved: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" fill="#2db67d"/><path d="m8 12.4 2.6 2.5L16.5 9" stroke="white" stroke-width="2.2"/></svg>',
    method: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 18h6M10 22h4M8 10a4 4 0 1 1 8 0c0 1.5-.8 2.4-1.6 3.3-.5.6-.9 1.1-.9 1.7h-3c0-.6-.4-1.1-.9-1.7C8.8 12.4 8 11.5 8 10Z" stroke="#1d67ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  function setStatus(message, tone = "") {
    statusNode.textContent = message;
    statusNode.className = "status" + (tone ? " " + tone : "");
  }

  function updateCounter() {
    counter.textContent = input.value.length + " / " + MAX_LENGTH;
  }

  function displayTasks(tasks) {
    state.tasks = Array.isArray(tasks) ? tasks : [];
    renderTasks();
  }

  function renderTasks() {
    const visibleTasks = filterTasks(state.tasks);
    if (state.taskId && !visibleTasks.some((task) => task.id === state.taskId)) state.taskId = "";
    chips.innerHTML = visibleTasks.length > 0
      ? visibleTasks.map(renderTaskChip).join("")
      : '<button type="button" class="chip" disabled>暂无可绑定任务</button>';
    bindTaskChips();
  }

  function filterTasks(tasks) {
    const query = state.searchQuery.trim().toLocaleLowerCase();
    if (!query) return tasks;
    return tasks.filter((task) => taskSearchText(task).includes(query));
  }

  function taskSearchText(task) {
    return [task.title, task.domain, task.project, task.badge].filter(Boolean).join(" ").toLocaleLowerCase();
  }

  function renderTaskChip(task) {
    const scope = [task.domain, task.project].filter(Boolean).join(" / ");
    const subtitle = [task.badge, scope].filter(Boolean).join(" · ");
    return '<button type="button" class="chip' + (state.taskId === task.id ? ' active' : '') + '" data-task-id="' + escapeHtml(task.id) + '">'
      + '<strong>' + escapeHtml(task.title) + '</strong>'
      + (subtitle ? '<span>' + escapeHtml(subtitle) + '</span>' : "")
      + '</button>';
  }

  function bindTaskChips() {
    chips.querySelectorAll("[data-task-id]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const alreadyActive = chip.classList.contains("active");
        state.taskId = alreadyActive ? "" : chip.dataset.taskId || "";
        chips.querySelectorAll(".chip").forEach((item) => item.classList.remove("active"));
        if (!alreadyActive) chip.classList.add("active");
      });
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
  }

  function searchWorkflowTasks() {
    const query = window.prompt("搜索任务标题、领域或项目", state.searchQuery);
    if (query === null) return;
    state.searchQuery = query.trim();
    renderTasks();
    const count = filterTasks(state.tasks).length;
    setStatus(state.searchQuery ? "找到 " + count + " 个任务。" : "已显示全部任务。");
  }

  async function createWorkflowTask() {
    const title = window.prompt("输入新任务名称");
    if (title === null) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setStatus("任务名不能为空。", "error");
      return;
    }
    setStatus("正在新增任务...");
    try {
      if (!window.llmWikiDesktop.createWorkflowRecorderTask) throw new Error("当前版本不支持新增任务。");
      const created = await window.llmWikiDesktop.createWorkflowRecorderTask({ title: trimmedTitle });
      state.tasks = [created, ...state.tasks.filter((task) => task.id !== created.id)];
      state.searchQuery = "";
      state.taskId = created.id;
      renderTasks();
      setStatus("已新增并选中任务。", "success");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  function setupTypeCards() {
    document.querySelectorAll("[data-marker]").forEach((card) => {
      card.querySelector(".type-icon").innerHTML = icons[card.dataset.marker] || icons.normal;
      card.addEventListener("click", () => {
        state.marker = card.dataset.marker || "normal";
        document.querySelectorAll("[data-marker]").forEach((item) => item.classList.toggle("active", item === card));
      });
    });
  }

  async function submitRecord() {
    const text = input.value.trim();
    if (!input.value.trim()) {
      setStatus("先写一条执行记录。", "error");
      input.focus();
      return;
    }
    setStatus("正在识别任务并归档...");
    try {
      const result = await window.llmWikiDesktop.submitWorkflowRecorder({
        text,
        taskId: state.taskId,
        marker: state.marker,
        attachments: state.attachments,
      });
      setStatus(result.message || "已记录。", "success");
      window.setTimeout(() => window.close(), 360);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error), "error");
    }
  }

  document.getElementById("close").addEventListener("click", () => window.close());
  document.getElementById("submit").addEventListener("click", submitRecord);
  document.getElementById("search-task").addEventListener("click", searchWorkflowTasks);
  document.getElementById("new-task").addEventListener("click", createWorkflowTask);
  input.addEventListener("input", updateCounter);
  window.llmWikiDesktop.getWorkflowRecorderTasks().then(displayTasks).catch(() => displayTasks([]));
  setupTypeCards();
  updateCounter();
  input.focus();
`;

function buildWorkflowRecorderCaptureHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>执行记录器</title>
    <style>${STYLES}</style>
  </head>
  <body>
    <main>
      <section class="window">
        ${renderHeader()}
        ${renderTextarea()}
        ${renderRecentFlows()}
        ${renderTypeCards()}
        ${renderHint()}
        ${renderFooter()}
      </section>
    </main>
    <script>${SCRIPT}</script>
  </body>
</html>`;
}

function renderHeader(): string {
  return `
    <header>
      <div class="app-icon" aria-hidden="true">${linkIcon()}</div>
      <div><h1>执行记录器</h1><div class="subtitle">一键记录刚刚做了什么</div></div>
      <button type="button" class="close" id="close" aria-label="关闭">${xIcon()}</button>
    </header>`;
}

function renderTextarea(): string {
  return `
    <div class="input-wrap">
      <textarea id="record-input" maxlength="1000" placeholder="刚刚做了什么？现在停在哪？遇到了什么？如有参考链接，可直接粘贴。"></textarea>
      <span class="counter" id="counter">0 / 1000</span>
    </div>`;
}

function renderRecentFlows(): string {
  return `
    <div class="section-title task-title">
      <span>绑定任务 <small>来自任务池，可选</small></span>
      <span class="task-actions">
        <button type="button" class="task-action" id="search-task">搜索任务</button>
        <button type="button" class="task-action" id="new-task">新增任务</button>
      </span>
    </div>
    <div class="chips" id="recent-flows"><button type="button" class="chip" disabled>正在读取任务池…</button></div>`;
}

function renderTypeCards(): string {
  return `
    <div class="section-title">记录类型 <small>单选</small></div>
    <div class="types">
      ${typeCard("normal", "过程记录", "记录做到哪一步、做了哪些关键动作", true)}
      ${typeCard("issue", "卡点问题", "记录卡住的位置、报错、疑问", false)}
      ${typeCard("resolved", "解决记录", "记录怎么解决、哪些做法有效", false)}
      ${typeCard("method", "可能的方法方案", "记录可复用的做法、方案与待验证方法", false)}
    </div>`;
}

function typeCard(marker: string, title: string, body: string, active: boolean): string {
  return `<button type="button" class="type${active ? " active" : ""}" data-marker="${marker}"><strong><span class="type-icon"></span>${title}</strong><p>${body}</p></button>`;
}

function renderHint(): string {
  return `<div class="hint">${sparkIcon()}<span>AI 将自动识别任务、当前节点、问题与下一步；若检测到链接或“按这个链接/教程做”等表述，会保留为附件或资料线索。</span></div>`;
}

function renderFooter(): string {
  return `<div class="footer"><div id="status" class="status"></div><button type="button" class="submit" id="submit">一键记录</button></div>`;
}

function linkIcon(): string {
  return `<svg width="34" height="34" viewBox="0 0 24 24" fill="none"><path d="M10 13.5a4 4 0 0 0 5.7 0l2.3-2.3a4 4 0 0 0-5.7-5.7l-1.1 1.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14 10.5a4 4 0 0 0-5.7 0L6 12.8a4 4 0 0 0 5.7 5.7l1.1-1.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function xIcon(): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function sparkIcon(): string {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M12 3l1.8 5 5.2 1.8-5.2 1.8L12 17l-1.8-5.4L5 9.8 10.2 8 12 3Z" fill="#1464ff"/><path d="M18 15l.8 2.2L21 18l-2.2.8L18 21l-.8-2.2L15 18l2.2-.8L18 15Z" fill="#1464ff"/></svg>`;
}

export function buildWorkflowRecorderCaptureDataUrl(): string {
  const html = buildWorkflowRecorderCaptureHtml();
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}
