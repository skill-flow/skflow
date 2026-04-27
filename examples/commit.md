---
description: Check staged files, auto-generate commit title and commit
allowed-tools: Bash(skflow *)
---

# commit

Run the skflow commit script and handle the yield protocol.

1. Run `skflow run commit` and parse the JSON output
2. If yield: generate a commit title based on the diff data, then `skflow resume <session> --answer="<title>"`
3. If yield (ask-user): present the question to the user with AskUserQuestion, then resume with their answer
4. If done: report the summary
5. On error: report the error message
