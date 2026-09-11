/**
 * 参考 DTO 的整数域只有数学零；浮点字段不得调用此函数。
 * `value === 0` 同时匹配 JavaScript 的 `0` 与 `-0`。
 */
export const canonicalReferenceInteger = (value: number): number => (value === 0 ? 0 : value);
