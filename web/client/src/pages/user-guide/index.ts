/**
 * User-facing operating guide for LLM Wiki.
 *
 * The guide is intentionally rendered as a static client page instead of a
 * server-backed markdown document. It documents stable product workflows,
 * especially how to fill settings fields, and must stay available even when
 * local wiki content, project logs, or runtime indexes are unavailable. The
 * visual structure follows a documentation-style DESIGN.md pattern: readable
 * prose with a right quick map for scanning.
 */

interface GuideSection {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly items: readonly string[];
}

const GUIDE_SECTIONS: readonly GuideSection[] = [
  {
    id: "start",
    title: "首次启动",
    summary: "先确认账号、目标仓库和同步源。系统通过这三项决定你的资料写到哪里、从哪里读取，以及由哪个工作区拥有这些数据。",
    items: [
      "打开桌面应用后，如果配置缺失或工作区不匹配，会先进入初始化页。",
      "填写账号标识和密码，或使用微信登录；已配置过的设备会复用本地保存的仓库路径。",
      "选择目标仓库作为长期知识库，再添加一个或多个同步源文件夹作为原始资料入口。",
      "点击开始同步并编译后，后台会拉取新资料、写入 raw 层、编译 wiki，并在完成后进入主界面。",
    ],
  },
  {
    id: "daily-flow",
    title: "日常使用流程",
    summary: "日常只需要围绕输入、整理、审查、阅读四步循环。不要先追求页面全部配置完，先让资料稳定进入系统。",
    items: [
      "快速记录想法用闪念日记；网页、图片、长文等资料进入源料库。",
      "需要让 AI 结合资料回答时，在源料库多选后导入对话，或在对话页左侧选择 wiki/raw 文件作为上下文。",
      "点击同步会先检测新源料；有新内容才启动编译，没有新内容会直接提示。",
      "编译后进入 Wiki 阅读结果；审查页处理失败项、低置信结论、待录入 inbox 和需要确认的建议。",
    ],
  },
  {
    id: "settings-layout",
    title: "设置页布置",
    summary: "设置页分为全局设置小窗和可直达的独立设置页。用户填写时按账号来源、应用、仓库、导入源的顺序配置，不需要一开始填满所有区域。",
    items: [
      "全局左栏底部的设置按钮会打开居中小窗，默认进入第三方插件；直接访问 #/settings/分区名 会打开独立设置页。",
      "顶部选项包含 LLM 大模型、应用、自动化、仓库与同步、第三方插件、快捷键、使用说明、项目日志。",
      "第三方插件入口当前只保留占位说明；核心插件和具体第三方插件列表后续版本再支持。",
      "推荐顺序：先在 LLM 大模型添加可用账号，再到应用页创建 Agent，然后到仓库与同步填写目标仓库和源仓库，最后按需要配置导入来源。",
      "不确定的字段先保持默认；只有 API Key、Base URL、模型名、仓库路径这几类会直接影响功能是否可用。",
    ],
  },
  {
    id: "automation-page",
    title: "自动化页",
    summary: "自动化页用于查看和管理应用内 workflow。它现在作为设置里的工作流管理入口，同时在使用说明里集中说明入口、列表、详情和运行日志的使用方式。",
    items: [
      "从设置进入自动化后，直接看到可管理的 workflow 列表；顶部运行中、未启动、全部 Workflow 的筛选行已经移除。",
      "搜索框按 Workflow 名称和流程说明过滤；列表卡片展示应用流程状态、运行状态和运行日志入口。",
      "点击某个 Workflow 进入详情页，查看流程节点、源码洞察、说明和评论。",
      "点击运行日志进入对应日志视图，用于确认执行记录、失败原因和最近一次输出。",
      "自动化页是管理入口，不是普通文档；如果只是想了解怎么配置 workflow，先读应用 Agent 和主要页面两个章节。",
    ],
  },
  {
    id: "project-log-page",
    title: "项目日志页",
    summary: "项目日志页记录 LLM Wiki 应用自身的界面、工作流和同步编译变化。它适合用来回看最近改了什么，以及当前界面应该是什么状态。",
    items: [
      "从设置进入项目日志后，可以查看当前界面说明、当前工作流说明和按时间倒序排列的变更记录。",
      "界面截图只记录独立 DOM 页面，例如对话、闪念日记、源料库、Wiki、审查、Graphy 和设置。",
      "涉及编译架构、发布语义、记忆层级、审查生命周期或桌面入口的变化，都应该进入项目日志。",
      "项目日志描述的是 LLM Wiki 应用本身，不是用户知识库里的工作日志。",
      "如果某个页面表现和项目日志不一致，以最新界面为准，并把项目日志补到真实状态。",
    ],
  },
  {
    id: "llm-settings",
    title: "LLM 提供商怎么填",
    summary: "LLM 大模型页用于添加模型账号。一个提供商可以有多个账号，保存后才会出现在应用页的账号来源里。",
    items: [
      "Provider preset：优先选已有服务商，例如 OpenAI、Anthropic、Gemini、DeepSeek、OpenRouter、MiniMax、Ollama。选中后会自动带出推荐 Base URL、API type 和模型建议。",
      "ID：给这个账号起一个内部标识，例如 openai-main、deepseek-work、local-ollama。只用于区分配置，建议用英文、数字和短横线。",
      "API type：OpenAI 兼容接口选 OpenAI Compatible；Claude 官方或 MiniMax Anthropic 接口选 Anthropic API；Gemini 官方接口选 Gemini API；不确定时看服务商文档写的是哪种协议。",
      "API 密钥：粘贴服务商后台创建的 Key。已经保存过密钥时可以留空，只有想覆盖旧密钥时才重新输入。",
      "基础 URL：填写服务商 API 入口，不要填官网首页。OpenAI 常见为 https://api.openai.com/v1，DeepSeek 为 https://api.deepseek.com/v1，Ollama 本机为 http://localhost:11434/v1。",
      "模型 ID：填写服务商模型列表里的真实 ID，例如 gpt-4o、claude-sonnet-4-20250514、deepseek-chat、gemini-2.5-pro、本地 Ollama 的 llama3.1。",
      "请求传输模式：普通用户保持自动。只有遇到浏览器跨域、桌面端网络、Obsidian requestUrl 等明确错误时，才切换到指定传输模式。",
      "无 Stainless 请求头：只有错误信息提到 x-stainless-os、x-stainless-arch 等请求头时才打开。",
      "自定义请求头：给企业代理或中转站使用，例如要求额外 Authorization、HTTP-Referer、X-Title 时填写；普通服务商不要填。",
      "保存后点击验证。验证通过说明账号、Base URL、模型和密钥能连通；验证失败不会删除配置，按错误信息改字段后再次保存和验证。",
      "ChatGPT OAuth、Gemini OAuth、Claude OAuth、Kimi OAuth 不需要手填 API Key。点击授权后在浏览器完成登录，回到应用等待账号出现在列表。",
    ],
  },
  {
    id: "agent-settings",
    title: "应用 Agent 怎么填",
    summary: "应用页把模型账号包装成可被聊天和自动化调用的 Agent。这里决定用户看到的助手名称、用途、模型来源和行为规则。",
    items: [
      "名称：写给用户看的助手名，例如“知识库问答助手”“文章整理助手”“工作流执行助手”。名称要能说明用途。",
      "应用模式：只做聊天问答选对话；只读知识库和资料选知识；要跑流程选工作流；既要问答又要处理任务选混合。",
      "可以解决啥需求：用一句话写它的职责，例如“根据已导入资料回答问题并给出引用”。这会帮助后续选择默认应用。",
      "接入的大模型：选择前面已经配置过的 Provider 类型，例如 openai、anthropic、gemini、deepseek、relay、ollama。",
      "账号 / 授权来源：优先选具体账号。选择“跟随应用资源默认配置”时，会使用 LLM 页默认账号；多人或多模型场景不建议长期留空。",
      "模型名：通常选账号自带模型；如果服务商新增模型但下拉没有，可以先在 LLM 提供商里更新模型 ID。",
      "工作流：只在工作流或混合模式下填写，写清楚步骤、输入、输出和禁止事项；普通问答 Agent 可以留空。",
      "Prompt：写这个 Agent 的长期行为规则，例如回答语言、引用要求、不能编造、输出格式。不要把临时任务写进这里。",
      "启用这个应用：只有勾选后才会进入可用应用池。测试中的 Agent 可以先取消勾选，避免用户误用。",
      "保存后回到对话页测试一句真实问题；如果回答没有使用资料，先检查对话页是否选了资料，再检查 Agent 的账号和模型是否可用。",
    ],
  },
  {
    id: "search-settings",
    title: "搜索与向量检索怎么填",
    summary: "网络搜索负责查外部网页，本地向量检索负责在已导入资料中找相似内容。两者可独立使用，不是必填项。",
    items: [
      "网络搜索地址：填写搜索服务 API endpoint。没有外部搜索服务可以留空，scope=web 会返回空结果，但本地 wiki 仍可用。",
      "网络搜索密钥：填写搜索服务提供的 Key。已保存后输入框会清空并显示已保存提示，留空不会清除旧密钥。",
      "Provider / 模型：填写搜索服务要求的 provider 或模型名；如果服务只要求 endpoint 和 key，可按服务文档填默认值。",
      "启用向量检索：只有已经配置 embedding 服务并希望提升本地资料召回时打开。资料量很少时可以先关闭。",
      "Embedding 来源：使用远程 embedding API 选网络 / 中转 API；使用应用托管或本机服务选本机 embedding 服务。",
      "可选 embedding 服务：点击刷新查看应用识别到的服务；本机托管服务可直接启动或停止，点某个服务会自动填入 endpoint 和 model。",
      "Embedding endpoint / Base URL：远程服务填 embedding 接口的基础地址，本机服务填本地地址。不要填聊天模型的 Base URL，除非该服务同时支持 embeddings。",
      "API Key：远程 embedding 服务需要填写；本机服务如果不需要鉴权可以留空。",
      "Embedding model：填写 embedding 模型 ID，例如 text-embedding-3-small，或本机服务显示的模型名。",
      "Chunk 字符数：控制每段资料切多长。普通中文资料建议先用 800 到 1500；长文档多可以提高，碎片笔记多可以降低。",
      "Overlap 字符数：控制相邻片段重叠。建议为 Chunk 的 10% 到 20%，例如 Chunk 1000 时填 100 到 200。",
      "保存后先点测试 embedding，再点重建向量索引。重建完成后看 pages、chunks、更新时间是否变化。",
    ],
  },
  {
    id: "sync-settings",
    title: "仓库与同步怎么填",
    summary: "仓库与同步页决定资料从哪里来、最终写到哪里。填写错误时最常见表现是源料库没有新内容，或 Wiki 编译结果不更新。",
    items: [
      "目标仓库：选择长期保存知识库的文件夹。它应该是稳定目录，不要选临时下载目录、桌面零散文件夹或会被清理的软件缓存目录。",
      "源仓库：选择原始资料来源文件夹，可以添加多个。这里放待同步资料，例如网页剪藏、聊天导出、外部笔记、下载的文章或平台导入结果。",
      "目标仓库和源仓库不要填同一个目录。目标仓库是整理后的库，源仓库是入口；混在一起会增加重复同步和误处理风险。",
      "添加路径：手动粘贴绝对路径或点击文件夹按钮选择。Windows 示例为 D:\\Knowledge\\Sources，路径不存在或无权限会导致同步失败。",
      "保存：改完目标仓库或源仓库后必须保存。只选中文件夹但不保存，后续同步仍会使用旧配置。",
      "同步结果：查看同步状态、进度条、摘要和运行日志。日志里如果显示未检测到新源料，说明源目录没有新增可处理内容。",
      "暂停 / 取消：用于长时间同步或配置填错时中断当前任务；取消不会自动删除已经写入的历史结果。",
      "编译情况：只显示 compile 阶段进度。源料已同步但 Wiki 未变化时，优先看这里是否失败或还在运行。",
    ],
  },
  {
    id: "import-settings",
    title: "数据导入怎么填",
    summary: "数据导入区把外部平台资料变成源仓库内容。先把账号 Cookie、导入文件夹或订阅地址填对，再运行同步。",
    items: [
      "小红书 Cookie：先点击打开小红书登录，完成登录后可一键导入 Cookie；如果手动粘贴，要复制浏览器请求里的完整 Cookie 字符串。",
      "小红书导入文件夹地址：选择保存小红书导出内容的源目录。建议放在某个源仓库子目录下，便于后续统一同步。",
      "小红书一键同步：Cookie 和导入文件夹都保存后再点击。进度条显示导入百分比，失败项会写入状态信息或审查页。",
      "抖音 Cookie：流程与小红书类似，先登录再一键导入或手动粘贴。状态里的项目级 fallback 表示当前是否读取到项目保存的 Cookie。",
      "RSS：填写订阅源地址时使用完整 feed URL，不是网站首页。保存后导入内容会进入源料入口。",
      "微信聊天记录、闪念笔记、B 站、小宇宙、X：按卡片进入对应导入流程。导入前先确认导出文件或账号授权已经准备好。",
      "平台 Cookie 失效时，表现通常是导入失败、空结果或权限错误。重新登录平台并重新保存 Cookie 后再同步。",
      "导入只是把外部内容放进源料入口；要让 Wiki 更新，还需要执行同步和编译。",
    ],
  },
  {
    id: "cliproxy-settings",
    title: "CLIProxy 与 OAuth 怎么填",
    summary: "CLIProxy 是内置代理和多账号管理区，适合需要 OAuth 登录、多个 Codex/Claude/Gemini/Kimi 账号或统一上游出口的用户。",
    items: [
      "安装 / 更新引擎：第一次使用 CLIProxy 前先点这里。已经安装过时可用于更新。",
      "CLIProxyAPI 出站代理 URL：只有本机需要代理访问上游服务时填写，例如 http://127.0.0.1:7890。不需要代理时留空。",
      "启动代理：保存代理 URL 后启动。状态显示代理运行中和 proxyBaseUrl 时，说明本地代理可用。",
      "Codex OAuth、Claude OAuth、Gemini CLI OAuth、Kimi OAuth：点击后浏览器会打开授权页，登录完成后等待应用刷新账号列表。",
      "复制授权链接：浏览器没有自动打开或需要换浏览器登录时使用，把链接粘贴到浏览器完成授权。",
      "OpenAI-compatible 名称：给导入的上游账号起名，例如 relay-main、company-gateway。",
      "上游 Base URL：填写中转站或兼容服务的基础地址，通常以 /v1 结尾。",
      "上游 API Key：填写该上游服务的密钥，不是 LLM Wiki 账号密码。",
      "模型 / Alias：填写上游支持的模型名或你希望映射的别名，例如 gpt-4o、claude-sonnet-4-20250514。",
      "OAuth 账号列表里的勾选框控制是否启用该账号。额度刷新只更新显示，不会改变账号密码或删除账号。",
    ],
  },
  {
    id: "shortcuts-plugins",
    title: "快捷键与插件怎么填",
    summary: "快捷键用于桌面效率操作；插件页当前只保留入口，后续再支持核心能力和第三方扩展。",
    items: [
      "快捷键输入框是只读的。点击要修改的快捷键输入框后，按下新的组合键，再点保存快捷键。",
      "闪念日记快速记录：建议设置成不会和系统冲突的全局快捷键，用于随时打开独立记录窗口。",
      "页面内查找：用于当前页面搜索文本，建议保留接近浏览器习惯的组合键。",
      "执行记录器：用于任务池快速记录；如果不用工作台任务流，可以暂不修改。",
      "工作台保存：用于保存当前工作台文档，避免和系统或编辑器保存快捷键冲突。",
      "第三方插件页会提示入口已保留，后续版本将支持社区插件安装、更新和管理。",
      "核心插件详情、插件市场、安全模式和自动更新暂不在当前界面开放。",
      "当前版本不需要在插件页填写任何字段；按日常流程先完成模型、应用、仓库与同步配置。",
    ],
  },
  {
    id: "pages",
    title: "主要页面",
    summary: "左侧全局导航进入独立页面。每个页面只负责一个主任务，减少跨页面混用造成的误操作。",
    items: [
      "工作台维护项目推进、任务计划、任务池、工作日志和工具资产。",
      "对话页用于问答、引用 wiki/raw 资料、保存回答到 wiki，以及重新生成最近一轮回答。",
      "闪念日记用于高频记录、Memory 维护、十二个问题和桌面快捷记录。",
      "源料库用于查看 raw 与 sources_full，支持筛选、编辑原文、多选导入对话和批量处理。",
      "Wiki 用于阅读编译后的知识页、搜索、评论、Graphy 和个人展示页。",
      "Workflow、审查、Graphy 是独立全宽页面；使用说明已收进设置页，和配置入口放在一起。",
    ],
  },
  {
    id: "troubleshooting",
    title: "按问题排查填写项",
    summary: "遇到结果不符合预期时，从入口到产物逐层确认。先判断资料是否进入，再判断是否编译，再判断页面是否刷新。",
    items: [
      "资料没有出现：检查源仓库是否填对、导入文件夹是否在源仓库内、Cookie 是否有效、同步日志是否显示未检测到新源料。",
      "资料存在但 Wiki 没变：检查同步结果是否成功、编译情况是否失败、审查页是否有待处理失败项。",
      "AI 回答不引用资料：检查对话页是否选中了 wiki/raw 文件，或源料库是否已经把多选资料导入对话；再检查向量检索是否启用并重建过索引。",
      "模型不可用：检查 LLM 提供商的 API Key、Base URL、API type、模型 ID；OAuth 账号则刷新账号列表并确认账号已启用。",
      "网络搜索无结果：检查网络搜索地址、密钥、Provider / 模型是否按服务商文档填写；未配置时 web 搜索会返回空结果。",
      "向量检索无结果：检查启用开关、embedding endpoint、API Key、model、Chunk 和 Overlap；保存后必须测试 embedding 并重建索引。",
      "平台导入失败：重新登录平台并更新 Cookie，确认导入文件夹可写，查看状态提示或审查页失败项。",
      "快捷键无效：确认当前运行在桌面应用而不是普通浏览器预览，并检查快捷键是否被系统或其他应用占用。",
      "线上 Wiki 没更新：确认 Cloudflare 发布流程是否完成，已打开页面会在收到发布事件后自动重载。",
    ],
  },
];

