#!/usr/bin/env node

const commands = ["run", "resume", "compile", "sessions"] as const;
type Command = (typeof commands)[number];

function printUsage(): void {
  console.error(`Usage: skflow <command> [options]

Commands:
  run <name>          Run a compiled skflow script
  resume <id>         Resume a paused session
  compile <name>      Compile a .ts script to state machine
  sessions ls|clean   Manage sessions`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] as Command | undefined;

  if (!command || args.includes("--help") || args.includes("-h") || !commands.includes(command)) {
    printUsage();
    process.exit(command && commands.includes(command) ? 0 : command ? 1 : 0);
    return;
  }

  const subArgs = args.slice(1);

  switch (command) {
    case "run": {
      const { runCommand } = await import("./commands/run.js");
      await runCommand(subArgs);
      break;
    }
    case "resume": {
      const { resumeCommand } = await import("./commands/resume.js");
      await resumeCommand(subArgs);
      break;
    }
    case "compile": {
      const { compileCommand } = await import("./commands/compile.js");
      await compileCommand(subArgs);
      break;
    }
    case "sessions": {
      const { sessionsCommand } = await import("./commands/sessions.js");
      await sessionsCommand(subArgs);
      break;
    }
  }
}

main().catch((err) => {
  const errorJson = { error: { message: err.message ?? String(err) } };
  process.stdout.write(JSON.stringify(errorJson) + "\n");
  process.exit(1);
});
