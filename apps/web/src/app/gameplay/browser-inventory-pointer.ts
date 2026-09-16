import type {
  AuthorityAction,
  AuthorityActionResult,
  AuthorityGameplayView,
  AuthorityStationView,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import type { InventoryUiCommand } from '../ui/inventory-pointer-gestures';

type Options = {
  view: () => Pick<AuthorityGameplayView, 'inventory'> & Partial<Pick<AuthorityGameplayView, 'nearbyStations'>>;
  station: () => AuthorityStationView | null;
  perform: (action: AuthorityAction) => Promise<Pick<AuthorityActionResult, 'result'>>;
  changed: () => void;
  refresh?: () => void;
  failed: (message: string) => void;
  succeeded: (message: string) => void;
};

/** Each queued intention uses a fresh revision but remains bound to its original actor/container. */
export class BrowserInventoryPointer {
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private readonly options: Options) {}

  send(command: InventoryUiCommand): Promise<boolean> {
    const actor = this.options.view().inventory.actor;
    const stationIdentity = this.options.station()?.reference;
    const perform = async () => {
      let omitStation = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (this.disposed) return false;
        const view = this.options.view();
        const inventory = view.inventory;
        if (JSON.stringify(actor) !== JSON.stringify(inventory.actor)) return false;
        let station = this.options.station();
        if (command.kind === 'close') {
          const origin = inventory.cursor.origin;
          station =
            origin?.kind === 'station' && !omitStation
              ? ((view.nearbyStations ?? (station ? [station] : [])).find(
                  (entry) => JSON.stringify(entry.reference) === JSON.stringify(origin.reference),
                ) ?? null)
              : null;
        } else if (JSON.stringify(stationIdentity) !== JSON.stringify(station?.reference)) {
          this.options.failed('工位已关闭或不可达，物品已保留');
          return false;
        }
        try {
          const response = await this.options.perform({
            type: 'inventory-pointer',
            actor,
            expectedInventoryRevision: inventory.revision,
            ...(station
              ? { station: { reference: station.reference, expectedRevision: station.component.revision } }
              : {}),
            command:
              command.kind === 'distribute'
                ? { kind: 'distribute', targets: command.slots, button: command.button }
                : command,
          });
          const result = response.result;
          const ok = Boolean(result && typeof result === 'object' && 'success' in result && result.success === true);
          if (ok) {
            this.options.changed();
            return true;
          }
          const reason =
            result && typeof result === 'object' && 'reason' in result && typeof result.reason === 'string'
              ? result.reason
              : '';
          if (command.kind === 'close' && attempt === 0) {
            // Only idempotent settlement may rebase once after a rejected transaction.
            omitStation = /stale-station-reference|out-of-range|blocked|chunk-unavailable|station-voxel-mismatch/.test(
              reason,
            );
            if (omitStation || /stale-inventory-revision|stale-station-revision|Prepared .* stale/.test(reason))
              continue;
          }
          this.options.failed('操作未完成：槽位已变化、材料不匹配或空间不足；物品已保留');
          return false;
        } catch (error) {
          this.options.failed(error instanceof Error ? error.message : '库存操作失败，物品已保留');
          return false;
        } finally {
          this.options.refresh?.();
        }
      }
      return false;
    };
    const next = this.queue.then(perform);
    this.queue = next;
    return next;
  }

  craft(recipeId: string): Promise<boolean> {
    return this.legacy({ type: 'craft', recipeId }, '合成完成', '合成失败：材料不足或背包空间不足');
  }

  async useItem(slot: number): Promise<boolean> {
    return this.legacy({ type: 'use-inventory', slot }, '食用 · 恢复饥饿', '你现在不饿，或这个物品暂时无法使用');
  }

  private async legacy(action: AuthorityAction, success: string, failure: string): Promise<boolean> {
    try {
      const { result } = await this.options.perform(action);
      this.options.refresh?.();
      if (result && typeof result === 'object' && 'success' in result && result.success === true) {
        this.options.changed();
        this.options.succeeded(success);
        return true;
      }
      this.options.failed(failure);
    } catch (error) {
      this.options.failed(error instanceof Error ? error.message : failure);
    }
    return false;
  }

  dispose() {
    this.disposed = true;
  }
}
