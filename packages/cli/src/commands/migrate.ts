import { execSync } from "node:child_process";

export async function migrateCommand(_args: string[]): Promise<void> {
  if (_args.includes("--help") || _args.includes("-h")) {
    console.error(
      "Usage: cmdx migrate <name>\n\nConvert a command.md to cmdx form (requires clean git tree).",
    );
    return;
  }
  const name = _args[0];
  if (!name) {
    console.error("Usage: cmdx migrate <name>");
    process.exit(1);
  }

  // Check git clean
  try {
    const status = execSync("git status --porcelain", { encoding: "utf-8" }).trim();
    if (status.length > 0) {
      console.error("Working tree is not clean. Please commit or stash changes first.");
      process.exit(1);
    }
  } catch {
    console.error("Not a git repository or git not available.");
    process.exit(1);
  }

  // TODO: LLM-assisted migration — read .md, generate .ts, compile, rewrite .md
  console.error("cmdx migrate: LLM-assisted migration not yet implemented");
  process.exit(1);
}
