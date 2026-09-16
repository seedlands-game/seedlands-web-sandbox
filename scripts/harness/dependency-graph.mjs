import { posix } from 'node:path';
import ts from 'typescript';

export function pathMatches(path, pattern) {
  let expression = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') {
        expression += '(?:.*/)?';
        index++;
      } else expression += '.*';
    } else if (char === '*') expression += '[^/]*';
    else expression += /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
  }
  return new RegExp(`^${expression}$`).test(path);
}

export function ownersFor(path, registry) {
  return registry.owners
    .filter((owner) => owner.paths.some((pattern) => pathMatches(path, pattern)))
    .map((owner) => owner.id);
}

function exportsTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  // Differing condition branches cannot be represented as a single resolved edge.
  // Preserve fail-closed selection instead of trusting types while missing runtime.
  const targets = Object.values(value).map(exportsTarget);
  if (targets.some((target) => !target)) return null;
  const unique = [...new Set(targets)];
  return unique.length === 1 ? unique[0] : null;
}

function packagesFor(files) {
  const packages = new Map();
  for (const [path, text] of Object.entries(files)) {
    if (!path.endsWith('/package.json') || !/^(packages|apps|playbooks)\//.test(path)) continue;
    try {
      const value = JSON.parse(text);
      if (typeof value.name === 'string') packages.set(value.name, { root: posix.dirname(path), ...value });
    } catch {
      /* Registry/configuration validation reports malformed package manifests. */
    }
  }
  return packages;
}

function resolveImport(from, name, files, packages) {
  let path;
  if (name.startsWith('.')) path = posix.normalize(posix.join(posix.dirname(from), name));
  else if (name.startsWith('/')) path = name.slice(1);
  else {
    const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
    const manifest = packages.get(packageName);
    if (!manifest) return name.startsWith('@seedlands/') || name.startsWith('#') ? { unresolved: name } : null;
    const subpath = name === packageName ? '.' : `.${name.slice(packageName.length)}`;
    let target = exportsTarget(manifest.exports?.[subpath] ?? (subpath === '.' ? manifest.exports : null));
    if (!target && manifest.exports && typeof manifest.exports === 'object') {
      for (const [pattern, value] of Object.entries(manifest.exports)) {
        if (!pattern.includes('*')) continue;
        const [prefix, suffix] = pattern.split('*');
        if (subpath.startsWith(prefix) && subpath.endsWith(suffix)) {
          const candidate = exportsTarget(value);
          if (candidate)
            target = candidate.replace('*', subpath.slice(prefix.length, suffix ? -suffix.length : undefined));
        }
      }
    }
    if (!target) return { unresolved: name };
    path = posix.normalize(posix.join(manifest.root, target));
  }
  const candidate = [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    `${path}.mjs`,
    `${path}.js`,
    `${path}/index.ts`,
    path.replace(/\.js$/, '.ts'),
  ].find((entry) => Object.hasOwn(files, entry));
  return candidate ? { path: candidate } : { unresolved: name };
}

function locallyBoundRequire(node) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (ts.isBlock(scope) || ts.isSourceFile(scope)) {
      if (
        scope.statements.some(
          (statement) =>
            (ts.isVariableStatement(statement) &&
              statement.declarationList.declarations.some(
                (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'require',
              )) ||
            (ts.isFunctionDeclaration(statement) && statement.name?.text === 'require'),
        )
      )
        return true;
    }
    if (
      ts.isFunctionLike(scope) &&
      scope.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === 'require')
    )
      return true;
  }
  return false;
}

export function dependencyGraph(snapshot) {
  const dependencies = new Map(snapshot.registry.owners.map((owner) => [owner.id, new Set()]));
  const uncertain = new Set();
  const unresolved = [];
  const packages = packagesFor(snapshot.files);
  for (const owner of snapshot.registry.owners) {
    for (const dependency of owner.dependencies ?? []) dependencies.get(owner.id).add(dependency.owner);
  }
  for (const [path, contents] of Object.entries(snapshot.files)) {
    if (!/\.(?:[cm]?[jt]sx?|svelte)$/.test(path)) continue;
    const sourceOwners = ownersFor(path, snapshot.registry).filter(
      (id) => !snapshot.registry.owners.find((owner) => owner.id === id)?.documentation,
    );
    if (!sourceOwners.length) continue;
    const scripts = path.endsWith('.svelte')
      ? [...contents.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]).join('\n')
      : contents;
    const source = ts.createSourceFile(path, scripts, ts.ScriptTarget.Latest, true);
    const hasDeclaredDynamicBoundary = sourceOwners.every((id) => {
      const owner = snapshot.registry.owners.find((entry) => entry.id === id);
      return owner.dynamicPaths?.some((pattern) => pathMatches(path, pattern));
    });
    function visit(node) {
      let specifier;
      let dynamic = false;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal;
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require' && !locallyBoundRequire(node)))
      ) {
        specifier = node.arguments[0];
        dynamic = true;
        if (
          specifier &&
          ts.isPropertyAccessExpression(specifier) &&
          specifier.name.text === 'href' &&
          ts.isNewExpression(specifier.expression) &&
          ts.isIdentifier(specifier.expression.expression) &&
          specifier.expression.expression.text === 'URL' &&
          specifier.expression.arguments?.[1]?.getText(source) === 'import.meta.url'
        )
          specifier = specifier.expression.arguments[0];
      } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL') {
        specifier = node.arguments?.[0];
        // URL directory anchors are not module loads or individual asset reads.
        if (specifier && ts.isStringLiteralLike(specifier) && /(?:^\.{1,2}$|\/$|\/\.{1,2}$)/.test(specifier.text))
          specifier = undefined;
      }
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const resolved = resolveImport(path, specifier.text, snapshot.files, packages);
        if (resolved?.unresolved) {
          sourceOwners.forEach((id) => uncertain.add(id));
          unresolved.push({ path, specifier: specifier.text, reason: 'unresolved-import' });
        } else if (resolved?.path) {
          const targets = ownersFor(resolved.path, snapshot.registry);
          if (!targets.length) {
            sourceOwners.forEach((id) => uncertain.add(id));
            unresolved.push({ path, specifier: specifier.text, reason: 'missing-owner' });
          }
          for (const from of sourceOwners) for (const to of targets) if (from !== to) dependencies.get(from).add(to);
        }
      } else if (dynamic && !hasDeclaredDynamicBoundary) {
        sourceOwners.forEach((id) => uncertain.add(id));
        unresolved.push({ path, specifier: specifier?.getText(source) ?? '', reason: 'non-literal-import' });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return { dependencies, uncertain, unresolved };
}
