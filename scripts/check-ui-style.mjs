import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dashboardPath = "packages/ui/src/DashboardApp.tsx";
const sharedStylesPath = "packages/ui/src/styles.css";
const renderedUiPaths = [
  sharedStylesPath,
  dashboardPath,
  "apps/web/app/web.css",
  "apps/desktop/src/renderer/renderer.css",
];
const forbiddenStyles = [
  {
    label: "gradient",
    pattern: /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/giu,
  },
  {
    label: "box-shadow",
    pattern: /\b(?:box-shadow|boxShadow)\s*:/giu,
  },
  {
    label: "backdrop-filter",
    pattern:
      /\b(?:-webkit-backdrop-filter|backdrop-filter|backdropFilter|WebkitBackdropFilter)\s*:/giu,
  },
  {
    label: "blur filter",
    pattern: /\bblur\s*\(/giu,
  },
  {
    label: "visible border",
    pattern:
      /\bborder(?:-(?:top|right|bottom|left))?\s*:(?!\s*0(?:\s*[;}]))\s*[^;]+;/giu,
  },
];

const sources = new Map(
  await Promise.all(
    renderedUiPaths.map(async (relativePath) => [
      relativePath,
      await readFile(join(root, relativePath), "utf8"),
    ]),
  ),
);
const violations = [];

function sourceLocation(source, index) {
  const line = source.slice(0, index).split(/\r?\n/u).length;
  const lineStart = source.lastIndexOf("\n", index - 1) + 1;
  return { line, column: index - lineStart + 1 };
}

function addViolation(relativePath, source, index, message) {
  const { line, column } = sourceLocation(source, index);
  violations.push(`${relativePath}:${line}:${column} ${message}`);
}

function skipQuotedText(source, start, quote) {
  for (let index = start + 1; index < source.length; index += 1) {
    if (source[index] === "\\") {
      index += 1;
      continue;
    }
    if (source[index] === quote) return index;
  }
  return source.length - 1;
}

function findMatchingDelimiter(source, openIndex, open, close) {
  let depth = 0;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (character === "/" && nextCharacter === "/") {
      const lineEnd = source.indexOf("\n", index + 2);
      if (lineEnd === -1) return -1;
      index = lineEnd;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      if (commentEnd === -1) return -1;
      index = commentEnd + 1;
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      index = skipQuotedText(source, index, character);
      continue;
    }

    if (character === open) depth += 1;
    if (character !== close) continue;

    depth -= 1;
    if (depth === 0) return index;
  }

  return -1;
}

function findMediaBlocks(source, queryPattern) {
  const blocks = [];

  for (const match of source.matchAll(queryPattern)) {
    const openIndex = source.indexOf("{", match.index);
    const closeIndex = findMatchingDelimiter(source, openIndex, "{", "}");
    if (openIndex === -1 || closeIndex === -1) continue;
    blocks.push(source.slice(openIndex + 1, closeIndex));
  }

  return blocks;
}

for (const relativePath of renderedUiPaths) {
  const source = sources.get(relativePath);

  for (const { label, pattern } of forbiddenStyles) {
    for (const match of source.matchAll(pattern)) {
      addViolation(relativePath, source, match.index, `forbidden ${label} styling`);
    }
  }
}

const dashboardSource = sources.get(dashboardPath);
const cannedLaunchControl = /Create an authentication page with frontend|Launch demo task/giu.exec(
  dashboardSource,
);
if (cannedLaunchControl) {
  addViolation(
    dashboardPath,
    dashboardSource,
    cannedLaunchControl.index,
    "the overview must not contain a canned demo task control",
  );
}

const legacyNavigation = /\b(?:navigationGroups|DashboardSection|RunsView|AgentsView)\b/gu.exec(
  dashboardSource,
);
if (legacyNavigation) {
  addViolation(
    dashboardPath,
    dashboardSource,
    legacyNavigation.index,
    "legacy multi-section dashboard navigation must stay removed",
  );
}

const sharedStyles = sources.get(sharedStylesPath);
const drawerBlocks = findMediaBlocks(
  sharedStyles,
  /@media[^\{]*\(\s*max-width\s*:\s*900px\s*\)[^\{]*\{/giu,
);
const hasResponsiveSidebar = drawerBlocks.some(
  (block) => /\.overview-sidebar(?=[\s,{.:>+~])/u.test(block),
);
if (!hasResponsiveSidebar) {
  addViolation(
    sharedStylesPath,
    sharedStyles,
    0,
    "the 900px media query must contain the compact overview sidebar state",
  );
}

const reducedMotionBlocks = findMediaBlocks(
  sharedStyles,
  /@media[^\{]*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)[^\{]*\{/giu,
);
if (reducedMotionBlocks.length === 0) {
  addViolation(
    sharedStylesPath,
    sharedStyles,
    0,
    "a prefers-reduced-motion: reduce media query is required",
  );
}

if (violations.length > 0) {
  process.stderr.write(`UI style audit failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("UI style audit passed.\n");
