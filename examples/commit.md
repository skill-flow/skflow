---
description: Check staged files, auto-generate commit title and commit
allowed-tools: Bash(cmdx *)
---

# commit

Run the cmdx commit script and handle the yield protocol.

1. Run `cmdx run commit` and parse the JSON output
2. If yield: generate a commit title based on the diff data, then `cmdx resume <session> --answer="<title>"`
3. If yield (ask-user): present the question to the user with AskUserQuestion, then resume with their answer
4. If done: report the summary
5. On error: report the error message
