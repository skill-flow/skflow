import ts from "typescript";
import {
  isYieldCall,
  getYieldFnName,
  isDoneReturn,
  containsYield,
  isThrowingSh,
} from "./detect.js";

const f = ts.factory;

interface Case {
  phase: number;
  stmts: ts.Statement[];
  comment?: string;
}

interface TryEntry {
  tryStart: number;
  tryEnd: number;
  catchStart: number | null;
  catchEnd: number | null;
  finallyStart: number | null;
  finallyEnd: number | null;
  afterPhase: number;
}

let nextPhase = 0;
let cases: Case[] = [];
let tryEntries: TryEntry[] = [];
let shThrowsPragma = false;

// Stack of active try-finally contexts for break/continue routing
interface TryFinallyContext {
  finallyStart: number; // mutable — set to -1 initially, updated once known
  deferredJumps: Array<{ stmts: ts.Statement[]; index: number }>; // patch targets
}
let activeTryFinallyStack: TryFinallyContext[] = [];

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

function makeShYield(
  cmd: ts.Expression,
  targetPhase: number,
  optsArg?: ts.Expression,
): ts.ObjectLiteralExpression {
  const shProperties: ts.ObjectLiteralElementLike[] = [f.createPropertyAssignment("cmd", cmd)];

  // Spread known properties from the options argument if present
  if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
    for (const prop of optsArg.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const name = prop.name.text;
        if (name === "stdin" || name === "timeout") {
          shProperties.push(f.createPropertyAssignment(name, cloneExpr(prop.initializer)));
        }
      }
    }
  } else if (optsArg) {
    // Non-literal options object — spread it at runtime
    shProperties.push(f.createSpreadAssignment(cloneExpr(optsArg)));
  }

  return f.createObjectLiteralExpression([
    f.createPropertyAssignment("_sh", f.createObjectLiteralExpression(shProperties)),
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

/** Emit jump: state.phase = target; continue; */
function emitJump(target: number): void {
  emit(
    f.createExpressionStatement(
      f.createBinaryExpression(
        stateAccess("phase"),
        ts.SyntaxKind.EqualsToken,
        f.createNumericLiteral(target),
      ),
    ),
  );
  emit(f.createContinueStatement());
}

/** Emit jump to a specific case (by index) */
function emitJumpToCase(caseIndex: number, target: number): void {
  cases[caseIndex].stmts.push(
    f.createExpressionStatement(
      f.createBinaryExpression(
        stateAccess("phase"),
        ts.SyntaxKind.EqualsToken,
        f.createNumericLiteral(target),
      ),
    ),
    f.createContinueStatement(),
  );
}

/** Emit jump to finally — handles deferred case when finallyStart isn't known yet */
function emitJumpToFinally(ctx: TryFinallyContext): void {
  if (ctx.finallyStart >= 0) {
    emitJump(ctx.finallyStart);
  } else {
    // Deferred: record the location where we need to patch in the jump
    const curCase = currentCase();
    const index = curCase.stmts.length;
    // Emit placeholder statements (will be replaced)
    curCase.stmts.push(
      f.createExpressionStatement(f.createNumericLiteral(0)), // placeholder
      f.createContinueStatement(), // placeholder
    );
    ctx.deferredJumps.push({ stmts: curCase.stmts, index });
  }
}

/** Main entry: takes hoisted statements and produces a list of switch cases */
export function explodeBody(
  stmts: ts.Statement[],
  sourceFile: ts.SourceFile,
  pragma: boolean = false,
): { cases: Case[]; tryEntries: TryEntry[] } {
  nextPhase = 0;
  cases = [];
  tryEntries = [];
  shThrowsPragma = pragma;
  activeTryFinallyStack = [];
  newPhase();

  explodeStatements(stmts, sourceFile);

  return { cases, tryEntries };
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
    // Check if we're inside a try-finally — if so, route through finally
    if (activeTryFinallyStack.length > 0) {
      const ctx = activeTryFinallyStack[activeTryFinallyStack.length - 1];
      const callExpr = (stmt as ts.ReturnStatement).expression as ts.CallExpression;
      const doneExpr = makeDoneReturn(callExpr);
      // state._completion = { type: "return", value: <done-expr> }
      emit(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("_completion"),
            ts.SyntaxKind.EqualsToken,
            f.createObjectLiteralExpression([
              f.createPropertyAssignment("type", f.createStringLiteral("return")),
              f.createPropertyAssignment("value", doneExpr),
            ]),
          ),
        ),
      );
      emitJumpToFinally(ctx);
      return;
    }
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

  // Try statement with yields
  if (ts.isTryStatement(stmt) && containsYield(stmt)) {
    explodeTry(stmt, sourceFile, line);
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
        const optsArg = call.arguments[1] ? cloneExpr(call.arguments[1]) : undefined;
        emitToCase(
          cases.length - 2,
          f.createReturnStatement(makeShYield(cloneExpr(call.arguments[0]), nextP, optsArg)),
        );

        // In the new phase, assign input to the LHS
        emit(
          f.createExpressionStatement(
            f.createBinaryExpression(
              cloneExpr(expr.left) as ts.Expression,
              ts.SyntaxKind.EqualsToken,
              f.createCallExpression(
                f.createPropertyAccessExpression(f.createIdentifier("JSON"), "parse"),
                undefined,
                [f.createIdentifier("input")],
              ),
            ),
          ),
        );

        // Emit throw check if this sh() should throw on non-zero
        if (isThrowingSh(call, shThrowsPragma)) {
          emitShThrowCheck(cloneExpr(expr.left) as ts.Expression, call.arguments[0]);
        }
      } else {
        emitToCase(
          cases.length - 2,
          f.createReturnStatement(makeExternalYield(fnName, cloneExpr(call.arguments[0]), nextP)),
        );

        // In the new phase, assign input to the LHS
        emit(
          f.createExpressionStatement(
            f.createBinaryExpression(
              cloneExpr(expr.left) as ts.Expression,
              ts.SyntaxKind.EqualsToken,
              f.createIdentifier("input"),
            ),
          ),
        );
      }
      return;
    }
  }

  // Bare await sh("cmd") / await ask(...) (no assignment)
  if (isYieldCall(expr)) {
    const fnName = getYieldFnName(expr);
    const call = expr.expression as ts.CallExpression;
    const nextP = newPhase(`/* L${line} resume after ${fnName}() */`);

    if (fnName === "sh") {
      const optsArg = call.arguments[1] ? cloneExpr(call.arguments[1]) : undefined;
      emitToCase(
        cases.length - 2,
        f.createReturnStatement(makeShYield(cloneExpr(call.arguments[0]), nextP, optsArg)),
      );

      // Emit throw check for bare sh() if throws
      if (isThrowingSh(call, shThrowsPragma)) {
        // Parse input into a temp and check
        // var _tmp = JSON.parse(input); if (_tmp.code !== 0) { _tmp.cmd = ...; throw _tmp; }
        const tmpVar = stateAccess("_shResult");
        emit(
          f.createExpressionStatement(
            f.createBinaryExpression(
              tmpVar,
              ts.SyntaxKind.EqualsToken,
              f.createCallExpression(
                f.createPropertyAccessExpression(f.createIdentifier("JSON"), "parse"),
                undefined,
                [f.createIdentifier("input")],
              ),
            ),
          ),
        );
        emitShThrowCheck(stateAccess("_shResult"), call.arguments[0]);
      }
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

/** Emit: if (expr.code !== 0) { expr.cmd = "..."; throw expr; } */
function emitShThrowCheck(resultExpr: ts.Expression, cmdArg: ts.Expression): void {
  const codeCheck = f.createBinaryExpression(
    f.createPropertyAccessExpression(resultExpr, "code"),
    ts.SyntaxKind.ExclamationEqualsEqualsToken,
    f.createNumericLiteral(0),
  );

  const setCmdStmt = f.createExpressionStatement(
    f.createBinaryExpression(
      f.createPropertyAccessExpression(resultExpr, "cmd"),
      ts.SyntaxKind.EqualsToken,
      cloneExpr(cmdArg),
    ),
  );

  const throwStmt = f.createThrowStatement(resultExpr);

  emit(f.createIfStatement(codeCheck, f.createBlock([setCmdStmt, throwStmt])));
}

function emitToCase(caseIndex: number, stmt: ts.Statement): void {
  cases[caseIndex].stmts.push(stmt);
}

function explodeTry(stmt: ts.TryStatement, sourceFile: ts.SourceFile, _line: number): void {
  const hasCatch = !!stmt.catchClause;
  const hasFinally = !!stmt.finallyBlock;

  const afterPhase = nextPhase; // placeholder — will be allocated later

  // Allocate try body phases
  const tryStart = newPhase();
  const prevCase = cases[tryStart - 1];
  if (!endsWithReturnOrContinue(prevCase.stmts)) {
    emitJumpToCase(tryStart - 1, tryStart);
  }

  // Push finally context if applicable
  const finallyStartPlaceholder: TryFinallyContext = { finallyStart: -1, deferredJumps: [] };
  if (hasFinally) {
    activeTryFinallyStack.push(finallyStartPlaceholder);
  }

  // Explode try body
  const tryStmts = [...stmt.tryBlock.statements];
  explodeStatements(tryStmts, sourceFile);

  const tryEnd = cases.length - 1;

  // After try body completes normally
  let catchStart: number | null = null;
  let catchEnd: number | null = null;
  let finallyStart: number | null = null;
  let finallyEnd: number | null = null;

  if (hasCatch) {
    // Try completed normally → jump to finally (if exists) or afterPhase
    catchStart = newPhase();

    // Pop finally context before exploding catch if we pushed one
    if (hasFinally) {
      activeTryFinallyStack.pop();
    }

    // If has finally, push a new context for catch body
    if (hasFinally) {
      activeTryFinallyStack.push(finallyStartPlaceholder);
    }

    // Explode catch body
    const catchParam = stmt.catchClause!.variableDeclaration;
    const catchParamName =
      catchParam && ts.isIdentifier(catchParam.name) ? catchParam.name.text : null;

    // At catch start: assign state._error to the catch parameter variable
    if (catchParamName) {
      cases[catchStart].stmts.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess(catchParamName),
            ts.SyntaxKind.EqualsToken,
            stateAccess("_error"),
          ),
        ),
      );
    }

    const catchBodyStmts = [...stmt.catchClause!.block.statements];
    explodeStatements(catchBodyStmts, sourceFile);
    catchEnd = cases.length - 1;

    if (hasFinally) {
      activeTryFinallyStack.pop();
    }
  } else {
    // No catch — pop finally context
    if (hasFinally) {
      activeTryFinallyStack.pop();
    }
  }

  if (hasFinally) {
    finallyStart = newPhase();
    finallyStartPlaceholder.finallyStart = finallyStart;

    // Patch any deferred jumps that were waiting for finallyStart
    for (const { stmts, index } of finallyStartPlaceholder.deferredJumps) {
      stmts[index] = f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.EqualsToken,
          f.createNumericLiteral(finallyStart),
        ),
      );
      // stmts[index + 1] is already a ContinueStatement placeholder — keep it
    }

    // Explode finally body
    const finallyStmts = [...stmt.finallyBlock!.statements];
    explodeStatements(finallyStmts, sourceFile);
    finallyEnd = cases.length - 1;
  }

  const realAfterPhase = newPhase();

  // Now fix up jumps:

  // End of try body → jump to finally or after
  const lastTryCase =
    cases[hasCatch ? catchStart! - 1 : hasFinally ? finallyStart! - 1 : realAfterPhase - 1];
  if (!endsWithReturnOrContinue(lastTryCase.stmts)) {
    if (hasFinally) {
      // Normal completion → set _completion = normal, goto finally
      lastTryCase.stmts.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("_completion"),
            ts.SyntaxKind.EqualsToken,
            f.createObjectLiteralExpression([
              f.createPropertyAssignment("type", f.createStringLiteral("normal")),
            ]),
          ),
        ),
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(finallyStart!),
          ),
        ),
        f.createContinueStatement(),
      );
    } else {
      // No finally → jump to after (skip catch)
      lastTryCase.stmts.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(realAfterPhase),
          ),
        ),
        f.createContinueStatement(),
      );
    }
  }

  // End of catch body → jump to finally or after
  if (hasCatch) {
    const lastCatchCase = cases[hasFinally ? finallyStart! - 1 : realAfterPhase - 1];
    if (!endsWithReturnOrContinue(lastCatchCase.stmts)) {
      if (hasFinally) {
        lastCatchCase.stmts.push(
          f.createExpressionStatement(
            f.createBinaryExpression(
              stateAccess("_completion"),
              ts.SyntaxKind.EqualsToken,
              f.createObjectLiteralExpression([
                f.createPropertyAssignment("type", f.createStringLiteral("normal")),
              ]),
            ),
          ),
          f.createExpressionStatement(
            f.createBinaryExpression(
              stateAccess("phase"),
              ts.SyntaxKind.EqualsToken,
              f.createNumericLiteral(finallyStart!),
            ),
          ),
          f.createContinueStatement(),
        );
      } else {
        lastCatchCase.stmts.push(
          f.createExpressionStatement(
            f.createBinaryExpression(
              stateAccess("phase"),
              ts.SyntaxKind.EqualsToken,
              f.createNumericLiteral(realAfterPhase),
            ),
          ),
          f.createContinueStatement(),
        );
      }
    }
  }

  // End of finally → completion replay
  if (hasFinally) {
    const lastFinallyCase = cases[realAfterPhase - 1];
    if (!endsWithReturnOrContinue(lastFinallyCase.stmts)) {
      // if (state._completion.type === "throw") throw state._completion.value;
      lastFinallyCase.stmts.push(
        f.createIfStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(stateAccess("_completion"), "type"),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createStringLiteral("throw"),
          ),
          f.createBlock([
            f.createThrowStatement(
              f.createPropertyAccessExpression(stateAccess("_completion"), "value"),
            ),
          ]),
        ),
      );
      // if (state._completion.type === "return") return state._completion.value;
      lastFinallyCase.stmts.push(
        f.createIfStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(stateAccess("_completion"), "type"),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createStringLiteral("return"),
          ),
          f.createBlock([
            f.createReturnStatement(
              f.createPropertyAccessExpression(stateAccess("_completion"), "value"),
            ),
          ]),
        ),
      );
      // if (state._completion.type === "break") { state.phase = state._completion.value; continue; }
      lastFinallyCase.stmts.push(
        f.createIfStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(stateAccess("_completion"), "type"),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createStringLiteral("break"),
          ),
          f.createBlock([
            f.createExpressionStatement(
              f.createBinaryExpression(
                stateAccess("phase"),
                ts.SyntaxKind.EqualsToken,
                f.createPropertyAccessExpression(
                  stateAccess("_completion"),
                  "value",
                ) as ts.Expression,
              ),
            ),
            f.createContinueStatement(),
          ]),
        ),
      );
      // if (state._completion.type === "continue") { state.phase = state._completion.value; continue; }
      lastFinallyCase.stmts.push(
        f.createIfStatement(
          f.createBinaryExpression(
            f.createPropertyAccessExpression(stateAccess("_completion"), "type"),
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            f.createStringLiteral("continue"),
          ),
          f.createBlock([
            f.createExpressionStatement(
              f.createBinaryExpression(
                stateAccess("phase"),
                ts.SyntaxKind.EqualsToken,
                f.createPropertyAccessExpression(
                  stateAccess("_completion"),
                  "value",
                ) as ts.Expression,
              ),
            ),
            f.createContinueStatement(),
          ]),
        ),
      );
      // normal → fall through to afterPhase
      lastFinallyCase.stmts.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(realAfterPhase),
          ),
        ),
        f.createContinueStatement(),
      );
    }
  }

  // Record the try entry
  tryEntries.push({
    tryStart,
    tryEnd,
    catchStart,
    catchEnd,
    finallyStart,
    finallyEnd,
    afterPhase: realAfterPhase,
  });
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
export function generateStepFunction(
  exploded: { cases: Case[]; tryEntries: TryEntry[] },
  _hoistedNames: string[],
): string {
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

  const hasTryEntries = exploded.tryEntries.length > 0;

  let loopBody: ts.Statement;
  if (hasTryEntries) {
    // Wrap switch in try/catch with dispatch logic
    const catchClauseBody = buildCatchDispatch(exploded.tryEntries);
    const tryCatchStmt = f.createTryStatement(
      f.createBlock([switchStmt]),
      f.createCatchClause(f.createVariableDeclaration("_e"), f.createBlock(catchClauseBody)),
      undefined,
    );
    loopBody = f.createBlock([tryCatchStmt]);
  } else {
    loopBody = f.createBlock([switchStmt]);
  }

  let whileLoop: ts.WhileStatement;
  if (hasTryEntries) {
    // Labeled loop: _loop: while (true) { ... }
    whileLoop = f.createWhileStatement(f.createTrue(), loopBody);
  } else {
    whileLoop = f.createWhileStatement(f.createTrue(), loopBody);
  }

  const bodyStatements: ts.Statement[] = [];

  if (hasTryEntries) {
    // Emit _tries array
    const triesArrayLiteral = f.createArrayLiteralExpression(
      exploded.tryEntries.map((entry) =>
        f.createArrayLiteralExpression([
          f.createNumericLiteral(entry.tryStart),
          f.createNumericLiteral(entry.tryEnd),
          entry.catchStart !== null ? f.createNumericLiteral(entry.catchStart) : f.createNull(),
          entry.catchEnd !== null ? f.createNumericLiteral(entry.catchEnd) : f.createNull(),
          entry.finallyStart !== null ? f.createNumericLiteral(entry.finallyStart) : f.createNull(),
          entry.finallyEnd !== null ? f.createNumericLiteral(entry.finallyEnd) : f.createNull(),
          f.createNumericLiteral(entry.afterPhase),
        ]),
      ),
    );

    bodyStatements.push(
      f.createVariableStatement(
        undefined,
        f.createVariableDeclarationList(
          [f.createVariableDeclaration("_tries", undefined, undefined, triesArrayLiteral)],
          ts.NodeFlags.Const,
        ),
      ),
    );

    // Labeled while loop
    const labeledLoop = f.createLabeledStatement("_loop", whileLoop);
    bodyStatements.push(labeledLoop);
  } else {
    bodyStatements.push(whileLoop);
  }

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
    f.createBlock(bodyStatements),
  );

  return printer.printNode(ts.EmitHint.Unspecified, stepFn, src);
}

