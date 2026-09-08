export interface CiChangeScope {
  runFull: boolean;
  reason:
    | 'classifier-bootstrap'
    | 'docs-only'
    | 'invalid-input'
    | 'main-push'
    | 'no-changes'
    | 'non-documentation'
    | 'unsupported-event';
}

export function isDocumentationOnlyPath(path: string): boolean;
export function classifyChangedPaths(paths: readonly string[]): CiChangeScope;
export function selectCiScope(eventName: string, paths: readonly string[]): CiChangeScope;
export function parseNulSeparatedPaths(input: Buffer | string): string[];
