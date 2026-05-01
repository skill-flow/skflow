import ts from "typescript";

function deepCloneNode<T extends ts.Node>(node: T): T {
  const visitor = (n: ts.Node): ts.Node => {
    const visited = ts.visitEachChild(n, visitor, undefined);
    return ts.setTextRange(visited, { pos: -1, end: -1 });
  };
  return ts.setTextRange(ts.visitEachChild(node, visitor, undefined), { pos: -1, end: -1 }) as T;
}

export interface HoistedVar {
  name: string;
  initializer?: ts.Expression;
}

/**
 * Collect all variable declarations in the function body and return:
 * 1. The list of hoisted variable names
 * 2. A new body with declarations replaced by assignments to state.X
 */
export function hoistVariables(
  body: ts.Statement[],
  factory: ts.NodeFactory,
): { hoisted: HoistedVar[]; statements: ts.Statement[] } {
  const hoisted: HoistedVar[] = [];
  const statements: ts.Statement[] = [];

  for (const stmt of body) {
    const result = visitStatement(stmt, hoisted, factory);
    statements.push(...result);
  }

  return { hoisted, statements };
}

function visitStatement(
  stmt: ts.Statement,
  hoisted: HoistedVar[],
  factory: ts.NodeFactory,
): ts.Statement[] {
  if (ts.isVariableStatement(stmt)) {
    return hoistVariableStatement(stmt, hoisted, factory);
  }

  if (ts.isIfStatement(stmt)) {
    const thenStmts = flattenBlock(stmt.thenStatement);
    const newThen = thenStmts.flatMap((s) => visitStatement(s, hoisted, factory));
    const newElse = stmt.elseStatement
      ? rebuildElse(stmt.elseStatement, hoisted, factory)
      : undefined;

    return [
      factory.updateIfStatement(stmt, stmt.expression, factory.createBlock(newThen), newElse),
    ];
  }

  if (ts.isWhileStatement(stmt)) {
    const bodyStmts = flattenBlock(stmt.statement);
    const newBody = bodyStmts.flatMap((s) => visitStatement(s, hoisted, factory));
    return [factory.updateWhileStatement(stmt, stmt.expression, factory.createBlock(newBody))];
  }

  if (ts.isForStatement(stmt)) {
    let newInit = stmt.initializer;
    if (newInit && ts.isVariableDeclarationList(newInit)) {
      const exprs: ts.Expression[] = [];
      for (const decl of newInit.declarations) {
        if (ts.isIdentifier(decl.name)) {
          hoisted.push({ name: decl.name.text });
          if (decl.initializer) {
            exprs.push(
              factory.createBinaryExpression(
                factory.createPropertyAccessExpression(
                  factory.createIdentifier("state"),
                  decl.name.text,
                ),
                ts.SyntaxKind.EqualsToken,
                decl.initializer,
              ),
            );
          }
        }
      }
      newInit =
        exprs.length > 0
          ? exprs.length === 1
            ? exprs[0]
            : factory.createCommaListExpression(exprs)
          : undefined;
    }
    const bodyStmts = flattenBlock(stmt.statement);
    const newBody = bodyStmts.flatMap((s) => visitStatement(s, hoisted, factory));
    return [
      factory.updateForStatement(
        stmt,
        newInit,
        stmt.condition,
        stmt.incrementor,
        factory.createBlock(newBody),
      ),
    ];
  }

  if (ts.isTryStatement(stmt)) {
    const tryStmts = flattenBlock(stmt.tryBlock).flatMap((s) =>
      visitStatement(s, hoisted, factory),
    );
    const newTryBlock = factory.updateBlock(stmt.tryBlock, tryStmts);

    let newCatchClause = stmt.catchClause;
    if (stmt.catchClause) {
      // Hoist the catch parameter variable (e.g., `catch (e)` → e becomes state.e)
      const catchParam = stmt.catchClause.variableDeclaration;
      if (catchParam && ts.isIdentifier(catchParam.name)) {
        hoisted.push({ name: catchParam.name.text });
      }

      const catchStmts = flattenBlock(stmt.catchClause.block).flatMap((s) =>
        visitStatement(s, hoisted, factory),
      );
      const newCatchBlock = factory.updateBlock(stmt.catchClause.block, catchStmts);
      newCatchClause = factory.updateCatchClause(
        stmt.catchClause,
        stmt.catchClause.variableDeclaration,
        newCatchBlock,
      );
    }

    let newFinallyBlock = stmt.finallyBlock;
    if (stmt.finallyBlock) {
      const finallyStmts = flattenBlock(stmt.finallyBlock).flatMap((s) =>
        visitStatement(s, hoisted, factory),
      );
      newFinallyBlock = factory.updateBlock(stmt.finallyBlock, finallyStmts);
    }

    return [factory.updateTryStatement(stmt, newTryBlock, newCatchClause, newFinallyBlock)];
  }

  if (ts.isBlock(stmt)) {
    const inner = stmt.statements.map((s) => visitStatement(s, hoisted, factory)).flat();
    return [factory.updateBlock(stmt, inner)];
  }

  return [stmt];
}

function rebuildElse(
  elseStmt: ts.Statement,
  hoisted: HoistedVar[],
  factory: ts.NodeFactory,
): ts.Statement {
  if (ts.isIfStatement(elseStmt)) {
    const [rebuilt] = visitStatement(elseStmt, hoisted, factory);
    return rebuilt;
  }
  const stmts = flattenBlock(elseStmt);
  const newStmts = stmts.flatMap((s) => visitStatement(s, hoisted, factory));
  return factory.createBlock(newStmts);
}

function hoistVariableStatement(
  stmt: ts.VariableStatement,
  hoisted: HoistedVar[],
  factory: ts.NodeFactory,
): ts.Statement[] {
  const result: ts.Statement[] = [];

  for (const decl of stmt.declarationList.declarations) {
    if (!ts.isIdentifier(decl.name)) continue;

    const name = decl.name.text;
    hoisted.push({ name, initializer: decl.initializer });

    if (decl.initializer) {
      // Replace: const x = expr  →  state.x = expr
      // Deep clone to detach all nested nodes from original source positions
      const init = deepCloneNode(decl.initializer);
      const exprStmt = factory.createExpressionStatement(
        factory.createBinaryExpression(
          factory.createPropertyAccessExpression(factory.createIdentifier("state"), name),
          ts.SyntaxKind.EqualsToken,
          init,
        ),
      );
      // Preserve original statement position for source map lookups
      ts.setTextRange(exprStmt, stmt);
      result.push(exprStmt);
    }
  }

  return result;
}

function flattenBlock(stmt: ts.Statement): ts.Statement[] {
  if (ts.isBlock(stmt)) {
    return [...stmt.statements];
  }
  return [stmt];
}
