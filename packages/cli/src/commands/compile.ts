import * as fs from "node:fs";
import * as path from "node:path";
import { transform } from "@skflow/transform";

function findSkillsDir(): string {
  // Walk up from cwd looking for .skflow/skills/
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".skflow", "skills");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Default to cwd/.skflow/skills/
  return path.join(process.cwd(), ".skflow", "skills");
}

export async function compileCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.error(
      "Usage: skflow compile <name>\n\nCompile a .ts script to a state machine (.compiled.js).",
    );
    return;
  }
  const name = args[0];
  if (!name) {
    console.error("Usage: skflow compile <name>");
    process.exit(1);
  }

  const skillsDir = findSkillsDir();
  const skillDir = path.join(skillsDir, name);
  const srcPath = path.join(skillDir, "script.ts");

  if (!fs.existsSync(srcPath)) {
    console.error(`Source not found: ${srcPath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(srcPath, "utf-8");
  const result = transform(source, "script.ts");

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.error(`Error: ${err}`);
    }
    process.exit(1);
  }

  const outPath = path.join(skillDir, "script.compiled.js");
  fs.writeFileSync(outPath, result.code, "utf-8");
  console.error(`Compiled: ${outPath}`);
}
