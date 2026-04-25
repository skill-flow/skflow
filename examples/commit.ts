import { sh, ask, askUser, done } from "@ocmdx/runtime";

export async function main() {
  // Step 1: Check staged files
  const staged = await sh("git diff --cached --name-status");
  if (!staged.stdout.trim()) {
    return done({ summary: "No staged files" });
  }

  // Step 2: Get diff details
  const stat = await sh("git diff --cached --stat");
  const diff = await sh("git diff --cached");

  // Step 3-4: Ask LLM to generate commit title based on diff
  const title = await ask({
    prompt: "Generate a commit title (max 80 chars, format: <type>: <description>)",
    data: { staged, stat, diff },
  });

  // Step 5: Execute git commit
  const commitResult = await sh('git commit -m "' + title + '"');

  // Check if commit succeeded (code 0 from sh result)
  let retries = 0;
  while (retries < 2) {
    // If commit succeeded, we're done
    if (commitResult) {
      return done({ summary: title, data: { commitResult } });
    }

    // Commit failed — try to fix and retry
    retries++;
    const fixAction = await askUser({
      question: "Pre-commit hook failed after " + retries + " retries. What would you like to do?",
      data: { commitResult },
    });

    // After user fixes, re-stage and retry
    const restage = await sh("git add -u");
    const retry = await sh('git commit -m "' + title + '"');
  }

  // Exhausted retries — ask user for final decision
  const fallback = await askUser({
    question: "Commit failed after 2 retries. Options: 1) Fix manually, 2) --no-verify, 3) Cancel",
  });

  return done({ summary: "Commit deferred to user", data: { fallback } });
}
