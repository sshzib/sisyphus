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
const expectedSections = [
  "overview",
  "runs",
  "agents",
  "skills",
  "conflicts",
  "integrations",
  "policies",
  "audit",
  "devices",
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
const oldGlyphField = /\bglyph\s*:/gu.exec(dashboardSource);
if (oldGlyphField) {
  addViolation(
    dashboardPath,
    dashboardSource,
    oldGlyphField.index,
    "remove the old glyph field from the section registry",
  );
}

const sectionIconMatch = /\bfunction\s+SectionIcon\s*\(/u.exec(dashboardSource);
if (!sectionIconMatch) {
  addViolation(dashboardPath, dashboardSource, 0, "SectionIcon function is missing");
} else {
  const parametersOpen = dashboardSource.indexOf("(", sectionIconMatch.index);
  const parametersClose = findMatchingDelimiter(dashboardSource, parametersOpen, "(", ")");
  const bodyOpen = dashboardSource.indexOf("{", parametersClose + 1);
  const bodyClose = findMatchingDelimiter(dashboardSource, bodyOpen, "{", "}");

  if (parametersClose === -1 || bodyOpen === -1 || bodyClose === -1) {
    addViolation(
      dashboardPath,
      dashboardSource,
      sectionIconMatch.index,
      "SectionIcon function could not be parsed",
    );
  } else {
    const sectionIconBody = dashboardSource.slice(bodyOpen + 1, bodyClose);
    const sectionCases = new Set(
      [...sectionIconBody.matchAll(/\bcase\s+(["'])([^"']+)\1\s*:/gu)].map(
        (match) => match[2],
      ),
    );

    for (const section of expectedSections) {
      if (!sectionCases.has(section)) {
        addViolation(
          dashboardPath,
          dashboardSource,
          sectionIconMatch.index,
          `SectionIcon is missing the ${section} case`,
        );
      }
    }
  }
}

const sharedStyles = sources.get(sharedStylesPath);
const drawerBlocks = findMediaBlocks(
  sharedStyles,
  /@media[^\{]*\(\s*max-width\s*:\s*900px\s*\)[^\{]*\{/giu,
);
const hasDrawerBreakpoint = drawerBlocks.some(
  (block) => /\.side-nav(?=[\s,{.:>+~])/u.test(block) && /\.side-nav--open\b/u.test(block),
);
if (!hasDrawerBreakpoint) {
  addViolation(
    sharedStylesPath,
    sharedStyles,
    0,
    "the 900px media query must contain the side navigation drawer states",
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
