/**
 * Vitest configuration for the main llmwiki workspace.
 * Excludes nested worktrees and embedded codex workspaces so root test runs
 * only execute this repository's test suite.
 */
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/.worktrees/**",
      "codex/**",
      "gui/**",
      "wiki-clone/**",
      "web/**",
      "desktop-webui/**",
      "cloudflare/**",
      "tools/**",
      "plugins/**",
    ],
    globals: true,
  },
});
