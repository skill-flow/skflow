import ts from "typescript";

/**
 * Rewrite all references to hoisted variable names from `x` to `state.x`.
 * Skips property access names (obj.x stays obj.x) and declaration names.
 */
export function rewriteVariableRefs(
  stmts: ts.Statement[],
  hoistedNames: Set<string>,
): ts.Statement[] {
  const visitor = (node: ts.Node): ts.Node => {
    // Skip identifiers that are property names in property access (e.g., obj.x → don't rewrite x)
    if (ts.isPropertyAccessExpression(node)) {
      const newExpr = ts.visitNode(node.expression, visitor) as ts.Expression;
      // Keep the .name part as-is (don't rewrite property names)
      if (newExpr !== node.expression) {
        return ts.factory.updatePropertyAccessExpression(node, newExpr, node.name);
      }
      return node;
    }

    // Shorthand property { x } → { x: state.x }
    if (ts.isShorthandPropertyAssignment(node) && hoistedNames.has(node.name.text)) {
      return ts.factory.createPropertyAssignment(
        node.name.text,
        ts.factory.createPropertyAccessExpression(
          ts.factory.createIdentifier("state"),
          node.name.text,
        ),
      );
    }

    // Regular property assignment { key: value } → only rewrite value, leave key as-is
    if (ts.isPropertyAssignment(node)) {
      const newInit = ts.visitNode(node.initializer, visitor) as ts.Expression;
      if (newInit !== node.initializer) {
        return ts.factory.updatePropertyAssignment(node, node.name, newInit);
      }
      return node;
    }

    // Rewrite standalone identifier references to hoisted vars
    if (ts.isIdentifier(node) && hoistedNames.has(node.text)) {
      return ts.factory.createPropertyAccessExpression(
        ts.factory.createIdentifier("state"),
        node.text,
      );
    }

    return ts.visitEachChild(node, visitor, undefined);
  };

  return stmts.map((stmt) => ts.visitNode(stmt, visitor) as ts.Statement);
}
