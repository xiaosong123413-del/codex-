/**
 * Page-hotspot source-insight sample for the flash-diary page.
 *
 * The flash-diary page is rendered as a centered thumbnail. Each important
 * page hotspot fans outward into its own readable micro-flow so the UI can
 * answer both "this region comes from where" and "clicking this area runs
 * what" without collapsing all explanations into a single cramped graph.
 */

// fallow-ignore-next-line unresolved-import
import type { CodeDerivedSourceInsightPageHotspotView } from "../../../server/services/code-derived-automation-types.js";

export const FLASH_DIARY_PAGE_HOTSPOT_VIEW: CodeDerivedSourceInsightPageHotspotView = {
  title: "页面热点流程",
  description: "中间是闪念日记页缩略图；拖拽、滚轮和双指缩放都作用在整张图上，外围每个热点都接一段完整微流程。",
  svg: `
<svg width="2400" height="1600" viewBox="0 0 2400 1600" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="flashPageBg" x1="80" y1="48" x2="2320" y2="1520" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FBFAFF"/>
      <stop offset="1" stop-color="#F2EEFF"/>
    </linearGradient>
    <filter id="flashPageShadow" x="-40" y="-40" width="2480" height="1680" filterUnits="userSpaceOnUse">
      <feDropShadow dx="0" dy="22" stdDeviation="28" flood-color="#B8ABF4" flood-opacity="0.18"/>
    </filter>
    <marker id="flashArrow" markerWidth="14" markerHeight="14" refX="11" refY="7" orient="auto">
      <path d="M0 0L14 7L0 14Z" fill="#7A67F4"/>
    </marker>
    <style>
      .frame { fill: #FFFDFE; stroke: #E7E1FA; }
      .headline { font: 700 18px "Segoe UI","Microsoft YaHei",sans-serif; fill: #231D3C; }
      .copy { font: 500 14px "Segoe UI","Microsoft YaHei",sans-serif; fill: #5A5378; }
      .flow { fill: #FFFFFF; stroke: #DAD3FA; }
      .flowText { font: 600 12px "Segoe UI","Microsoft YaHei",sans-serif; fill: #2A2550; }
      .flowTextSmall { font: 500 11px "Segoe UI","Microsoft YaHei",sans-serif; fill: #5E5880; }
      .hotspot { fill: #7A67F4; stroke: #FFFFFF; stroke-width: 5; }
      .timelineStroke { stroke: #7A67F4; stroke-width: 4; fill: none; marker-end: url(#flashArrow); }
      .microStroke { stroke: #CFC6F8; stroke-width: 2.5; fill: none; marker-end: url(#flashArrow); }
    </style>
  </defs>

  <rect width="2400" height="1600" fill="url(#flashPageBg)"/>

  <g filter="url(#flashPageShadow)">
    <rect x="760" y="280" width="900" height="760" rx="34" fill="#FFFFFF" stroke="#E6E0FB"/>
  </g>
  <rect
    data-automation-page-hotspot-center="true"
    x="760"
    y="280"
    width="900"
    height="760"
    rx="34"
    fill="transparent"
    stroke="transparent"
    pointer-events="none"
  />

  <rect x="792" y="322" width="68" height="676" rx="24" fill="#FBFAFF" stroke="#ECE7FD"/>
  <rect x="812" y="360" width="30" height="46" rx="12" fill="#2E5BEA"/>
  <rect x="812" y="444" width="30" height="46" rx="12" fill="#F0ECE2"/>
  <rect x="812" y="528" width="30" height="46" rx="12" fill="#F0ECE2"/>
  <rect x="812" y="612" width="30" height="46" rx="12" fill="#DCE5FF"/>
  <rect x="812" y="908" width="30" height="46" rx="12" fill="#F0ECE2"/>

  <rect x="890" y="334" width="640" height="112" rx="26" fill="#FFFFFF" stroke="#ECE7FD"/>
  <text x="926" y="376" class="copy" style="font-weight:700; font-size:12px;">FLASH DIARY</text>
  <text x="926" y="416" class="headline" style="font-size:34px;">闪念日记</text>
  <text x="926" y="450" class="copy">左栏固定功能卡，普通日记以时间轴呈现；右侧正文是可视化混排编辑器。</text>

  <rect x="890" y="478" width="300" height="510" rx="28" class="frame"/>
  <text x="920" y="520" class="headline">以往日记</text>
  <rect x="1068" y="496" width="78" height="34" rx="17" fill="#F2EFE8"/>
  <text x="1094" y="518" class="copy" style="font-size:12px; font-weight:700;">刷新</text>

  <rect x="920" y="560" width="230" height="100" rx="22" fill="#EEE8FF" stroke="#CFC1FF"/>
  <text x="944" y="600" class="headline" style="font-size:17px;">十二个问题</text>
  <text x="944" y="632" class="copy">你的固定追问清单</text>

  <rect x="920" y="682" width="230" height="100" rx="22" fill="#E9F0FF" stroke="#C4D2FF"/>
  <text x="944" y="722" class="headline" style="font-size:17px;">Memory</text>
  <text x="944" y="754" class="copy">根据日记沉淀的分层记忆</text>

  <circle cx="952" cy="844" r="22" fill="#FFFFFF" stroke="#8A6BFF" stroke-width="5"/>
  <circle cx="952" cy="844" r="12" fill="#C98A2B"/>
  <line x1="952" y1="870" x2="952" y2="934" stroke="#D8CCFF" stroke-width="4"/>
  <rect x="986" y="808" width="176" height="72" rx="18" fill="#FFFFFF" stroke="#D8CEF8"/>
  <text x="1008" y="842" class="headline" style="font-size:15px;">2026-04-28</text>
  <text x="1008" y="866" class="copy">2 条记录 · 有图片</text>

  <rect x="1212" y="478" width="406" height="510" rx="28" class="frame"/>
  <text x="1244" y="522" class="headline">2026-04-28</text>
  <text x="1244" y="552" class="copy">2026/04/28 15:01:14 · 2 条记录</text>
  <rect x="1498" y="494" width="100" height="36" rx="18" fill="#7759F2"/>
  <text x="1532" y="518" class="copy" style="fill:#FFFFFF; font-weight:700;">保存</text>

  <rect x="1244" y="568" width="342" height="382" rx="24" fill="#FCFBFF" stroke="#DACDFF" stroke-width="2"/>
  <text x="1272" y="614" class="headline" style="font-size:24px;"># 2026-04-28 闪念日记</text>
  <text x="1272" y="662" class="copy">今天的记录在这里继续编辑，文字和图片在同一个正文区里混排。</text>
  <rect x="1272" y="720" width="220" height="132" rx="18" fill="#E7D9FF" stroke="#D4C0FB"/>
  <rect x="1292" y="740" width="180" height="92" rx="14" fill="#B8A4F2"/>
  <text x="1382" y="792" text-anchor="middle" class="headline" style="font-size:18px; fill:#5C37D9;">缩略图</text>
  <text x="1272" y="892" class="copy">右侧正文区独立滚动，图片和文字一起混排。</text>

  <g data-automation-source-node="questionsView">
    <circle cx="1034" cy="610" r="12" class="hotspot"/>
  </g>
  <g data-automation-source-node="openMemory">
    <circle cx="1034" cy="732" r="12" class="hotspot"/>
  </g>
  <g data-automation-source-node="openDiaryCard">
    <circle cx="1038" cy="844" r="12" class="hotspot"/>
  </g>
  <g data-automation-source-node="saveTrigger">
    <circle cx="1548" cy="512" r="12" class="hotspot"/>
  </g>
  <g data-automation-source-node="editorView">
    <circle cx="1382" cy="786" r="12" class="hotspot"/>
  </g>

  <path d="M1034 610 C910 596, 792 520, 692 420 C548 276, 402 212, 264 212" class="timelineStroke"/>
  <g data-automation-source-node="questionsView">
    <rect x="72" y="88" width="420" height="260" rx="26" class="flow"/>
    <polygon points="138,126 412,126 432,146 412,166 138,166 118,146" class="flow"/>
    <text x="275" y="150" text-anchor="middle" class="flowText">按钮：点击“十二个问题”</text>
    <path d="M275 166 L275 202" class="microStroke"/>
    <rect x="150" y="204" width="250" height="48" rx="14" class="flow"/>
    <text x="275" y="233" text-anchor="middle" class="flowText">处理：打开问题文档</text>
    <path d="M275 252 L275 288" class="microStroke"/>
    <rect x="114" y="290" width="322" height="50" rx="14" class="flow"/>
    <text x="275" y="321" text-anchor="middle" class="flowTextSmall">文件：wiki/journal-twelve-questions.md</text>
  </g>

  <path d="M1034 732 C900 744, 774 768, 666 836 C540 914, 410 958, 270 976" class="timelineStroke"/>
  <g data-automation-source-node="openMemory">
    <rect x="54" y="780" width="560" height="360" rx="26" class="flow"/>
    <polygon points="128,822 456,822 476,842 456,862 128,862 108,842" class="flow"/>
    <text x="292" y="846" text-anchor="middle" class="flowText">按钮：点击 / 刷新 Memory</text>
    <path d="M292 862 L292 910" class="microStroke"/>
  </g>
  <g data-automation-source-node="memoryDecision">
    <polygon points="216,912 368,912 412,974 368,1036 216,1036 172,974" class="flow"/>
    <text x="292" y="970" text-anchor="middle" class="flowText">判断：这次是否需要刷新</text>
    <text x="146" y="1074" class="copy" style="font-size:12px;">不需要</text>
    <text x="442" y="1074" class="copy" style="font-size:12px;">需要</text>
  </g>
  <g data-automation-source-node="memoryFile">
    <path d="M172 974 C140 998, 120 1026, 118 1060" class="microStroke"/>
    <rect x="60" y="1084" width="162" height="52" rx="26" class="flow"/>
    <text x="141" y="1116" text-anchor="middle" class="flowTextSmall">结果：继续显示当前 Memory</text>
  </g>
  <g data-automation-source-node="memoryProcess">
    <path d="M412 974 C454 988, 478 1018, 492 1054" class="microStroke"/>
    <rect x="392" y="1082" width="180" height="48" rx="14" class="flow"/>
    <text x="482" y="1111" text-anchor="middle" class="flowText">处理：汇总近日日记</text>
    <path d="M482 1130 L482 1168" class="microStroke"/>
    <rect x="356" y="1172" width="252" height="48" rx="14" class="flow"/>
    <text x="482" y="1201" text-anchor="middle" class="flowTextSmall">文件：wiki/journal-memory.md</text>
  </g>

  <path d="M1038 844 C900 920, 764 1022, 652 1130 C532 1244, 402 1306, 276 1332" class="timelineStroke"/>
  <g data-automation-source-node="openDiaryCard">
    <rect x="96" y="1220" width="470" height="252" rx="26" class="flow"/>
    <polygon points="170,1260 490,1260 510,1280 490,1300 170,1300 150,1280" class="flow"/>
    <text x="330" y="1284" text-anchor="middle" class="flowText">按钮：点击某篇日记</text>
    <path d="M330 1300 L330 1340" class="microStroke"/>
    <rect x="196" y="1344" width="268" height="48" rx="14" class="flow"/>
    <text x="330" y="1373" text-anchor="middle" class="flowText">处理：打开对应日期正文</text>
    <path d="M330 1392 L330 1430" class="microStroke"/>
    <rect x="146" y="1434" width="368" height="50" rx="14" class="flow"/>
    <text x="330" y="1465" text-anchor="middle" class="flowTextSmall">文件：raw/闪念日记/YYYY-MM-DD.md</text>
  </g>

  <path d="M1548 512 C1670 494, 1780 442, 1876 358 C1982 266, 2084 216, 2190 200" class="timelineStroke"/>
  <g data-automation-source-node="saveTrigger">
    <rect x="1884" y="100" width="420" height="258" rx="26" class="flow"/>
    <polygon points="1960,140 2228,140 2248,160 2228,180 1960,180 1940,160" class="flow"/>
    <text x="2094" y="164" text-anchor="middle" class="flowText">按钮：保存当前日记</text>
    <path d="M2094 180 L2094 222" class="microStroke"/>
    <rect x="1964" y="226" width="260" height="48" rx="14" class="flow"/>
    <text x="2094" y="255" text-anchor="middle" class="flowText">处理：写回当天 Markdown</text>
    <path d="M2094 274 L2094 314" class="microStroke"/>
    <rect x="1920" y="318" width="348" height="50" rx="14" class="flow"/>
    <text x="2094" y="349" text-anchor="middle" class="flowTextSmall">文件：raw/闪念日记/YYYY-MM-DD.md</text>
  </g>

  <path d="M1382 786 C1534 864, 1670 950, 1784 1048 C1886 1138, 1990 1184, 2142 1196" class="timelineStroke"/>
  <g data-automation-source-node="editorView">
    <rect x="1824" y="1080" width="520" height="300" rx="26" class="flow"/>
    <polygon points="1900,1122 2268,1122 2288,1142 2268,1162 1900,1162 1880,1142" class="flow"/>
    <text x="2084" y="1146" text-anchor="middle" class="flowText">区域：右侧正文编辑区</text>
    <path d="M2084 1162 L2084 1204" class="microStroke"/>
    <rect x="1914" y="1208" width="340" height="48" rx="14" class="flow"/>
    <text x="2084" y="1237" text-anchor="middle" class="flowText">处理：读取当天 Markdown 和图片引用</text>
    <path d="M2084 1256 L2084 1298" class="microStroke"/>
    <rect x="1928" y="1302" width="312" height="50" rx="25" class="flow"/>
    <text x="2084" y="1333" text-anchor="middle" class="flowText">结果：可视化混排编辑区</text>
  </g>
</svg>
`.trim(),
};
