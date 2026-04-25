import { describe, it, expect } from "vitest";
import ts from "typescript";
import { hoistVariables } from "./hoist.js";

function parseBody(code: string): ts.Statement[] {
  const src = ts.createSourceFile("test.ts", code, ts.ScriptTarget.Latest, true);
  return [...src.statements];
}

function printStatements(stmts: ts.Statement[], sourceFile?: ts.SourceFile): string {
  const printer = ts.createPrinter();
  const src = sourceFile ?? ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest);
  return stmts.map((s) => printer.printNode(ts.EmitHint.Unspecified, s, src)).join("\n");
}

describe("hoistVariables", () => {
  it("hoists simple const declaration", () => {
    const body = parseBody(`const x = 1;`);
    const { hoisted, statements } = hoistVariables(body, ts.factory);

    expect(hoisted).toHaveLength(1);
    expect(hoisted[0].name).toBe("x");

    const out = printStatements(statements);
    expect(out).toContain("state.x = 1");
    expect(out).not.toContain("const");
  });

  it("hoists multiple variable declarations", () => {
    const body = parseBody(`const a = 1;\nlet b = "hello";\nconst c = true;`);
    const { hoisted, statements } = hoistVariables(body, ts.factory);

    expect(hoisted).toHaveLength(3);
    expect(hoisted.map((h) => h.name)).toEqual(["a", "b", "c"]);
    expect(statements).toHaveLength(3);
  });

  it("hoists variables inside if blocks", () => {
    const body = parseBody(`if (cond) { const x = 1; } else { const y = 2; }`);
    const { hoisted } = hoistVariables(body, ts.factory);

    expect(hoisted).toHaveLength(2);
    expect(hoisted.map((h) => h.name)).toEqual(["x", "y"]);
  });

  it("hoists variables inside while loops", () => {
    const body = parseBody(`while (true) { const x = getValue(); }`);
    const { hoisted } = hoistVariables(body, ts.factory);

    expect(hoisted).toHaveLength(1);
    expect(hoisted[0].name).toBe("x");
  });

  it("hoists for loop initializer", () => {
    const body = parseBody(`for (let i = 0; i < 10; i++) { const x = i; }`);
    const { hoisted } = hoistVariables(body, ts.factory);

    expect(hoisted.map((h) => h.name)).toContain("i");
    expect(hoisted.map((h) => h.name)).toContain("x");
  });

  it("skips declarations without initializer (hoists name only)", () => {
    const body = parseBody(`let x;`);
    const { hoisted, statements } = hoistVariables(body, ts.factory);

    expect(hoisted).toHaveLength(1);
    expect(hoisted[0].name).toBe("x");
    // No assignment statement since there's no initializer
    expect(statements).toHaveLength(0);
  });

  it("preserves non-declaration statements", () => {
    const body = parseBody(`console.log("hi");\nconst x = 1;\nconsole.log(x);`);
    const { hoisted, statements } = hoistVariables(body, ts.factory);

    expect(hoisted).toHaveLength(1);
    expect(statements).toHaveLength(3);
  });
});
