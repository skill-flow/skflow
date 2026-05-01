# @skflow/cli

CLI for compiling and running skflow scripts.

## Install

```bash
npm install -g @skflow/cli
```

## Commands

### `skflow compile <name>`

Compile a script from `.skflow/skills/<name>/script.ts` into `.skflow/skills/<name>/script.compiled.js`.

```bash
skflow compile commit
```

### `skflow run <name>`

Run a compiled script. Outputs JSON to stdout (yield, done, or error).

```bash
skflow run commit
```

### `skflow resume <session-id>`

Resume a paused session with an answer.

```bash
skflow resume abc123 --answer="feat: add login"
skflow resume abc123 --answer-file=/tmp/long-answer.txt
```

### `skflow sessions`

List active sessions.

```bash
skflow sessions
```

## Yield Protocol

The CLI outputs JSON to stdout:

```json
{"yield": {"type": "text", "prompt": "...", "data": {...}}, "log": [...], "session": "<id>", "resume": "skflow resume <id>"}
```

```json
{"done": {"summary": "..."}, "log": [...]}
```

```json
{ "error": { "message": "...", "phase": 3 } }
```

All diagnostic messages go to stderr. Only valid JSON on stdout.

## Script Location

Scripts are found by searching up the directory tree for `.skflow/skills/<name>/script.compiled.js`.

## License

MIT
