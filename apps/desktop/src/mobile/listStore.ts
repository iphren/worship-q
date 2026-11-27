import { native } from '../platform/native';
import { EMPTY_LIST, parseList, type RemoteEntry, type RemoteList } from './remoteList';

/**
 * The workspace list as the app holds it (native apps plan M2.10): read once, kept in
 * memory, written to the app's data folder after each change, one write at a time.
 */
export class ListStore {
  private list_: RemoteList = EMPTY_LIST;
  private loaded_ = false;
  private readonly listeners = new Set<() => void>();
  private writing: Promise<void> = Promise.resolve();

  get list(): RemoteList {
    return this.list_;
  }

  get loaded(): boolean {
    return this.loaded_;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async load(): Promise<RemoteList> {
    if (!this.loaded_) {
      this.list_ = parseList(await native.remoteListRead().catch(() => null));
      this.loaded_ = true;
      this.changed();
    }
    return this.list_;
  }

  set(list: RemoteList): void {
    this.list_ = list;
    this.changed();
    const json = JSON.stringify(list);
    this.writing = this.writing
      .then(() => native.remoteListWrite(json))
      .catch((error) => console.error('could not keep the workspace list', error));
  }

  /** Changes one entry, if it is still on the list. */
  update(id: string, change: (entry: RemoteEntry) => RemoteEntry): void {
    const entry = this.list_.entries.find((candidate) => candidate.id === id);
    if (!entry) return;
    const next = change(entry);
    if (JSON.stringify(next) === JSON.stringify(entry)) return;
    this.set({
      ...this.list_,
      entries: this.list_.entries.map((candidate) => (candidate.id === id ? next : candidate)),
    });
  }

  private changed(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export const listStore = new ListStore();
