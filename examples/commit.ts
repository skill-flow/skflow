import { sh, ask, done } from "@ocmdx/runtime";

export async function main() {
  // Step 1: Check staged files
  const staged = await sh("git diff --cached --name-status");
  if (!staged.stdout.trim()) {
    return done({ summary: "No staged files" });
  }

  // Step 2: Get diff details
  const stat = await sh("git diff --cached --stat");
  const diff = await sh("git diff --cached");

  // Step 3: Ask LLM to generate commit message (title + description)
  const message = await ask({
    prompt:
      "Generate a commit message for the following changes.\n" +
      "Line 1: title in the format <type>: <description> (max 80 chars, lowercase, English, no period)\n" +
      "Line 2: blank\n" +
      "Line 3+: brief description of what changed (bullet points)\n\n" +
      "Types: feat, fix, refactor, perf, docs, style, test, chore",
    data: { staged, stat, diff },
  });

  // Step 4: Execute git commit using stdin to avoid shell escaping issues
  let lastResult = await sh("git commit -F -", { stdin: message });

  // Step 5: If commit succeeded, we're done
  if (lastResult.code === 0) {
    return done({ summary: message.split("\n")[0], data: { commitResult: lastResult } });
  }

  // Step 6: Pre-commit failed — loop: yield to caller for fix, then retry
  // No retry limit — caller (Claude Code) decides when to stop
  while (true) {
    const fix = await ask({
      prompt:
        "Pre-commit hook failed with the following errors. " +
        "Please fix the issues, then resume.\n\n" +
        lastResult.stderr,
      data: { stderr: lastResult.stderr, stdout: lastResult.stdout },
    });

    // Caller has fixed the code — re-stage and retry
    const restage = await sh("git add -u");
    lastResult = await sh("git commit -F -", { stdin: message });

    if (lastResult.code === 0) {
      return done({ summary: message.split("\n")[0], data: { commitResult: lastResult } });
    }
  }
}
