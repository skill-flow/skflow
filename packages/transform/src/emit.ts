import ts from "typescript";
import { isYieldCall, getYieldFnName, isDoneReturn, containsYield } from "./detect.js";

const f = ts.factory;

interface Case {
  phase: number;
  stmts: ts.Statement[];
  comment?: string;
}

let nextPhase = 0;
let cases: Case[] = [];

function newPhase(comment?: string): number {
  const p = nextPhase++;
  cases.push({ phase: p, stmts: [], comment });
  return p;
}

function currentCase(): Case {
  return cases[cases.length - 1];
}

function emit(stmt: ts.Statement): void {
  currentCase().stmts.push(stmt);
}

function emitReturn(expr: ts.Expression): void {
  emit(f.createReturnStatement(expr));
}

function deepClone<T extends ts.Node>(node: T): T {
  const visitor = (n: ts.Node): ts.Node => {
    const visited = ts.visitEachChild(n, visitor, undefined);
    return ts.setTextRange(visited, { pos: -1, end: -1 });
  };
  return ts.setTextRange(ts.visitEachChild(node, visitor, undefined), { pos: -1, end: -1 }) as T;
}

function cloneExpr(node: ts.Expression): ts.Expression {
  return deepClone(node);
}

function cloneStmt(node: ts.Statement): ts.Statement {
  return deepClone(node);
}

function stateAccess(name: string): ts.Expression {
  return f.createPropertyAccessExpression(f.createIdentifier("state"), name);
}

function makeNextState(targetPhase: number): ts.ObjectLiteralExpression {
  return f.createObjectLiteralExpression([
    f.createSpreadAssignment(f.createIdentifier("state")),
    f.createPropertyAssignment("phase", f.createNumericLiteral(targetPhase)),
  ]);
}

function makeShYield(cmd: ts.Expression, targetPhase: number): ts.ObjectLiteralExpression {
  return f.createObjectLiteralExpression([
    f.createPropertyAssignment(
      "_sh",
      f.createObjectLiteralExpression([f.createPropertyAssignment("cmd", cmd)]),
    ),
    f.createPropertyAssignment("next", makeNextState(targetPhase)),
  ]);
}

function makeExternalYield(
  fnName: string,
  args: ts.Expression,
  targetPhase: number,
): ts.ObjectLiteralExpression {
  // args is the first argument object passed to ask({...}) or askUser({...})
  const yieldType = fnName === "askUser" ? "ask-user" : "text";

  const properties: ts.ObjectLiteralElementLike[] = [
    f.createPropertyAssignment("type", f.createStringLiteral(yieldType)),
  ];

  // Spread the user's arg object into the yield payload
  // So ask({prompt: "x", data: {...}}) becomes yield: {type: "text", prompt: "x", data: {...}}
  properties.push(f.createSpreadAssignment(args));

  return f.createObjectLiteralExpression([
    f.createPropertyAssignment("yield", f.createObjectLiteralExpression(properties)),
    f.createPropertyAssignment("next", makeNextState(targetPhase)),
  ]);
}

function makeDoneReturn(callExpr: ts.CallExpression): ts.ObjectLiteralExpression {
  const arg = callExpr.arguments[0] ?? f.createObjectLiteralExpression([]);
  return f.createObjectLiteralExpression([f.createPropertyAssignment("done", cloneExpr(arg))]);
}

function getLineNumber(node: ts.Node, sourceFile: ts.SourceFile): number {
  try {
    const pos = node.getStart(sourceFile);
    if (pos < 0) return -1;
    return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
  } catch {
    return -1;
  }
}

/** Main entry: takes hoisted statements and produces a list of switch cases */
export function explodeBody(stmts: ts.Statement[], sourceFile: ts.SourceFile): { cases: Case[] } {
  nextPhase = 0;
  cases = [];
  newPhase();

  explodeStatements(stmts, sourceFile);

  return { cases };
}

function explodeStatements(stmts: ts.Statement[], sourceFile: ts.SourceFile): void {
  for (const stmt of stmts) {
    explodeStatement(stmt, sourceFile);
  }
}

