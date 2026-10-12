import type {
  AuthorityAction,
  AuthorityGameplayView,
} from '@seedlands/stdlib/server/protocol/authority-worker-protocol';

type Action = Extract<AuthorityAction, { type: 'transport-storage' }>;
type Site = NonNullable<AuthorityGameplayView['transportStorage']>[number];
export type TransportStorageUiCommand = Action['command'];
export type TransportStorageUiRequest = Readonly<{
  command: TransportStorageUiCommand;
  expectedInventoryRevision: number;
  expectedTransportRevision: number;
}>;

/** The local selection holds only a lifetime; all owners and revisions remain in Authority. */
export class BrowserTransportStorage {
  private selected: Site['reference'] | null = null;
  private pending = false;
  private disposed = false;
  constructor(
    private readonly options: Readonly<{
      view(): AuthorityGameplayView;
      perform(action: Action): Promise<{ result: unknown }>;
      refresh(): void;
      changed(): void;
      failed(message: string): void;
    }>,
  ) {}
  clear() {
    this.selected = null;
  }
  dispose() {
    this.disposed = true;
    this.clear();
  }
  open(reference: Site['reference']): boolean {
    this.selected = { ...reference };
    return Boolean(this.current());
  }
  current(): Site | null {
    if (this.disposed) return null;
    const view = this.options.view();
    const site =
      view.player.lifecycle === 'alive' && view.inventory.cursor.stack === null
        ? view.transportStorage?.find((entry) => JSON.stringify(entry.reference) === JSON.stringify(this.selected))
        : null;
    if (!site) this.clear();
    return site ?? null;
  }
  async send(request: TransportStorageUiRequest): Promise<boolean> {
    const site = this.current();
    if (!site || this.pending) return false;
    const view = this.options.view();
    if (
      request.expectedInventoryRevision !== view.inventory.revision ||
      request.expectedTransportRevision !== site.revision
    ) {
      this.options.failed('物品已变化，请重新选择');
      this.options.refresh();
      return false;
    }
    this.pending = true;
    const actor = { ...view.inventory.actor };
    try {
      const response = await this.options.perform({
        type: 'transport-storage',
        version: 1,
        actor,
        transport: { ...site.reference },
        expectedInventoryRevision: view.inventory.revision,
        expectedTransportRevision: site.revision,
        command: request.command,
      });
      if (this.disposed || JSON.stringify(this.options.view().inventory.actor) !== JSON.stringify(actor)) return false;
      const success = (response.result as { success?: boolean }).success === true;
      if (success) this.options.changed();
      else this.options.failed('操作未完成，请重新选择');
      this.options.refresh();
      return success;
    } catch {
      if (this.disposed || JSON.stringify(this.options.view().inventory.actor) !== JSON.stringify(actor)) return false;
      this.options.failed('操作未完成，请重新选择');
      this.options.refresh();
      return false;
    } finally {
      this.pending = false;
    }
  }
}
