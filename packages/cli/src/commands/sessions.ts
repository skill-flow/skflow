import { listSessions, cleanExpiredSessions } from "@skflow/runtime/session";

export async function sessionsCommand(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "ls") {
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.error("No active sessions");
      return;
    }
    console.error("ID\tScript\tAge\tStatus");
    for (const s of sessions) {
      const ageMin = Math.round((Date.now() - s.createdAt) / 60_000);
      const status = s.expired ? "expired" : "active";
      console.error(`${s.id}\t${s.scriptName}\t${ageMin}m\t${status}`);
    }
    return;
  }

  if (sub === "clean") {
    const cleaned = cleanExpiredSessions();
    console.error(`Cleaned ${cleaned} expired session${cleaned === 1 ? "" : "s"}`);
    return;
  }

  console.error("Usage: skflow sessions ls|clean");
  process.exit(1);
}
