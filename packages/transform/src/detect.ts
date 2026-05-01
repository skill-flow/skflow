import ts from "typescript";

const YIELD_FUNCTIONS = new Set(["sh", "ask", "askUser"]);

/** Check if an expression is `await sh(...)`, `await ask(...)`, or `await askUser(...)` */
export function isYieldCall(node: ts.Node): node is ts.AwaitExpression {
  if (!ts.isAwaitExpression(node)) return false;
  const inner = node.expression;
  if (!ts.isCallExpression(inner)) return false;
  if (!ts.isIdentifier(inner.expression)) return false;
  return YIELD_FUNCTIONS.has(inner.expression.text);
}

/** Get the function name from an await yield call */
export function getYieldFnName(node: ts.AwaitExpression): string {
  const call = node.expression as ts.CallExpression;
  return (call.expression as ts.Identifier).text;
}

/** Check if a node is `return done(...)` */
export function isDoneReturn(node: ts.Node): node is ts.ReturnStatement {
  if (!ts.isReturnStatement(node)) return false;
  if (!node.expression || !ts.isCallExpression(node.expression)) return false;
  if (!ts.isIdentifier(node.expression.expression)) return false;
  return node.expression.expression.text === "done";
}

/** Check if a statement or its children contain any yield calls or done() calls */
export function containsYield(node: ts.Node): boolean {
  if (isYieldCall(node)) return true;
  if (isDoneReturn(node)) return true;

  let found = false;
  node.forEachChild((child) => {
    if (found) return;
    // Don't descend into nested functions
    if (
      ts.isFunctionExpression(child) ||
      ts.isArrowFunction(child) ||
      ts.isFunctionDeclaration(child)
    )
      return;
    if (containsYield(child)) found = true;
  });
  return found;
}

/** Detect `// @skflow sh-throws` pragma in top-level comments */
export function detectShThrowsPragma(sourceFile: ts.SourceFile): boolean {
  const fullText = sourceFile.getFullText();
  // Scan top-level comments (before and between statements)
  for (const stmt of sourceFile.statements) {
    const leadingRanges = ts.getLeadingCommentRanges(fullText, stmt.getFullStart());
    if (leadingRanges) {
      for (const range of leadingRanges) {
        const text = fullText.slice(range.pos, range.end);
        if (text.includes("@skflow sh-throws")) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Determine if a sh() call should throw on non-zero exit based on options and pragma */
export function isThrowingSh(callExpr: ts.CallExpression, pragma: boolean): boolean {
  // Check second argument for { throws: true/false }
  const optsArg = callExpr.arguments[1];
  if (optsArg && ts.isObjectLiteralExpression(optsArg)) {
    for (const prop of optsArg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === "throws"
      ) {
        if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) return true;
        if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) return false;
      }
    }
  }
  // No explicit throws option — use pragma default
  return pragma;
}

/** Check if a yield call is inside a nested function (not allowed) */
export function findYieldInNestedFunction(node: ts.Node, inNested = false): string | null {
  if (inNested && isYieldCall(node)) {
    return `yield (${getYieldFnName(node)}) must be at the top level of main(), not inside nested functions`;
  }

  let result: string | null = null;
  node.forEachChild((child) => {
    if (result) return;
    const isNested =
      ts.isFunctionExpression(child) ||
      ts.isArrowFunction(child) ||
      ts.isFunctionDeclaration(child);
    result = findYieldInNestedFunction(child, inNested || isNested);
  });
  return result;
}
