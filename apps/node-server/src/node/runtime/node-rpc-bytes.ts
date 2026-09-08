import { Buffer } from 'node:buffer';

const U32_BYTES = 4;
const NUMBER_BYTES = 8;

function textBytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/**
 * 计量跨 isolate 后不变的 DTO 内容字节，避免 V8 引用表和对象布局使同一 payload 在两端得到不同长度。
 * 协议 DTO 不允许循环或共享对象引用；TypedArray 只计实际 view 字节，不把宿主实现元数据计入预算。
 */
export function measureNodeRpcBytes(value: unknown): number {
  const visited = new WeakSet<object>();
  const visit = (candidate: unknown): number => {
    if (candidate === null) return 1;
    if (candidate === undefined) return 1;
    if (typeof candidate === 'boolean') return 1;
    if (typeof candidate === 'number') {
      if (!Number.isFinite(candidate)) throw new TypeError('Node RPC DTO 不能包含非有限数字。');
      return 1 + NUMBER_BYTES;
    }
    if (typeof candidate === 'bigint') return 1 + U32_BYTES + textBytes(candidate.toString(10));
    if (typeof candidate === 'string') return 1 + U32_BYTES + textBytes(candidate);
    if (typeof candidate === 'symbol' || typeof candidate === 'function')
      throw new TypeError('Node RPC DTO 包含不可传输值。');
    if (typeof candidate !== 'object') throw new TypeError('Node RPC DTO 类型不受支持。');
    if (visited.has(candidate)) throw new TypeError('Node RPC DTO 不能包含循环或共享对象引用。');
    visited.add(candidate);
    if (candidate instanceof ArrayBuffer) return 1 + U32_BYTES + candidate.byteLength;
    if (ArrayBuffer.isView(candidate)) return 1 + U32_BYTES + candidate.byteLength;
    if (Array.isArray(candidate)) return 1 + U32_BYTES + candidate.reduce((total, entry) => total + visit(entry), 0);
    const prototype = Object.getPrototypeOf(candidate);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Node RPC DTO 必须是普通对象。');
    const keys = Object.keys(candidate as Record<string, unknown>).sort();
    return (
      1 +
      U32_BYTES +
      keys.reduce(
        (total, key) => total + U32_BYTES + textBytes(key) + visit((candidate as Record<string, unknown>)[key]),
        0,
      )
    );
  };
  const bytes = visit(value);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new RangeError('Node RPC DTO 字节计量溢出。');
  return bytes;
}
