import { sh, ask, done } from "@ocmdx/runtime";

export async function main() {
  const greeting = await sh("echo hello");
  const name = await ask({ prompt: "What is your name?" });
  const farewell = await sh("echo Hi, " + name);
  return done({ summary: "Greeted " + name });
}
