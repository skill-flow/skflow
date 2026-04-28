---
description: Auto-bump package versions based on commits since last release
allowed-tools: Bash(skflow *)
---

# bump

Run the skflow bump script and handle the yield protocol.

1. Run `skflow run bump` and parse the JSON output
2. If yield: analyze the commits and changed files to determine bump types per package, then `skflow resume <session> --answer="<JSON bump map>"`
3. If done: report the summary
4. On error: report the error message