function explodeStatement(stmt: ts.Statement, sourceFile: ts.SourceFile): void {
  const line = getLineNumber(stmt, sourceFile);

  // return done(...)
  if (isDoneReturn(stmt)) {
    const callExpr = (stmt as ts.ReturnStatement).expression as ts.CallExpression;
    emitReturn(makeDoneReturn(callExpr));
    return;
  }

  // Expression statement containing an await yield call: state.x = await sh/ask/askUser(...)
  if (ts.isExpressionStatement(stmt) && containsYield(stmt)) {
    explodeYieldExpression(stmt.expression, sourceFile, line);
    return;
  }

  // If statement with yields in branches
  if (ts.isIfStatement(stmt) && containsYield(stmt)) {
    explodeIf(stmt, sourceFile, line);
    return;
  }

  // While loop with yields
  if (ts.isWhileStatement(stmt) && containsYield(stmt)) {
    explodeWhile(stmt, sourceFile, line);
    return;
  }

  // For loop with yields
  if (ts.isForStatement(stmt) && containsYield(stmt)) {
    explodeFor(stmt, sourceFile, line);
    return;
  }

  // Block
  if (ts.isBlock(stmt)) {
    explodeStatements([...stmt.statements], sourceFile);
    return;
  }

  // Return statement (non-done)
  if (ts.isReturnStatement(stmt)) {
    emit(cloneStmt(stmt));
    return;
  }

  // No yield — emit as-is
  if (!containsYield(stmt)) {
    emit(cloneStmt(stmt));
    return;
  }

  // Fallback for other statement types containing yields
  emit(cloneStmt(stmt));
}

function explodeYieldExpression(
  expr: ts.Expression,
  sourceFile: ts.SourceFile,
  line: number,
): void {
  // state.x = await sh("cmd")
  if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const rhs = expr.right;
    if (isYieldCall(rhs)) {
      const fnName = getYieldFnName(rhs);
      const call = rhs.expression as ts.CallExpression;
      const nextP = newPhase(`/* L${line} resume after ${fnName}() */`);

      if (fnName === "sh") {
        emitToCase(
          cases.length - 2,
          f.createReturnStatement(makeShYield(cloneExpr(call.arguments[0]), nextP)),
        );
      } else {
        emitToCase(
          cases.length - 2,
          f.createReturnStatement(makeExternalYield(fnName, cloneExpr(call.arguments[0]), nextP)),
        );
      }

      // In the new phase, assign input to the LHS
      emit(
        f.createExpressionStatement(
          f.createBinaryExpression(
            cloneExpr(expr.left) as ts.Expression,
            ts.SyntaxKind.EqualsToken,
            fnName === "sh"
              ? f.createCallExpression(
                  f.createPropertyAccessExpression(f.createIdentifier("JSON"), "parse"),
                  undefined,
                  [f.createIdentifier("input")],
                )
              : f.createIdentifier("input"),
          ),
        ),
      );
      return;
    }
  }

  // Bare await sh("cmd") / await ask(...) (no assignment)
  if (isYieldCall(expr)) {
    const fnName = getYieldFnName(expr);
    const call = expr.expression as ts.CallExpression;
    const nextP = newPhase(`/* L${line} resume after ${fnName}() */`);

    if (fnName === "sh") {
      emitToCase(
        cases.length - 2,
        f.createReturnStatement(makeShYield(cloneExpr(call.arguments[0]), nextP)),
      );
    } else {
      emitToCase(
        cases.length - 2,
        f.createReturnStatement(makeExternalYield(fnName, cloneExpr(call.arguments[0]), nextP)),
      );
    }
    return;
  }

  // Other expression with yields — fallback
  emit(f.createExpressionStatement(cloneExpr(expr)));
}

function emitToCase(caseIndex: number, stmt: ts.Statement): void {
  cases[caseIndex].stmts.push(stmt);
}

