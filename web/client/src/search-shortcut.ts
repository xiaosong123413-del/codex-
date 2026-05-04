/**
 * Current-page text find shortcut.
 *
 * Ctrl+F opens a small page-owned find bar and searches only the DOM scope that
 * the active page provides, instead of routing to the app-wide search endpoint.
 */
import { eventMatchesShortcut, getClientKeyboardShortcut } from "./keyboard-shortcuts.js";

interface PageSearchBar {
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  readonly status: HTMLElement;
}

interface TextSearchMatch {
  readonly node: Text;
  readonly start: number;
  readonly end: number;
}

interface SearchInputSelection {
  readonly start: number;
  readonly end: number;
  readonly direction: "forward" | "backward" | "none";
}

interface SearchShortcutBinding {
  readonly root: HTMLElement;
  readonly getScope: () => HTMLElement | null;
  readonly bar: PageSearchBar;
  readonly highlightKey: string;
  matches: TextSearchMatch[];
  activeIndex: number;
  markers: HTMLElement[];
  isComposing: boolean;
}

const searchShortcutBindings: SearchShortcutBinding[] = [];
const PAGE_SEARCH_HIGHLIGHT_KEY = "llmwiki-page-search";
let isSearchShortcutListening = false;

export function bindPageSearchShortcut(root: HTMLElement, getScope: () => HTMLElement | null): () => void {
  const binding: SearchShortcutBinding = {
    root,
    getScope,
    bar: createPageSearchBar(root),
    highlightKey: PAGE_SEARCH_HIGHLIGHT_KEY,
    matches: [],
    activeIndex: -1,
    markers: [],
    isComposing: false,
  };
  bindSearchBarEvents(binding);
  searchShortcutBindings.push(binding);
  ensureSearchShortcutListener();
  return () => removeSearchShortcutBinding(binding);
}

function createPageSearchBar(owner: HTMLElement): PageSearchBar {
  const root = document.createElement("div");
  root.className = "page-text-search";
  root.dataset.pageTextSearch = "true";
  root.hidden = true;
  root.innerHTML = `
    <label class="page-text-search__field">
      <span>查找</span>
      <input type="search" data-page-text-search-input autocomplete="off" />
    </label>
    <span class="page-text-search__status" data-page-text-search-status></span>
    <button type="button" class="page-text-search__button" data-page-text-search-prev aria-label="上一个">↑</button>
    <button type="button" class="page-text-search__button" data-page-text-search-next aria-label="下一个">↓</button>
    <button type="button" class="page-text-search__button" data-page-text-search-close aria-label="关闭">×</button>
  `;
  owner.appendChild(root);
  return {
    root,
    input: root.querySelector<HTMLInputElement>("[data-page-text-search-input]")!,
    status: root.querySelector<HTMLElement>("[data-page-text-search-status]")!,
  };
}

function bindSearchBarEvents(binding: SearchShortcutBinding): void {
  binding.bar.input.addEventListener("compositionstart", () => {
    binding.isComposing = true;
  });
  binding.bar.input.addEventListener("compositionend", () => {
    binding.isComposing = false;
    runPageTextSearch(binding);
  });
  binding.bar.input.addEventListener("input", (event) => handleSearchInput(binding, event));
  binding.bar.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      moveActiveMatch(binding, event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      hideSearchBar(binding);
    }
  });
  binding.bar.root.querySelector<HTMLElement>("[data-page-text-search-prev]")?.addEventListener("click", () => {
    moveActiveMatch(binding, -1);
  });
  binding.bar.root.querySelector<HTMLElement>("[data-page-text-search-next]")?.addEventListener("click", () => {
    moveActiveMatch(binding, 1);
  });
  binding.bar.root.querySelector<HTMLElement>("[data-page-text-search-close]")?.addEventListener("click", () => {
    hideSearchBar(binding);
  });
}

function handleSearchInput(binding: SearchShortcutBinding, event: Event): void {
  if (binding.isComposing || isComposingInputEvent(event)) return;
  runPageTextSearch(binding);
}