/** Build the catch dispatch logic for the generated catch block */
function buildCatchDispatch(entries: TryEntry[]): ts.Statement[] {
  // for (let _i = _tries.length - 1; _i >= 0; _i--) { ... }
  // But since we know entries at compile time, unroll into if/else chain

  const stmts: ts.Statement[] = [];

  // Iterate entries in order (inner first, since inner entries are pushed first)
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    // Error in try body → route to catch (or finally if no catch)
    const tryRangeCheck = f.createBinaryExpression(
      f.createBinaryExpression(
        stateAccess("phase"),
        ts.SyntaxKind.GreaterThanEqualsToken,
        f.createNumericLiteral(entry.tryStart),
      ),
      ts.SyntaxKind.AmpersandAmpersandToken,
      f.createBinaryExpression(
        stateAccess("phase"),
        ts.SyntaxKind.LessThanEqualsToken,
        f.createNumericLiteral(entry.tryEnd),
      ),
    );

    const tryBody: ts.Statement[] = [];
    tryBody.push(
      f.createExpressionStatement(
        f.createBinaryExpression(
          stateAccess("_error"),
          ts.SyntaxKind.EqualsToken,
          f.createIdentifier("_e"),
        ),
      ),
    );

    if (entry.catchStart !== null) {
      tryBody.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(entry.catchStart),
          ),
        ),
        f.createContinueStatement(f.createIdentifier("_loop")),
      );
    } else if (entry.finallyStart !== null) {
      tryBody.push(
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("_completion"),
            ts.SyntaxKind.EqualsToken,
            f.createObjectLiteralExpression([
              f.createPropertyAssignment("type", f.createStringLiteral("throw")),
              f.createPropertyAssignment("value", f.createIdentifier("_e")),
            ]),
          ),
        ),
        f.createExpressionStatement(
          f.createBinaryExpression(
            stateAccess("phase"),
            ts.SyntaxKind.EqualsToken,
            f.createNumericLiteral(entry.finallyStart),
          ),
        ),
        f.createContinueStatement(f.createIdentifier("_loop")),
      );
    }

    stmts.push(f.createIfStatement(tryRangeCheck, f.createBlock(tryBody)));

    // Error in catch body → route to finally (or propagate)
    if (entry.catchStart !== null && entry.catchEnd !== null) {
      const catchRangeCheck = f.createBinaryExpression(
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.GreaterThanEqualsToken,
          f.createNumericLiteral(entry.catchStart),
        ),
        ts.SyntaxKind.AmpersandAmpersandToken,
        f.createBinaryExpression(
          stateAccess("phase"),
          ts.SyntaxKind.LessThanEqualsToken,
          f.createNumericLiteral(entry.catchEnd),
        ),
      );

      if (entry.finallyStart !== null) {
        const catchBody: ts.Statement[] = [
          f.createExpressionStatement(
            f.createBinaryExpression(
              stateAccess("_completion"),
              ts.SyntaxKind.EqualsToken,
              f.createObjectLiteralExpression([
                f.createPropertyAssignment("type", f.createStringLiteral("throw")),
                f.createPropertyAssignment("value", f.createIdentifier("_e")),
              ]),
            ),
          ),
          f.createExpressionStatement(
            f.createBinaryExpression(
              stateAccess("phase"),
              ts.SyntaxKind.EqualsToken,
              f.createNumericLiteral(entry.finallyStart),
            ),
          ),
          f.createContinueStatement(f.createIdentifier("_loop")),
        ];
        stmts.push(f.createIfStatement(catchRangeCheck, f.createBlock(catchBody)));
      }
      // If no finally, error in catch propagates — don't add handler, let it fall through to throw
    }
  }

  // If no handler matched, re-throw
  stmts.push(f.createThrowStatement(f.createIdentifier("_e")));

  return stmts;
}
