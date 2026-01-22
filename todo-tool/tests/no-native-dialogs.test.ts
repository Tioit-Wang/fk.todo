import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function listFilesRecursive(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listFilesRecursive(full));
      continue;
    }
    files.push(full);
  }
  return files;
}

function isTestFile(filePath: string) {
  return (
    filePath.endsWith(".test.ts") ||
    filePath.endsWith(".test.tsx") ||
    filePath.endsWith(".spec.ts") ||
    filePath.endsWith(".spec.tsx")
  );
}

describe("no native dialogs", () => {
  it("does not use window.alert()/window.confirm() in src/", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, "..");
    const srcDir = path.join(root, "src");

    const sourceFiles = listFilesRecursive(srcDir).filter((filePath) => {
      if (isTestFile(filePath)) return false;
      return filePath.endsWith(".ts") || filePath.endsWith(".tsx");
    });

    const offenders: Array<{ filePath: string; match: string }> = [];
    const alertCall = /\balert\s*\(/;
    const confirmCall = /\bconfirm\s*\(/;

    for (const filePath of sourceFiles) {
      const contents = readFileSync(filePath, "utf8");
      const alertMatch = contents.match(alertCall);
      if (alertMatch) offenders.push({ filePath, match: alertMatch[0] });
      const confirmMatch = contents.match(confirmCall);
      if (confirmMatch) offenders.push({ filePath, match: confirmMatch[0] });
    }

    expect(offenders).toEqual([]);
  });
});

