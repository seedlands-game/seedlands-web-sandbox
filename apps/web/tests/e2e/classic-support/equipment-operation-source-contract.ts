import ts from 'typescript';

export function awaitedEquipmentOperationOffset(source: string, phase: string, operation: string): number {
  const file = ts.createSourceFile('placement.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let offset = -1;
  const normalized = (text: string) => text.replace(/\s/g, '');
  const visit = (node: ts.Node): void => {
    if (ts.isAwaitExpression(node) && ts.isCallExpression(node.expression)) {
      const call = node.expression;
      const [label, target, callback] = call.arguments;
      if (
        call.expression.getText(file) === 'observeEquipmentOperation' &&
        call.arguments.length === 3 &&
        label &&
        ts.isStringLiteral(label) &&
        label.text === phase &&
        target?.getText(file) === 'resource.target' &&
        callback &&
        ts.isArrowFunction(callback) &&
        callback.parameters.length === 0 &&
        ts.isCallExpression(callback.body) &&
        normalized(callback.body.getText(file)) === normalized(operation)
      )
        offset = node.getStart(file);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return offset;
}
