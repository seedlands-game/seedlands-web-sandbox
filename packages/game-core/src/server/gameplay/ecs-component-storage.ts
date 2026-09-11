type ComponentColumn = { [index: number]: unknown };

export function clearComponentSlot(eid: number, columns: readonly ComponentColumn[]): void {
  for (const column of columns) delete column[eid];
}
