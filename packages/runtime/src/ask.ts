// Placeholder APIs for script authors — actual execution is handled by the runtime loop
// after the transformer converts these calls into state machine yield points.

export async function ask(_opts: {
  prompt: string;
  data?: unknown;
  options?: string[];
}): Promise<string> {
  throw new Error(
    "ask() cannot be called directly. It is transformed into a state machine yield point at compile time.",
  );
}

export async function askUser(_opts: { question: string; options?: string[] }): Promise<string> {
  throw new Error(
    "askUser() cannot be called directly. It is transformed into a state machine yield point at compile time.",
  );
}
