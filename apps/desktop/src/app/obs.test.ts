import type { ObsSnapshot } from '@worship-q/protocol';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OBS_SETTINGS,
  ObsLink,
  obsSettingsStore,
  readObsSettings,
  sceneNames,
  sharedConnection,
  type ObsSettings,
} from './obs';
import { answerEverything, FakeNative, flush, memoryStorage, SCENES } from './obs.testing';

function setup(
  options: {
    settings?: Partial<ObsSettings>;
    password?: string | null;
    keychainRefuses?: boolean;
    answer?: boolean;
  } = {},
) {
  const native = new FakeNative();
  if (options.answer !== false) answerEverything(native);
  const storage = memoryStorage();
  const settings = obsSettingsStore(() => storage, 'ws1');
  settings.set({ ...DEFAULT_OBS_SETTINGS, ...options.settings });
  let secret = options.password ?? null;
  const secrets = {
    get: async () => {
      if (options.keychainRefuses) throw new Error('refused');
      return secret;
    },
    set: async (value: string) => void (secret = value),
    delete: async () => void (secret = null),
    peek: () => secret,
  };
  let time = Date.parse('2026-11-08T09:00:00.000Z');
  const delays: (() => void)[] = [];
  const link = new ObsLink({
    native,
    settings,
    secrets,
    now: () => time,
    delay: () => new Promise<void>((done) => delays.push(done)),
  });
  const snapshots: ObsSnapshot[] = [];
  link.onSnapshot((snapshot) => snapshots.push(snapshot));
  return {
    native,
    link,
    storage,
    settings,
    secrets,
    snapshots,
    delays,
    advance: (ms: number) => (time += ms),
    /** Lets one waiting delay run out. */
    tick: async () => {
      delays.shift()?.();
      await flush();
    },
  };
}

async function connected(options: Parameters<typeof setup>[0] = {}) {
  const env = setup({
    settings: { active: true, activatedAt: '2026-11-08T08:00:00.000Z' },
    ...options,
  });
  await env.link.start();
  env.native.status({ state: 'connected', obsVersion: '33.0.1' });
  await flush();
  return env;
}

