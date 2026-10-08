let sequence = 0;
const prefix = 'seedlands:world-start:';

/** Native diagnostic timing; startup decisions and readiness predicates do not depend on these marks. */
export function beginWorldStartMarks() {
  for (const mark of performance.getEntriesByType('mark'))
    if (mark.name.startsWith(prefix)) performance.clearMarks(mark.name);
  const id = ++sequence;
  return async <T>(phase: string, operation: () => Promise<T>): Promise<T> => {
    performance.mark(`${prefix}${id}:${phase}`);
    const result = await operation();
    performance.mark(`${prefix}${id}:${phase}:complete`);
    return result;
  };
}
