import * as fs from "node:fs";
import * as path from "node:path";
import { transform } from "@ocmdx/transform";

function findCommandsDir(): string {
  // Walk up from cwd looking for .claude/commands/.cmdx/
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".claude", "commands", ".cmdx");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Default to cwd/.claude/commands/.cmdx/
  return path.join(process.cwd(), ".claude", "commands", ".cmdx");
}

export async function compileCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.error(
      "Usage: cmdx compile <name>\n\nCompile a .ts script to a state machine (.compiled.js).",
    );
    return;
  }
  const name = args[0];
  if (!name) {
    console.error("Usage: cmdx compile <name>");
    process.exit(1);
  }

  const cmdxDir = findCommandsDir();
  const srcPath = path.join(cmdxDir, `${name}.ts`);

  if (!fs.existsSync(srcPath)) {
    console.error(`Source not found: ${srcPath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(srcPath, "utf-8");
  const result = transform(source, `${name}.ts`);

  if (result.errors.length > 0) {
    for (const err of result.errors) {
      console.error(`Error: ${err}`);
    }
    process.exit(1);
  }

  const outPath = path.join(cmdxDir, `${name}.compiled.js`);
  fs.writeFileSync(outPath, result.code, "utf-8");
  console.error(`Compiled: ${outPath}`);
}