describe('the OBS link’s settings (M1.5)', () => {
  it('keeps the settings per workspace and survives a restart', () => {
    const storage = memoryStorage();
    obsSettingsStore(() => storage, 'ws1').set({
      address: 'localhost:4460',
      active: true,
      activatedAt: '2026-11-08T09:00:00.000Z',
      favourites: ['Lyrics', 'Camera'],
    });
    expect(obsSettingsStore(() => storage, 'ws1').get()).toMatchObject({
      address: 'localhost:4460',
      active: true,
      favourites: ['Lyrics', 'Camera'],
    });
    expect(obsSettingsStore(() => storage, 'ws2').get()).toEqual(DEFAULT_OBS_SETTINGS);
    // The password is never among them.
    expect([...storage.data.values()].join()).not.toContain('password');
  });

  it('reads damaged or missing settings as the defaults', () => {
    expect(readObsSettings(null)).toEqual(DEFAULT_OBS_SETTINGS);
    expect(readObsSettings({ address: ' ', active: 'yes', favourites: [3, ''] })).toEqual(
      DEFAULT_OBS_SETTINGS,
    );
    const storage = memoryStorage();
    storage.setItem('wq.obs.ws1', '{not json');
    expect(obsSettingsStore(() => storage, 'ws1').get()).toEqual(DEFAULT_OBS_SETTINGS);
  });

  it('connects on start when the link was left on, with the password from the keychain', async () => {
    const { native, link } = setup({
      settings: { active: true, address: 'localhost:4460' },
      password: 'secret',
    });
    await link.start();
    expect(native.connects).toEqual([['localhost:4460', 'secret']]);
    expect(link.view.hasPassword).toBe(true);
  });

  it('stays off on start when the link is off', async () => {
    const { native, link } = setup();
    await link.start();
    expect(native.connects).toEqual([]);
    expect(link.view.link.state).toBe('off');
    expect(link.localState()).toBeNull();
  });

  it('tries without a password, and says so, when the keychain refuses it', async () => {
    const { native, link } = setup({ settings: { active: true }, keychainRefuses: true });
    await link.start();
    expect(native.connects).toEqual([['localhost:4455', null]]);
    expect(link.view.passwordUnavailable).toBe(true);
  });

  it('takes the port and password from OBS’s own settings when turned on without one (O12)', async () => {
    const { native, link, secrets, settings } = setup();
    native.config = {
      serverEnabled: true,
      serverPort: 4460,
      authRequired: true,
      serverPassword: 'from-obs',
    };
    await link.start();
    await link.activate();
    expect(secrets.peek()).toBe('from-obs');
    expect(settings.get()).toMatchObject({ address: 'localhost:4460', active: true });
    expect(native.connects).toEqual([['localhost:4460', 'from-obs']]);
  });

  it('keeps a password the operator typed over OBS’s own', async () => {
    const { native, link } = setup({ password: 'typed' });
    native.config = {
      serverEnabled: true,
      serverPort: 4455,
      authRequired: true,
      serverPassword: 'x',
    };
    await link.start();
    await link.activate();
    expect(native.connects).toEqual([['localhost:4455', 'typed']]);
  });

  it('dates each activation, so a later one elsewhere takes the state over (O9)', async () => {
    const { link, advance } = setup();
    await link.start();
    await link.activate();
    const first = link.view.settings.activatedAt;
    await link.deactivate();
    advance(60_000);
    await link.activate();
    expect(link.view.settings.activatedAt).not.toBe(first);
    expect(Date.parse(link.view.settings.activatedAt!) - Date.parse(first!)).toBe(60_000);
  });

  it('turns off: disconnects, forgets OBS’s state, and tells the workspace it is off', async () => {
    const { native, link } = await connected();
    expect(link.localState()?.active).toBe(true);
    await link.deactivate();
    expect(native.disconnects).toBe(1);
    expect(link.view.link.state).toBe('off');
    expect(link.localState()).toMatchObject({ active: false, scenes: [], status: 'not-running' });
    // A late status from the stopped connection changes nothing.
    native.status({ state: 'connected' });
    expect(link.view.link.state).toBe('off');
  });

  it('reconnects when the address or password changes while on, and removes an emptied password', async () => {
    const { native, link, secrets } = await connected({ password: 'old' });
    await link.setAddress('localhost:4460');
    await link.setPassword('new');
    await link.setPassword('');
    expect(native.connects.slice(1)).toEqual([
      ['localhost:4460', 'old'],
      ['localhost:4460', 'new'],
      ['localhost:4460', null],
    ]);
    expect(secrets.peek()).toBeNull();
    // The same address again does nothing.
    await link.setAddress(' localhost:4460 ');
    expect(native.connects).toHaveLength(4);
  });

  it('uses OBS’s settings on request, also turning authentication off', async () => {
    const { native, link, secrets } = await connected({ password: 'old' });
    native.config = {
      serverEnabled: true,
      serverPort: 4455,
      authRequired: false,
      serverPassword: 'x',
    };
    expect(await link.useObsSettings()).toBe(true);
    expect(secrets.peek()).toBeNull();
    native.config = null;
    expect(await link.useObsSettings()).toBe(false);
  });
});