function isComposingInputEvent(event: Event): boolean {
  const candidate = event as Event & { readonly isComposing?: boolean };
  return candidate.isComposing === true;
}

function ensureSearchShortcutListener(): void {
  if (isSearchShortcutListening) return;
  document.addEventListener("keydown", handleSearchShortcut);
  isSearchShortcutListening = true;
}

function handleSearchShortcut(event: KeyboardEvent): void {
  if (!isPageTextSearchShortcut(event) || event.defaultPrevented) return;
  const binding = findCurrentSearchBinding();
  if (!binding) return;
  event.preventDefault();
  showSearchBar(binding);
}

function showSearchBar(binding: SearchShortcutBinding): void {
  binding.bar.root.hidden = false;
  binding.bar.input.focus();
  binding.bar.input.select();
  runPageTextSearch(binding);
}

function hideSearchBar(binding: SearchShortcutBinding): void {
  binding.bar.root.hidden = true;
  clearPageSelection();
  clearSearchHighlights(binding);
}

function runPageTextSearch(binding: SearchShortcutBinding): void {
  const query = binding.bar.input.value.trim();
  const inputSelection = captureSearchInputSelection(binding.bar.input);
  clearPageSelection();
  clearSearchHighlights(binding);
  binding.matches = query ? collectTextMatches(binding.getScope(), query) : [];
  binding.activeIndex = -1;
  renderSearchHighlights(binding);
  syncSearchStatus(binding, query);
  restoreSearchInputSelection(binding.bar.input, inputSelection);
}

function captureSearchInputSelection(input: HTMLInputElement): SearchInputSelection | null {
  if (document.activeElement !== input || input.selectionStart === null || input.selectionEnd === null) return null;
  return {
    start: input.selectionStart,
    end: input.selectionEnd,
    direction: input.selectionDirection ?? "none",
  };
}

function restoreSearchInputSelection(input: HTMLInputElement, selection: SearchInputSelection | null): void {
  if (!selection) return;
  if (document.activeElement !== input) input.focus({ preventScroll: true });
  input.setSelectionRange(selection.start, selection.end, selection.direction);
}

function collectTextMatches(scope: HTMLElement | null, query: string): TextSearchMatch[] {
  if (!scope) return [];
  const matches: TextSearchMatch[] = [];
  const normalizedQuery = query.toLowerCase();
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    collectTextNodeMatches(node, normalizedQuery, matches);
  }
  return matches;
}

function collectTextNodeMatches(node: Text, normalizedQuery: string, matches: TextSearchMatch[]): void {
  if (!isSearchableTextNode(node)) return;
  const text = node.data;
  let index = text.toLowerCase().indexOf(normalizedQuery);
  while (index >= 0) {
    matches.push({ node, start: index, end: index + normalizedQuery.length });
    index = text.toLowerCase().indexOf(normalizedQuery, index + normalizedQuery.length);
  }
}

function isSearchableTextNode(node: Text): boolean {
  const parent = node.parentElement;
  if (!parent || !node.data.trim()) return false;
  if (parent.closest("[data-page-text-search],script,style,noscript,[hidden]")) return false;
  return true;
}

function moveActiveMatch(binding: SearchShortcutBinding, direction: number): void {
  if (binding.matches.length === 0) return;
  const currentIndex = binding.activeIndex < 0 && direction > 0 ? -1 : binding.activeIndex;
  binding.activeIndex = (currentIndex + direction + binding.matches.length) % binding.matches.length;
  syncSearchStatus(binding, binding.bar.input.value.trim());
  activateCurrentMatch(binding);
}

function activateCurrentMatch(binding: SearchShortcutBinding): void {
  clearPageSelection();
  const match = binding.matches[binding.activeIndex];
  if (!match) return;
  const range = document.createRange();
  range.setStart(match.node, match.start);
  range.setEnd(match.node, match.end);
  window.getSelection()?.addRange(range);
  scrollMatchIntoView(match);
}

