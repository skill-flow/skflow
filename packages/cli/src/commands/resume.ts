import * as fs from "node:fs";
import { pathToFileURL } from "node:url";
import { resume, RuntimeError } from "@ocmdx/runtime";
import { loadMeta } from "@ocmdx/runtime/session";
import type { StepFunction } from "@ocmdx/runtime";

export async function resumeCommand(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    console.error(
      "Usage: cmdx resume <session-id> [--answer=<text> | --answer-file=<path>]\n\nResume a paused session with an answer.",
    );
    return;
  }
  const sessionId = args[0];
  if (!sessionId) {
    console.error("Usage: cmdx resume <session-id> [--answer=<text> | --answer-file=<path>]");
    process.exit(1);
  }

  // Parse --answer and --answer-file
  let answer: string | undefined;
  let answerFile: string | undefined;

  for (const arg of args.slice(1)) {
    if (arg.startsWith("--answer=")) {
      answer = arg.slice("--answer=".length);
    } else if (arg.startsWith("--answer-file=")) {
      answerFile = arg.slice("--answer-file=".length);
    }
  }

  if (answer !== undefined && answerFile !== undefined) {
    console.error("Cannot specify both --answer and --answer-file");
    process.exit(1);
  }

  let input: string;
  if (answerFile !== undefined) {
    if (!fs.existsSync(answerFile)) {
      console.error(`Answer file not found: ${answerFile}`);
      process.exit(1);
    }
    input = fs.readFileSync(answerFile, "utf-8");
  } else if (answer !== undefined) {
    input = answer;
  } else {
    console.error("An answer is required: use --answer=<text> or --answer-file=<path>");
    process.exit(1);
  }

  // Load session meta to find the script
  let meta;
  try {
    meta = loadMeta(sessionId);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  let step: StepFunction;
  try {
    const mod = await import(pathToFileURL(meta.scriptPath).href);
    step = mod.step;
    if (typeof step !== "function") {
      console.error(`Script does not export a 'step' function: ${meta.scriptPath}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Failed to load script: ${(err as Error).message}`);
    process.exit(1);
  }

  try {
    const result = resume({ sessionId, answer: input, step });
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    if (err instanceof RuntimeError) {
      process.stdout.write(JSON.stringify(err.errorMessage) + "\n");
      process.exit(1);
    }
    throw err;
  }
}