describe('reading OBS (M1.4)', () => {
  it('lists scenes as OBS shows them, top first', () => {
    expect(sceneNames(SCENES.scenes)).toEqual(['Lyrics', 'Camera', 'Blank']);
    expect(sceneNames([{ sceneName: 'A' }, { sceneName: '' }, null, { sceneName: 'B' }])).toEqual([
      'B',
      'A',
    ]);
    expect(sceneNames('nonsense')).toEqual([]);
  });

  it('says Connecting until OBS’s state is read, then Connected', async () => {
    const env = setup({ settings: { active: true, activatedAt: 't' }, answer: false });
    await env.link.start();
    expect(sharedConnection(env.link.view)).toBe('connecting');
    env.native.status({ state: 'connected' });
    expect(sharedConnection(env.link.view)).toBe('connecting');
    answerEverything(env.native);
    for (const asked of [...env.native.waiting])
      env.native.answer(asked.type, env.native.answers.get(asked.type)!(null));
    await flush();
    expect(sharedConnection(env.link.view)).toBe('connected');
    expect(env.link.view).toMatchObject({
      scenes: ['Lyrics', 'Camera', 'Blank'],
      currentScene: 'Lyrics',
    });
  });

  it('keeps the scenes current from OBS’s events, and ignores a repeated scene', async () => {
    const { native, link } = await connected();
    let changes = 0;
    link.subscribe(() => changes++);
    native.event('CurrentProgramSceneChanged', { sceneName: 'Camera' });
    native.event('CurrentProgramSceneChanged', { sceneName: 'Camera' });
    expect(link.view.currentScene).toBe('Camera');
    expect(changes).toBe(1);
    native.event('SceneListChanged', { scenes: [{ sceneIndex: 0, sceneName: 'Only' }] });
    expect(link.view.scenes).toEqual(['Only']);
  });

  it('lets an event win over an answer it overtook (connect race)', async () => {
    const env = setup({ settings: { active: true }, answer: false });
    await env.link.start();
    env.native.status({ state: 'connected' });
    // OBS switches scene while the scene list is on its way.
    env.native.event('CurrentProgramSceneChanged', { sceneName: 'Camera' });
    answerEverything(env.native);
    for (const asked of [...env.native.waiting])
      env.native.answer(asked.type, env.native.answers.get(asked.type)!(null));
    await flush();
    expect(env.link.view.currentScene).toBe('Camera');
    expect(env.link.view.scenes).toEqual(['Lyrics', 'Camera', 'Blank']);
  });

  it('drops answers from before OBS was reconnected', async () => {
    const env = setup({ settings: { active: true }, answer: false });
    await env.link.start();
    env.native.status({ state: 'connected' });
    const stale = [...env.native.waiting];
    env.native.waiting = [];
    // OBS restarts; the old answers arrive after the new connection was made.
    env.native.status({ state: 'not-running' });
    env.native.status({ state: 'connected' });
    for (const asked of stale) {
      asked.resolve(
        asked.type === 'GetSceneList'
          ? { currentProgramSceneName: 'Old', scenes: [{ sceneName: 'Old' }] }
          : {},
      );
    }
    await flush();
    expect(env.link.view.ready).toBe(false);
    expect(env.link.view.currentScene).not.toBe('Old');
  });

  it('marks OBS as not running as soon as it says it is quitting', async () => {
    const { native, link } = await connected();
    native.event('ExitStarted', null);
    expect(sharedConnection(link.view)).toBe('not-running');
    native.status({ state: 'not-running' });
    native.status({ state: 'connected' });
    expect(link.view.closing).toBe(false);
  });

  it('checks OBS’s own settings when OBS stops answering, to tell a disabled server apart', async () => {
    const { native } = await connected();
    const before = native.configReads;
    native.status({ state: 'not-running' });
    native.status({ state: 'not-running' });
    await flush();
    expect(native.configReads).toBe(before + 1);
  });

  it('reads the scene list again after OBS switched scene collection', async () => {
    const { native, link } = await connected();
    native.answers.set('GetSceneList', () => ({
      currentProgramSceneName: 'Welcome',
      scenes: [{ sceneIndex: 0, sceneName: 'Welcome' }],
    }));
    native.event('CurrentSceneCollectionChanging');
    native.event('CurrentSceneCollectionChanged', { sceneCollectionName: 'Easter' });
    await flush();
    expect(link.view).toMatchObject({ scenes: ['Welcome'], currentScene: 'Welcome' });
  });

  it('keeps the favourites on a scene renamed in OBS', async () => {
    const { native, link, settings } = await connected({
      settings: { active: true, activatedAt: 't', favourites: ['Lyrics', 'Camera'] },
    });
    native.event('SceneNameChanged', { oldSceneName: 'Camera', sceneName: 'Camera 1' });
    expect(settings.get().favourites).toEqual(['Lyrics', 'Camera 1']);
    expect(link.view.scenes).toEqual(['Lyrics', 'Camera 1', 'Blank']);
    native.event('SceneNameChanged', { oldSceneName: 'Lyrics', sceneName: 'Words' });
    expect(link.view.currentScene).toBe('Words');
  });
});

