export interface BusEvent {
  type: string;
  source: string;
  payload: Record<string, unknown>;
}

export class EventBus {
  private handlers = new Map<string, Set<(e: BusEvent) => void | Promise<void>>>();

  subscribe(type: string, handler: (event: BusEvent) => void | Promise<void>): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  async publish(event: BusEvent): Promise<void> {
    const set = this.handlers.get(event.type);
    if (set) await Promise.all([...set].map(h => h(event)));
  }

  once(type: string): Promise<BusEvent> {
    return new Promise(resolve => {
      const unsub = this.subscribe(type, e => {
        unsub();
        resolve(e);
      });
    });
  }
}

export const globalBus = new EventBus();