function syncSearchStatus(binding: SearchShortcutBinding, query: string): void {
  if (!query) {
    binding.bar.status.textContent = "";
  } else if (binding.matches.length === 0) {
    binding.bar.status.textContent = "无结果";
  } else if (binding.activeIndex < 0) {
    binding.bar.status.textContent = `${binding.matches.length} 个结果`;
  } else {
    binding.bar.status.textContent = `${binding.activeIndex + 1} / ${binding.matches.length}`;
  }
}

function renderSearchHighlights(binding: SearchShortcutBinding): void {
  if (renderNativeHighlights(binding)) return;
  renderMarkerHighlights(binding);
}

function renderNativeHighlights(binding: SearchShortcutBinding): boolean {
  const highlightApi = getNativeHighlightApi();
  if (!highlightApi || binding.matches.length === 0) return false;
  const ranges = binding.matches.map(createMatchRange);
  highlightApi.registry.set(binding.highlightKey, new highlightApi.Highlight(...ranges));
  return true;
}

function renderMarkerHighlights(binding: SearchShortcutBinding): void {
  const matches = [...binding.matches].reverse();
  for (const match of matches) {
    const marker = document.createElement("mark");
    marker.className = "page-text-search__mark";
    marker.dataset.pageTextSearchMark = "true";
    const range = createMatchRange(match);
    range.surroundContents(marker);
    binding.markers.push(marker);
  }
  binding.matches = collectMarkerMatches(binding.markers);
}

function collectMarkerMatches(markers: readonly HTMLElement[]): TextSearchMatch[] {
  const matches: TextSearchMatch[] = [];
  for (const marker of [...markers].reverse()) {
    const node = marker.firstChild;
    if (!(node instanceof Text)) continue;
    matches.push({ node, start: 0, end: node.data.length });
  }
  return matches;
}

function clearSearchHighlights(binding: SearchShortcutBinding): void {
  getNativeHighlightApi()?.registry.delete(binding.highlightKey);
  while (binding.markers.length > 0) {
    const marker = binding.markers.pop()!;
    const parent = marker.parentNode;
    marker.replaceWith(document.createTextNode(marker.textContent ?? ""));
    parent?.normalize();
  }
}

function createMatchRange(match: TextSearchMatch): Range {
  const range = document.createRange();
  range.setStart(match.node, match.start);
  range.setEnd(match.node, match.end);
  return range;
}

interface NativeHighlightApi {
  readonly Highlight: new (...ranges: Range[]) => unknown;
  readonly registry: {
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
}

function getNativeHighlightApi(): NativeHighlightApi | null {
  const candidate = globalThis as unknown as {
    CSS?: { highlights?: NativeHighlightApi["registry"] };
    Highlight?: NativeHighlightApi["Highlight"];
  };
  if (!candidate.CSS?.highlights || !candidate.Highlight) return null;
  return { Highlight: candidate.Highlight, registry: candidate.CSS.highlights };
}

function scrollMatchIntoView(match: TextSearchMatch): void {
  const parent = match.node.parentElement;
  parent?.scrollIntoView?.({ block: "center", inline: "nearest" });
}

function clearPageSelection(): void {
  window.getSelection()?.removeAllRanges();
}

function isPageTextSearchShortcut(event: KeyboardEvent): boolean {
  return eventMatchesShortcut(event, getClientKeyboardShortcut("pageTextSearch"));
}

function findCurrentSearchBinding(): SearchShortcutBinding | null {
  for (let index = searchShortcutBindings.length - 1; index >= 0; index -= 1) {
    const binding = searchShortcutBindings[index];
    if (binding.root.isConnected) return binding;
  }
  return null;
}

function removeSearchShortcutBinding(binding: SearchShortcutBinding): void {
  const index = searchShortcutBindings.indexOf(binding);
  if (index >= 0) searchShortcutBindings.splice(index, 1);
  clearSearchHighlights(binding);
  binding.bar.root.remove();
  if (searchShortcutBindings.length === 0 && isSearchShortcutListening) {
    document.removeEventListener("keydown", handleSearchShortcut);
    isSearchShortcutListening = false;
  }
}