describe('streaming, recording and the virtual camera', () => {
  it('loads each output’s state and duration on connect', async () => {
    const env = setup({ settings: { active: true, activatedAt: 't' } });
    answerEverything(env.native);
    env.native.answers.set('GetStreamStatus', () => ({
      outputActive: true,
      outputDuration: 90_000,
    }));
    env.native.answers.set('GetRecordStatus', () => ({
      outputActive: true,
      outputPaused: true,
      outputDuration: 5000,
    }));
    await env.link.start();
    env.native.status({ state: 'connected' });
    await flush();
    expect(env.link.view.outputs.stream).toEqual({
      active: true,
      phase: null,
      durationMs: 90_000,
      paused: false,
    });
    env.advance(10_000);
    const now = env.link.outputsNow();
    expect(now.stream.durationMs).toBe(100_000);
    // A paused recording does not advance.
    expect(now.record.durationMs).toBe(5000);
  });

  it('follows OBS’s state changes, and reads the duration once started', async () => {
    const { native, link } = await connected({ answer: true });
    native.answers.delete('GetStreamStatus');
    native.event('StreamStateChanged', {
      outputActive: false,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STARTING',
    });
    expect(link.view.outputs.stream).toMatchObject({ active: false, phase: 'starting' });
    native.event('StreamStateChanged', {
      outputActive: true,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
    });
    expect(link.view.outputs.stream).toMatchObject({ active: true, phase: null, durationMs: 0 });
    native.answer('GetStreamStatus', { outputActive: true, outputDuration: 1200 });
    await flush();
    expect(link.view.outputs.stream.durationMs).toBe(1200);
    native.event('StreamStateChanged', {
      outputActive: true,
      outputState: 'OBS_WEBSOCKET_OUTPUT_RECONNECTING',
    });
    expect(link.view.outputs.stream.phase).toBe('reconnecting');
    native.event('StreamStateChanged', {
      outputActive: false,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
    });
    expect(link.view.outputs.stream).toEqual({
      active: false,
      phase: null,
      durationMs: null,
      paused: false,
    });
  });

  it('drops a duration that arrives after the output stopped (event race)', async () => {
    const { native, link } = await connected();
    native.answers.delete('GetRecordStatus');
    native.event('RecordStateChanged', {
      outputActive: true,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
    });
    native.event('RecordStateChanged', {
      outputActive: false,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STOPPED',
    });
    native.answer('GetRecordStatus', { outputActive: true, outputDuration: 3000 });
    await flush();
    expect(link.view.outputs.record.active).toBe(false);
  });

  it('pauses and resumes a recording', async () => {
    const { native, link } = await connected();
    native.event('RecordStateChanged', {
      outputActive: true,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
    });
    native.event('RecordStateChanged', {
      outputActive: true,
      outputState: 'OBS_WEBSOCKET_OUTPUT_PAUSED',
    });
    expect(link.view.outputs.record.paused).toBe(true);
    native.event('RecordStateChanged', {
      outputActive: true,
      outputState: 'OBS_WEBSOCKET_OUTPUT_RESUMED',
    });
    expect(link.view.outputs.record.paused).toBe(false);
  });

  it('forgets the outputs when the connection drops, rather than showing them live', async () => {
    const { native, link } = await connected();
    native.event('StreamStateChanged', {
      outputActive: true,
      outputState: 'OBS_WEBSOCKET_OUTPUT_STARTED',
    });
    native.status({ state: 'not-running' });
    expect(link.view.outputs.stream.active).toBe(false);
    expect(link.localState()).toMatchObject({
      status: 'not-running',
      scenes: [],
      currentScene: null,
    });
  });
});

describe('commands (M1.4)', () => {
  it('asks OBS for the state wanted', async () => {
    const { native, link } = await connected();
    native.answers.set('SetCurrentProgramScene', () => null);
    native.answers.set('StartVirtualCam', () => null);
    expect(await link.command({ type: 'setScene', scene: 'Camera' })).toEqual({ ok: true });
    expect(await link.command({ type: 'startVirtualCam' })).toEqual({ ok: true });
    expect(native.asked.find((a) => a.type === 'SetCurrentProgramScene')?.data).toEqual({
      sceneName: 'Camera',
    });
  });

  it('counts starting what is running, or stopping what is stopped, as done', async () => {
    const { native, link } = await connected();
    native.answers.set('StartStream', () => {
      throw { code: 500, comment: 'Output already running' };
    });
    native.answers.set('StopRecord', () => {
      throw { code: 501, comment: 'Output not running' };
    });
    native.answers.set('StopStream', () => {
      throw { code: 500, comment: 'nope' };
    });
    expect(await link.command({ type: 'startStream' })).toEqual({ ok: true });
    expect(await link.command({ type: 'stopRecord' })).toEqual({ ok: true });
    // A code that only means done for the opposite request is an error.
    expect(await link.command({ type: 'stopStream' })).toEqual({
      ok: false,
      code: 500,
      error: 'nope',
    });
  });

  it('passes OBS’s refusal on, and says when OBS could not be reached', async () => {
    const { native, link } = await connected();
    native.answers.set('SetCurrentProgramScene', () => {
      throw { code: 600, comment: 'No source was found by the name of `Gone`.' };
    });
    expect(await link.command({ type: 'setScene', scene: 'Gone' })).toEqual({
      ok: false,
      code: 600,
      error: 'No source was found by the name of `Gone`.',
    });
    native.answers.set('StartRecord', () => {
      throw { code: -2, comment: 'OBS did not answer in time' };
    });
    expect(await link.command({ type: 'startRecord' })).toEqual({ ok: false, error: 'timeout' });
  });

  it('refuses without asking while OBS is not connected, or the link is off', async () => {
    const { native, link } = await connected();
    native.status({ state: 'not-running' });
    expect(await link.command({ type: 'startStream' })).toEqual({
      ok: false,
      error: 'not-connected',
    });
    await link.deactivate();
    expect(await link.command({ type: 'startStream' })).toEqual({ ok: false, error: 'no-obs' });
    expect(native.count('StartStream')).toBe(0);
  });
});

