import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { run, RuntimeError } from "@ocmdx/runtime";
import type { StepFunction } from "@ocmdx/runtime";

function findCompiledScript(name: string): string | null {
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, ".claude", "commands", ".cmdx", `${name}.compiled.js`);
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
      "Usage: cmdx run <name>\n\nRun a compiled cmdx script. Creates a session, executes from phase 0,\nand outputs JSON (yield or done) to stdout.",
    );
    return;
  }
  const name = args[0];
  if (!name) {
    console.error("Usage: cmdx run <name>");
    process.exit(1);
  }

  const scriptPath = findCompiledScript(name);
  if (!scriptPath) {
    console.error(`Compiled script not found: ${name}.compiled.js`);
    console.error("Run 'cmdx compile " + name + "' first.");
    process.exit(1);
  }

  let step: StepFunction;
  try {
    const mod = await import(pathToFileURL(scriptPath).href);
    step = mod.step;
    if (typeof step !== "function") {
      console.error(`Script does not export a 'step' function: ${scriptPath}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Failed to load script: ${err.message}`);
    process.exit(1);
  }

  try {
    const result = run({ scriptName: name, scriptPath, step });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    if (err instanceof RuntimeError) {
      process.stdout.write(JSON.stringify(err.errorMessage) + "\n");
      process.exit(1);
    }
    throw err;
  }
}