export function renderUserGuidePage(anchor?: string): HTMLElement {
  const root = document.createElement("section");
  root.className = "user-guide-page";
  root.innerHTML = `
    <article class="user-guide-page__content">
      <header class="user-guide-page__hero">
        <p class="user-guide-page__eyebrow">USER GUIDE</p>
        <h1>LLM Wiki 使用说明</h1>
        <p>从初始化、同步、设置页字段填写到日常使用流程，按真实应用界面组织。新用户先读日常流程，管理员重点看每个设置字段应该填什么。</p>
      </header>
      ${GUIDE_SECTIONS.map(renderSection).join("")}
    </article>
    <aside class="user-guide-page__toc">
      <p>快速定位</p>
      ${GUIDE_SECTIONS.map(renderTocLink).join("")}
    </aside>
  `;
  scrollGuideAnchor(root, anchor);
  return root;
}

function renderTocLink(section: GuideSection): string {
  return `<a href="#/settings/user-guide#${section.id}">${escapeHtml(section.title)}</a>`;
}

function renderSection(section: GuideSection): string {
  return `
    <section id="${section.id}" class="user-guide-page__section">
      <h2>${escapeHtml(section.title)}</h2>
      <p>${escapeHtml(section.summary)}</p>
      <ol>
        ${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
    </section>
  `;
}

function scrollGuideAnchor(root: HTMLElement, anchor: string | undefined): void {
  if (!anchor) {
    return;
  }
  window.setTimeout(() => {
    const target = root.querySelector<HTMLElement>(`#${cssEscape(anchor)}`);
    if (typeof target?.scrollIntoView !== "function") {
      return;
    }
    target.scrollIntoView({ block: "start" });
  }, 0);
}

function cssEscape(value: string): string {
  if (typeof window.CSS?.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return character;
    }
  });
}
