import type { RouteName } from "../router.js";
import { renderIcon } from "../components/icon.js";

interface RailOptions {
  current: RouteName;
  onNavigate: (route: RouteName) => void;
}

interface RailHandle {
  update(current: RouteName): void;
}

type RailItem = {
  route: RouteName;
  icon: string;
  label: string;
  position: "top" | "bottom";
};

const RAIL_ITEMS: RailItem[] = [
  { route: "workspace", icon: "hammer", label: "\u5de5\u4f5c\u53f0", position: "top" },
  { route: "chat", icon: "message-square", label: "\u5bf9\u8bdd", position: "top" },
  { route: "flash-diary", icon: "book-open-text", label: "\u95ea\u5ff5\u65e5\u8bb0", position: "top" },
  { route: "sources", icon: "archive", label: "\u6e90\u6599\u5e93", position: "top" },
  { route: "wiki", icon: "wikipedia-w", label: "wiki", position: "top" },
  { route: "check", icon: "check-circle-2", label: "\u68c0\u67e5", position: "top" },
  { route: "sync", icon: "refresh-cw", label: "\u540c\u6b65", position: "top" },
  { route: "review", icon: "clipboard-list", label: "\u5ba1\u67e5", position: "top" },
  { route: "settings", icon: "settings", label: "\u8bbe\u7f6e", position: "bottom" },
];

export function mountRail(container: HTMLElement, options: RailOptions): RailHandle {
  container.className = "shell-rail";
  container.innerHTML = "";

  const top = document.createElement("div");
  const spacer = document.createElement("div");
  spacer.className = "shell-rail__spacer";
  const bottom = document.createElement("div");

  for (const item of RAIL_ITEMS) {
    const button = document.createElement("button");
    button.className = "shell-rail__btn";
    button.type = "button";
    button.dataset.route = item.route;
    button.setAttribute("aria-label", item.label);
    button.title = item.label;
    button.innerHTML = renderIcon(item.icon, { size: 24 });
    button.addEventListener("click", () => options.onNavigate(item.route));
    (item.position === "top" ? top : bottom).appendChild(button);
  }

  container.append(top, spacer, bottom);
  applyActive(container, options.current);

  return {
    update(current) {
      applyActive(container, current);
    },
  };
}

function applyActive(container: HTMLElement, current: RouteName): void {
  const activeRoute = normalizeRailRoute(current);
  const buttons = container.querySelectorAll<HTMLButtonElement>(".shell-rail__btn");
  buttons.forEach((button) => {
    button.setAttribute("data-active", button.dataset.route === activeRoute ? "true" : "false");
  });
}

function normalizeRailRoute(current: RouteName): RouteName {
  return current === "automation" || current === "automation-log" || current === "project-log"
    ? "settings"
    : current;
}
