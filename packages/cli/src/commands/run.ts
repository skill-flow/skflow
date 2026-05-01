import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { run, RuntimeError } from "@skflow/runtime";
import type { StepFunction, SourceMapEntry } from "@skflow/runtime";

function findCompiledScript(name: string): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".skflow", "skills", name, "script.compiled.js");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function runCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.error(
      "Usage: skflow run <name>\n\nRun a compiled skflow script. Creates a session, executes from phase 0,\nand outputs JSON (yield or done) to stdout.",
    );
    return;
  }
  const name = args[0];
  if (!name) {
    console.error("Usage: skflow run <name>");
    process.exit(1);
  }

  const scriptPath = findCompiledScript(name);
  if (!scriptPath) {
    console.error(`Compiled script not found: ${name}.compiled.js`);
    console.error("Run 'skflow compile " + name + "' first.");
    process.exit(1);
  }

  let step: StepFunction;
  let sourceMap: SourceMapEntry[] | undefined;
  try {
    const mod = await import(pathToFileURL(scriptPath).href);
    step = mod.step;
    sourceMap = mod.__sourceMap;
    if (typeof step !== "function") {
      console.error(`Script does not export a 'step' function: ${scriptPath}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Failed to load script: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    const result = run({ scriptName: name, scriptPath, step, sourceMap });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    if (err instanceof RuntimeError) {
      process.stdout.write(JSON.stringify(err.errorMessage) + "\n");
      process.exit(1);
    }
    throw err;
  }
}
