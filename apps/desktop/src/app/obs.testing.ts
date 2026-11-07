/** A fake native OBS core for tests (`obs.test.ts`, `liveLink.test.ts`). */
import type { ObsConfigFile, ObsLinkStatus } from '../platform/native';
import type { ObsNative } from './obs';

export const flush = () => new Promise((done) => setTimeout(done, 0));

export interface Asked {
  type: string;
  data: unknown;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

/** A fake native core: answers come from `answers`, or wait in `waiting` for the test. */
export class FakeNative implements ObsNative {
  handlers: Parameters<ObsNative['listen']>[0] | null = null;
  connects: [string, string | null][] = [];
  disconnects = 0;
  asked: Asked[] = [];
  waiting: Asked[] = [];
  answers = new Map<string, (data: unknown) => unknown>();
  config: ObsConfigFile | null = null;
  configReads = 0;

  listen(handlers: Parameters<ObsNative['listen']>[0]) {
    this.handlers = handlers;
    return Promise.resolve(() => (this.handlers = null));
  }
  async connect(address: string, password: string | null) {
    this.connects.push([address, password]);
  }
  async disconnect() {
    this.disconnects++;
  }
  async readConfig() {
    this.configReads++;
    return this.config;
  }
  request<T>(type: string, data?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const asked: Asked = { type, data, resolve: resolve as (v: unknown) => void, reject };
      this.asked.push(asked);
      const answer = this.answers.get(type);
      if (!answer) return void this.waiting.push(asked);
      try {
        const value = answer(data);
        queueMicrotask(() => resolve(value as T));
      } catch (error) {
        queueMicrotask(() => reject(error));
      }
    });
  }
  status(status: ObsLinkStatus) {
    this.handlers?.status(status);
  }
  event(type: string, data: unknown = {}) {
    this.handlers?.event(type, data);
  }
  /** Answers the oldest waiting request of a type. */
  answer(type: string, value: unknown) {
    const index = this.waiting.findIndex((asked) => asked.type === type);
    if (index < 0) throw new Error(`nothing waiting for ${type}`);
    this.waiting.splice(index, 1)[0]!.resolve(value);
  }
  count(type: string) {
    return this.asked.filter((asked) => asked.type === type).length;
  }
}

export const SCENES = {
  currentProgramSceneName: 'Lyrics',
  scenes: [
    { sceneIndex: 0, sceneName: 'Blank' },
    { sceneIndex: 1, sceneName: 'Camera' },
    { sceneIndex: 2, sceneName: 'Lyrics' },
  ],
};

export function answerEverything(native: FakeNative) {
  native.answers.set('GetVersion', () => ({ supportedImageFormats: ['jpg', 'png', 'webp'] }));
  native.answers.set('GetSceneList', () => SCENES);
  native.answers.set('GetStreamStatus', () => ({ outputActive: false }));
  native.answers.set('GetRecordStatus', () => ({ outputActive: false }));
  native.answers.set('GetVirtualCamStatus', () => ({ outputActive: false }));
}

export function memoryStorage() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}
