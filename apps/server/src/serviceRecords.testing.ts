/** Shared set-up for the service records tests: a server with a workspace and its content. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PROTOCOL_HEADER,
  PROTOCOL_VERSION,
  type LogEntry,
  type SyncRecord,
} from '@worship-q/protocol';
import { buildServer } from './app';
import { openDatabase } from './db';
import { workspaceFilesDir } from './files';
import { Instance } from './instance';

export function clock(start = '2026-11-15T10:00:00.000Z') {
  let now = Date.parse(start);
  return {
    now: () => new Date(now).toISOString(),
    advance: (ms: number) => (now += ms),
    at: (seconds: number) => new Date(Date.parse(start) + seconds * 1000).toISOString(),
  };
}

let counter = 0;
/** A fresh entry id. */
export function entryId(): string {
  counter++;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

const songFields = {
  title: 'Amazing Grace',
  lyrics: 'Amazing grace\nHow sweet the sound\n\nThat saved a wretch\nLike me',
  author: 'John Newton',
  copyright: 'Public domain',
  ccli: null,
  year: null,
  background: null,
  deck: null,
  website: null,
  video: null,
  passage: null,
};

export const DECK_IMAGE = 'deck-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-001.jpg';
export const DECK_THUMB = 'deck-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-001-t.jpg';
export const DECK_GONE = 'deck-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-002.jpg';

export async function setupRecords() {
  const time = clock();
  const dataDir = mkdtempSync(join(tmpdir(), 'worship-q-records-'));
  const instance = new Instance(openDatabase(':memory:'), time.now);
  const { workspace, code } = instance.createWorkspace('North');
  const coordinator = instance.enroll(code, 'Main desk')!;
  const follower = instance.enroll(code, 'Side desk')!;
  const elsewhere = instance.createWorkspace('South');
  const stranger = instance.enroll(elsewhere.code, 'Far away')!;
  const { app, recordings, presentationLog } = await buildServer({
    instance,
    dataDir,
    name: 'Test',
    sweep: false,
  });
  const headers = (token = coordinator.token) => ({
    authorization: `Bearer ${token}`,
    [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
    'content-type': 'application/json',
  });
  const push = (records: Omit<SyncRecord, 'key'>[]) =>
    instance.push(
      workspace.id,
      coordinator.device.id,
      // A run sheet is keyed by its date, as on the devices.
      records.map((record) => ({
        ...record,
        key: record.kind === 'runSheet' ? String(record.data.date) : record.id,
      })) as SyncRecord[],
      PROTOCOL_VERSION,
    );

  // Song s1 at revision 2, with revision records 1 and 2; revision 1 had other words.
  push([
    {
      kind: 'song',
      id: 's1',
      revision: 2,
      updatedAt: time.at(-60),
      data: {
        ...songFields,
        id: 's1',
        workspaceId: workspace.id,
        lineIds: ['l1', 'l2', 'l3', 'l4'],
        revision: 2,
        createdAt: time.at(-120),
        updatedAt: time.at(-60),
        removedAt: null,
      },
    },
    {
      kind: 'songRevision',
      id: 'r1',
      revision: 1,
      updatedAt: time.at(-120),
      data: {
        ...songFields,
        lyrics: 'Amazing grace\nHow sweet that sound',
        id: 'r1',
        songId: 's1',
        revision: 1,
        lineIds: ['l1', 'l2'],
        createdAt: time.at(-120),
      },
    },
    {
      kind: 'songRevision',
      id: 'r2',
      revision: 1,
      updatedAt: time.at(-60),
      data: {
        ...songFields,
        id: 'r2',
        songId: 's1',
        revision: 2,
        lineIds: ['l1', 'l2', 'l3', 'l4'],
        createdAt: time.at(-60),
      },
    },
    {
      kind: 'song',
      id: 'deck1',
      revision: 1,
      updatedAt: time.at(-60),
      data: {
        ...songFields,
        title: 'Notices',
        lyrics: 'Welcome',
        id: 'deck1',
        workspaceId: workspace.id,
        lineIds: [],
        revision: 1,
        createdAt: time.at(-60),
        updatedAt: time.at(-60),
        removedAt: null,
        deck: {
          source: 'notices.pptx',
          width: 1920,
          height: 1080,
          pages: [
            { image: DECK_IMAGE, thumbnail: DECK_THUMB, slide: 1, step: 0, text: ['Welcome'] },
            { image: DECK_GONE, slide: 2, step: 0, text: [] },
          ],
        },
      },
    },
    {
      kind: 'background',
      id: 'bg1',
      revision: 1,
      updatedAt: time.at(-60),
      data: {
        id: 'bg1',
        workspaceId: workspace.id,
        kind: 'image',
        fileName: 'hills.jpg',
        originalName: 'hills.jpg',
        createdAt: time.at(-60),
        removedAt: null,
      },
    },
    {
      kind: 'runSheet',
      id: 'rs1',
      revision: 1,
      updatedAt: time.at(-60),
      data: {
        id: 'rs1',
        workspaceId: workspace.id,
        date: '2026-11-15',
        items: [
          { id: 'i1', songId: 's1' },
          { id: 'i2', songId: 'deck1' },
        ],
      },
    },
  ]);
  const files = workspaceFilesDir(dataDir, workspace.id);
  mkdirSync(files, { recursive: true });
  for (const name of [DECK_IMAGE, DECK_THUMB, 'hills.jpg']) {
    writeFileSync(join(files, name), `file ${name}`);
  }

  /** An entry of s1's second piece at revision 2, starting `start` seconds from now. */
  const entry = (start: number, overrides: Partial<LogEntry> = {}): LogEntry => ({
    id: entryId(),
    runSheetId: 'rs1',
    date: '2026-11-15',
    itemId: 'i1',
    previous: false,
    songId: 's1',
    revision: 2,
    revisionId: 'r2',
    version: null,
    part: { kind: 'lyrics', line: 2, count: 2 },
    background: { color: '#000000', assetId: 'bg1' },
    startedAt: time.at(start),
    endedAt: null,
    ...overrides,
  });
  const send = (entries: LogEntry[], token = coordinator.token, sentAt = time.now()) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/presentation-log',
      headers: headers(token),
      payload: { sentAt, entries },
    });
  return {
    app,
    instance,
    dataDir,
    workspace,
    coordinator,
    follower,
    stranger,
    time,
    push,
    entry,
    send,
    recordings,
    presentationLog,
    headers,
  };
}
