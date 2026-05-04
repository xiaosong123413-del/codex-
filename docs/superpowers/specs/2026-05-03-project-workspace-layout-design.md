# Project Workspace Layout Design

## Purpose

The `项目工作区` page answers two first-screen questions:

1. 我现在有哪些项目，每个项目的状态从哪里来？
2. 我今天应该在什么时间窗口推进哪些项目事项？

This page is not a generic task planner and not a plain work-log document. It is a project execution room: left side shows the execution hierarchy, right side turns that hierarchy into today's project-focused time windows.

## First-Screen Layout

The page uses two primary panes with a draggable divider between them.

- Left pane: `项目态势图`
- Right pane: `今日项目推进窗口`
- Divider: horizontal resizing handle between the panes; the user's width preference should persist locally.

Both panes are first-class. The right pane is not a small widget, and the left pane is not only a navigation tree.

## Left Pane: Execution Hierarchy Graph

The left pane is a connected graph with four fixed layers:

1. `领域`
2. `项目`
3. `任务`
4. `行动`

Connections are meaningful:

- `领域 -> 项目` shows which project belongs to which domain.
- `项目 -> 任务` shows which tasks make up the project state.
- `任务 -> 行动` shows the actual execution records or next actions that explain the task state.

Project status is not a standalone label attached to a project. It is aggregated from task/action nodes:

- `推进` means there are active actions moving the task forward.
- `卡点` means a task/action is blocked and needs attention.
- `下一步` means the task has a clear next action but has not yet moved.
- `已记录` means the action is recorded for traceability, but not today's primary focus.

## Connector Style

The graph uses thin orthogonal layer connectors.

- Lines use right-angle paths, not large arrows.
- Endpoints use small dots or subtle ports.
- Lines should stay visually lighter than nodes.
- Color can signal status, but should not dominate the graph.
- Avoid thick curved arrows, oversized arrowheads, and decorative flowchart styling.

The intended feel is a production workspace diagram, not a presentation flowchart.

## Right Pane: Project Time Windows

The right pane is a time-based project execution panel.

It is not the full daily schedule. It shows only today's project advancement windows:

- Morning / afternoon / evening or concrete time blocks.
- Each block is bound to one task/action node from the left graph.
- Each block states the intended output for that window.

Example block shape:

- Time window
- Project path: `领域 -> 项目 -> 任务`
- Action or blocker to handle
- Expected output

## Page Boundary

This page owns project execution context.

It should include:

- Project-state hierarchy
- Project task/action relationships
- Blockers, active progress, and next steps
- Today's project-focused time windows

It should not become:

- A full daily calendar
- A generic task list
- A second `执行现场`
- A plain Markdown document reader
- A freeform Graphy page

## Graphy Relationship

Graphy remains useful as a secondary relationship tool, but it should not replace the execution hierarchy graph.

The execution hierarchy graph answers: `这个项目状态由哪些任务和行动构成？`

Graphy answers: `这些页面/记录/知识节点之间还有什么关系？`

If Graphy appears on this page, it should be secondary, movable, or collapsible, so it does not compete with the primary left-pane execution graph.

## Interaction Rules

- Dragging the divider changes left/right pane width.
- Clicking a node selects it and highlights its connected path.
- Selecting a task/action can filter or focus the right-pane project windows.
- Clicking a right-pane time window highlights the corresponding node path in the left graph.
- Blocked nodes should be visually findable without making the whole graph noisy.

## Open Implementation Notes

The implementation should start with a small fixed set of hierarchy data derived from current task/work-log sources, then expand only after the layout behavior is stable.

The first implementation does not need automatic graph layout. A layered layout with stable columns is enough:

- Domain column
- Project column
- Task column
- Action column

This keeps the page predictable and avoids introducing a general graph engine before the product shape is proven.
