import type { KernelValue } from './contracts';

/** Copy the neutral wire value even when a codec legally returns its input object. */
export function cloneKernelValue(value: KernelValue): KernelValue {
  const ancestors = new Set<object>();
  const copy = (current: KernelValue, depth: number): KernelValue => {
    if (depth > 128) throw new TypeError('Kernel value exceeds the nesting limit.');
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return current;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (typeof current !== 'object') throw new TypeError('Kernel value must contain finite neutral data.');
    if (ancestors.has(current)) throw new TypeError('Kernel value must not contain cycles.');
    ancestors.add(current);
    try {
      if (Array.isArray(current)) return Array.from(current, (entry: KernelValue) => copy(entry, depth + 1));
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== null && prototype !== Object.prototype)
        throw new TypeError('Kernel records must be plain data.');
      return Object.fromEntries(Object.entries(current).map(([key, entry]) => [key, copy(entry, depth + 1)]));
    } finally {
      ancestors.delete(current);
    }
  };
  return copy(value, 0);
}
