#!/usr/bin/env node
/**
 * Verifies that a public desktop or mobile package directory does not contain
 * local private data. The package build must copy only application code and
 * assets; user vaults, runtime caches, environment files, cookies, and tokens
 * belong in per-user storage after login.
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

const requestedPackageRoots = process.argv.slice(2);
const defaultPackageRoots = [
  "dist/public",
  "dist/desktop-webui-launcher",
  "dist/gui",
];
const packageRoots = (requestedPackageRoots.length > 0 ? requestedPackageRoots : defaultPackageRoots)
  .map((packageRoot) => path.resolve(packageRoot))
  .filter((packageRoot) => existsSync(packageRoot));
const forbiddenSegments = new Set([
  ".env",
  ".runtime",
  ".secrets",
  ".wrangler",
  "raw",
  "wiki",
  "sources_full",
]);
const forbiddenPatterns = [
  /cookie/i,
  /token/i,
  /app-config\.json$/i,
  /sync-compile-config\.json$/i,
  /ai-vault/i,
];

if (packageRoots.length === 0) {
  throw new Error("No package directories exist. Pass a package path or build a public artifact first.");
}

const violations = [];
for (const packageRoot of packageRoots) {
  await scanPackage(packageRoot, packageRoot);
}

if (violations.length > 0) {
  console.error("Public package contains private local data:");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exit(1);
}

async function scanPackage(packageRoot, dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(packageRoot, fullPath).replace(/\\/g, "/");
    if (isForbidden(relativePath)) {
      violations.push(relativePath);
      continue;
    }
    if (entry.isDirectory()) {
      await scanPackage(packageRoot, fullPath);
    }
  }
}

function isForbidden(relativePath) {
  const segments = relativePath.split("/");
  return segments.some((segment) => forbiddenSegments.has(segment))
    || forbiddenPatterns.some((pattern) => pattern.test(relativePath));
}