function explodeIf(stmt: ts.IfStatement, sourceFile: ts.SourceFile, _line: number): void {
  const thenContainsYield = containsYield(stmt.thenStatement);
  const elseContainsYield = stmt.elseStatement ? containsYield(stmt.elseStatement) : false;

  if (thenContainsYield || elseContainsYield) {
    // We need to branch: if test → goto thenPhase else goto elsePhase, then merge at afterPhase
    const thenStart = newPhase();

    // Explode then branch
    const thenStmts = ts.isBlock(stmt.thenStatement)
      ? [...stmt.thenStatement.statements]
      : [stmt.thenStatement];
    explodeStatements(thenStmts, sourceFile);

    const elseStart = newPhase();

    // Explode else branch if exists
    if (stmt.elseStatement) {
      const elseStmts = ts.isBlock(stmt.elseStatement)
        ? [...stmt.elseStatement.statements]
        : [stmt.elseStatement];
      explodeStatements(elseStmts, sourceFile);
    }

    const afterP = newPhase();

    // Emit the conditional jump in the phase before thenStart
    // The current case (before thenStart) should have the if test
    const jumpCase = cases[thenStart - 1 >= 0 ? thenStart - 1 : 0];

    // Add jump: if (test) state.phase = thenStart else state.phase = elseStart; then fall through won't work in switch
    // Better: emit if statement that returns with updated phase
    const jumpToThen = f.createBlock([
      f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.EqualsToken,
          f.createNumericLiteral(thenStart),
        ),
      ),
      f.createContinueStatement(),
    ]);
    const jumpToElse = f.createBlock([
      f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.EqualsToken,
          f.createNumericLiteral(elseStart),
        ),
      ),
      f.createContinueStatement(),
    ]);

    jumpCase.stmts.push(f.createIfStatement(cloneExpr(stmt.expression), jumpToThen, jumpToElse));

    // At the end of then branch (last case before elseStart), jump to afterP
    const lastThenCase = cases[elseStart - 1];
    if (!endsWithReturnOrContinue(lastThenCase.stmts)) {
      lastThenCase.stmts.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(afterP),
          ),
        ),
        f.createContinueStatement(),
      );
    }

    // At the end of else branch (last case before afterP), jump to afterP
    const lastElseCase = cases[afterP - 1];
    if (!endsWithReturnOrContinue(lastElseCase.stmts)) {
      lastElseCase.stmts.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(afterP),
          ),
        ),
        f.createContinueStatement(),
      );
    }
  } else {
    // No yields in branches — emit as-is
    emit(cloneStmt(stmt));
  }
}

function explodeWhile(stmt: ts.WhileStatement, sourceFile: ts.SourceFile, _line: number): void {
  // Mark current phase as "loop test"
  const testPhase = newPhase();
  const prevCase = cases[testPhase - 1];

  // Jump from previous case to testPhase
  if (!endsWithReturnOrContinue(prevCase.stmts)) {
    prevCase.stmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.EqualsToken,
          f.createNumericLiteral(testPhase),
        ),
      ),
      f.createContinueStatement(),
    );
  }

  const bodyStart = newPhase();

  // Explode body
  const bodyStmts = ts.isBlock(stmt.statement) ? [...stmt.statement.statements] : [stmt.statement];
  explodeStatements(bodyStmts, sourceFile);

  const afterPhase = newPhase();

  // Test case: if test → goto bodyStart, else → goto afterPhase
  cases[testPhase].stmts.push(
    f.createIfStatement(
      cloneExpr(stmt.expression),
      f.createBlock([
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(bodyStart),
          ),
        ),
        f.createContinueStatement(),
      ]),
      f.createBlock([
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(afterPhase),
          ),
        ),
        f.createContinueStatement(),
      ]),
    ),
  );

  // End of body → loop back to test
  const lastBodyCase = cases[afterPhase - 1];
  if (!endsWithReturnOrContinue(lastBodyCase.stmts)) {
    lastBodyCase.stmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.EqualsToken,
          f.createNumericLiteral(testPhase),
        ),
      ),
      f.createContinueStatement(),
    );
  }
}

