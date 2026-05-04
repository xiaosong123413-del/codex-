/**
 * Flash-diary page shell markup.
 *
 * Isolates the static workspace structure from the controller binding code so
 * behavior changes can stay focused in the main page module.
 */
export function renderFlashDiaryPageShell(): string {
  return `
    <div class="flash-diary-page__workspace">
      ${renderListPanel()}
      ${renderResizeHandle()}
      ${renderEditorPanel()}
    </div>
  `;
}

function renderListPanel(): string {
  return `
    <aside class="flash-diary-page__list-panel">
      <div class="flash-diary-page__panel-header">
        <h2>以往日记</h2>
        <button type="button" class="btn btn-secondary btn-inline" data-flash-diary-refresh>刷新</button>
      </div>
      <div class="flash-diary-page__list" data-flash-diary-list>
        <div class="flash-diary-page__empty">正在读取闪念日记...</div>
      </div>
    </aside>
  `;
}

function renderResizeHandle(): string {
  return `
    <div
      class="panel-resize-handle panel-resize-handle--page"
      data-panel-handle="flashDiary.listWidth"
      aria-hidden="true"
    ></div>
  `;
}

function renderEditorPanel(): string {
  return `
    <section class="flash-diary-page__editor-panel">
      ${renderEditorHeader()}
      <div class="flash-diary-page__visual-editor-host" data-flash-diary-visual-editor-host hidden></div>
      <textarea class="flash-diary-page__editor" data-flash-diary-editor spellcheck="false" placeholder="尚未加载日记"></textarea>
      ${renderMemoryLayout()}
    </section>
  `;
}

function renderEditorHeader(): string {
  return `
    <div class="flash-diary-page__panel-header">
      <div>
        <h2 data-flash-diary-current-title>未选中文档</h2>
        <p data-flash-diary-current-meta>请从左侧选择一篇日记、十二个问题或 Memory。</p>
      </div>
      <div class="flash-diary-page__actions">
        <button type="button" class="btn btn-primary btn-inline" data-flash-diary-save disabled>保存当前文档</button>
        <button type="button" class="btn btn-secondary btn-inline" data-flash-diary-memory-refresh hidden>刷新 Memory</button>
        <button type="button" class="btn btn-secondary btn-inline" data-flash-diary-memory-comment hidden>评论</button>
      </div>
    </div>
  `;
}

function renderMemoryLayout(): string {
  return `
    <div class="flash-diary-page__memory-layout" data-flash-diary-memory-layout data-wiki-comments-open="false" hidden>
      <div class="wiki-page__selection-toolbar" data-flash-diary-selection-toolbar hidden>
        <button type="button" class="wiki-page__tab-action" data-flash-diary-selection-comment>评论</button>
        <button type="button" class="wiki-page__tab-action" data-flash-diary-selection-copy>复制</button>
        <button type="button" class="wiki-page__tab-action" data-flash-diary-selection-cancel>取消</button>
      </div>
      <article class="flash-diary-page__memory-article markdown-rendered" data-flash-diary-memory-body>
        <div class="flash-diary-page__empty">请选择左侧记忆卡片。</div>
      </article>
      ${renderMemoryCommentsPanel()}
    </div>
  `;
}

function renderMemoryCommentsPanel(): string {
  return `
    <aside class="wiki-comments-panel flash-diary-page__memory-comments" data-flash-diary-memory-comments hidden>
      <div class="wiki-comments-panel__header">
        <div>
          <div class="eyebrow">COMMENTS</div>
          <h3 class="wiki-comments-panel__title">评论</h3>
        </div>
        <button type="button" class="btn btn-secondary btn-inline" data-flash-diary-memory-comments-close>关闭</button>
      </div>
      <p class="wiki-comments-panel__hint">这里保存当前 Memory 页面评论；AI 自动解决会直接写回 journal-memory.md。</p>
      <p class="wiki-comments-panel__status" data-wiki-comments-status>选中文本后点击“评论”。</p>
      <div data-wiki-comments-list></div>
    </aside>
  `;
}