describe('the live monitor (M5.1)', () => {
  const image = 'data:image/webp;base64,UklGRoY=';

  it('asks OBS for nothing while nobody watches', async () => {
    const { native } = await connected();
    await flush();
    expect(native.count('GetSourceScreenshot')).toBe(0);
  });

  it('takes an image of the scene on program once a second while watched, one request at a time', async () => {
    const { native, link, snapshots, tick } = await connected();
    native.answers.set('GetSourceScreenshot', () => ({ imageData: image }));
    link.setWatchingElsewhere(true);
    // Watching from two places starts no second loop.
    link.setWatchingHere(true);
    await flush();
    expect(native.count('GetSourceScreenshot')).toBe(1);
    expect(native.asked.find((a) => a.type === 'GetSourceScreenshot')?.data).toEqual({
      sourceName: 'Lyrics',
      imageFormat: 'webp',
      imageWidth: 576,
      imageCompressionQuality: 50,
    });
    await tick();
    expect(native.count('GetSourceScreenshot')).toBe(2);
    expect(snapshots.map((s) => s.image)).toEqual([image, image]);
  });

  it('stops when the last one stops watching, and when OBS goes away', async () => {
    const { native, link, tick } = await connected();
    native.answers.set('GetSourceScreenshot', () => ({ imageData: image }));
    link.setWatchingHere(true);
    await flush();
    link.setWatchingHere(false);
    await tick();
    await tick();
    expect(native.count('GetSourceScreenshot')).toBe(1);

    link.setWatchingElsewhere(true);
    await flush();
    native.status({ state: 'not-running' });
    await tick();
    expect(native.count('GetSourceScreenshot')).toBe(2);
    // OBS is back: watching resumes without being asked again.
    native.status({ state: 'connected' });
    await flush();
    await flush();
    expect(native.count('GetSourceScreenshot')).toBe(3);
  });

  it('never sends an image that is not one, and falls back to JPEG when OBS will not make WebP', async () => {
    const { native, link, snapshots, tick } = await connected();
    native.answers.set('GetSourceScreenshot', () => ({ imageData: 'javascript:alert(1)' }));
    link.setWatchingHere(true);
    await flush();
    expect(snapshots).toEqual([]);
    native.answers.set('GetSourceScreenshot', () => {
      throw { code: 400, comment: 'unsupported format' };
    });
    await tick();
    native.answers.set('GetSourceScreenshot', () => ({ imageData: 'data:image/jpg;base64,/9j/' }));
    await tick();
    const last = native.asked.filter((a) => a.type === 'GetSourceScreenshot').at(-1)!;
    expect((last.data as { imageFormat: string }).imageFormat).toBe('jpg');
    expect(snapshots).toHaveLength(1);
  });

  it('waits while OBS switches scene collection', async () => {
    const { native, link, tick } = await connected();
    native.answers.set('GetSourceScreenshot', () => ({ imageData: image }));
    native.event('CurrentSceneCollectionChanging');
    link.setWatchingHere(true);
    await tick();
    expect(native.count('GetSourceScreenshot')).toBe(0);
    native.event('CurrentSceneCollectionChanged');
    await tick();
    expect(native.count('GetSourceScreenshot')).toBe(1);
  });
});