function explodeFor(stmt: ts.ForStatement, sourceFile: ts.SourceFile, _line: number): void {
  // Emit initializer in current phase
  if (stmt.initializer) {
    if (ts.isExpression(stmt.initializer)) {
      emit(f.createExpressionStatement(cloneExpr(stmt.initializer)));
    }
    // VariableDeclarationList should already be hoisted
  }

  const testPhase = newPhase();
  const prevCase = cases[testPhase - 1];
  if (!endsWithReturnOrContinue(prevCase.stmts)) {
    prevCase.stmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.EqualsToken,
          f.createNumericLiteral(testPhase),
        ),
      ),
      f.createContinueStatement(),
    );
  }

  const bodyStart = newPhase();

  // Explode body
  const bodyStmts = ts.isBlock(stmt.statement) ? [...stmt.statement.statements] : [stmt.statement];
  explodeStatements(bodyStmts, sourceFile);

  const updatePhase = newPhase();
  const afterPhase = newPhase();

  // Test case
  if (stmt.condition) {
    cases[testPhase].stmts.push(
      f.createIfStatement(
        cloneExpr(stmt.condition),
        f.createBlock([
          f.createExpressionStatement(
            f.createBinaryExpression(
              stateAccess("phase"),
              ts.SyntaxKind.EqualsToken,
              f.createNumericLiteral(bodyStart),
            ),
          ),
          f.createContinueStatement(),
        ]),
        f.createBlock([
          f.createExpressionStatement(
            f.createBinaryExpression(
              stateAccess("phase"),
              ts.SyntaxKind.EqualsToken,
              f.createNumericLiteral(afterPhase),
            ),
          ),
          f.createContinueStatement(),
        ]),
      ),
    );
  } else {
    cases[testPhase].stmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.EqualsToken,
          f.createNumericLiteral(bodyStart),
        ),
      ),
      f.createContinueStatement(),
    );
  }

  // End of body → goto update
  const lastBodyCase = cases[updatePhase - 1];
  if (!endsWithReturnOrContinue(lastBodyCase.stmts)) {
    lastBodyCase.stmts.push(
      f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.EqualsToken,
          f.createNumericLiteral(updatePhase),
        ),
      ),
      f.createContinueStatement(),
    );
  }

  // Update case → goto test
  if (stmt.incrementor) {
    cases[updatePhase].stmts.push(f.createExpressionStatement(cloneExpr(stmt.incrementor)));
  }
  cases[updatePhase].stmts.push(
    f.createExpressionStatement(
      f.createBinaryExpression(
        stateAccess("phase"),
        ts.SyntaxKind.EqualsToken,
        f.createNumericLiteral(testPhase),
      ),
    ),
    f.createContinueStatement(),
  );
}

function endsWithReturnOrContinue(stmts: ts.Statement[]): boolean {
  if (stmts.length === 0) return false;
  const last = stmts[stmts.length - 1];
  return ts.isReturnStatement(last) || ts.isContinueStatement(last);
}

/** Generate the step function source from exploded cases */
export function generateStepFunction(exploded: { cases: Case[] }, _hoistedNames: string[]): string {
  const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
  const src = ts.createSourceFile("out.ts", "", ts.ScriptTarget.Latest);

  const switchCases = exploded.cases
    .filter((c) => c.stmts.length > 0)
    .map((c) => {
      const stmts = [...c.stmts];
      return f.createCaseClause(f.createNumericLiteral(c.phase), stmts);
    });

  const defaultCase = f.createDefaultClause([
    f.createThrowStatement(
      f.createNewExpression(f.createIdentifier("Error"), undefined, [
        f.createTemplateExpression(f.createTemplateHead("Unexpected phase: "), [
          f.createTemplateSpan(stateAccess("phase"), f.createTemplateTail("")),
        ]),
      ]),
    ),
  ]);

  const switchStmt = f.createSwitchStatement(
    stateAccess("phase"),
    f.createCaseBlock([...switchCases, defaultCase]),
  );
  const whileLoop = f.createWhileStatement(f.createTrue(), f.createBlock([switchStmt]));

  const stepFn = f.createFunctionDeclaration(
    [f.createModifier(ts.SyntaxKind.ExportKeyword)],
    undefined,
    "step",
    undefined,
    [
      f.createParameterDeclaration(undefined, undefined, "state"),
      f.createParameterDeclaration(undefined, undefined, "input"),
    ],
    undefined,
    f.createBlock([whileLoop]),
  );

  return printer.printNode(ts.EmitHint.Unspecified, stepFn, src);
}
