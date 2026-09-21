export function disposeGameRuntime(parts: readonly ({ dispose(): void } | null | undefined)[]): void {
  for (const part of parts) part?.dispose();
}

export function clearGameRuntime(target: object, fields: readonly string[]): void {
  for (const field of fields) Reflect.set(target, field, null);
}

export function disposeGameOwnedResources(
  options: Readonly<{
    disposable: readonly ({ dispose(): void } | null | undefined)[];
    destroyable: readonly ({ destroy(): void } | null | undefined)[];
    clear(): void;
    target: object;
    fields: readonly string[];
  }>,
): void {
  disposeGameRuntime(options.disposable);
  for (const part of options.destroyable) part?.destroy();
  options.clear();
  clearGameRuntime(options.target, options.fields);
}
