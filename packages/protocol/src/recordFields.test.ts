/**
 * Guards the rule that keeps synchronized records whole across builds: every change to the
 * fields a record holds comes with a new `PROTOCOL_VERSION`.
 *
 * A build saves only the fields it knows, so records pulled by an older build lack any added
 * since. A build with a newer protocol version pulls everything again once, taking those
 * fields (`SyncClient.pull`), and the instance keeps them when an older build pushes a record
 * without them (`Instance.push`). Neither happens unless the version goes up.
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  BackgroundAssetSchema,
  OutputProfileSchema,
  PresentationSettingsSchema,
  PROTOCOL_VERSION,
  RunSheetItemSchema,
  RunSheetSchema,
  SongRevisionSchema,
  SongSchema,
  WorkspaceSchema,
} from './index';

/**
 * The fields of the synchronized records, as of protocol `PINNED.protocol`. When this test
 * fails because a field was added, removed or renamed:
 *
 * 1. Raise `PROTOCOL_VERSION` in `wire.ts` and say there what the version adds.
 * 2. If a field was added to songs, have `Instance.push` keep it when a device older than the
 *    new version saves the song without it, as it does for `video` and `passage`.
 * 3. Update `PINNED` below: the new version and the fields as they now are.
 */
const PINNED = {
  protocol: 6,
  fields: [
    'workspace.id',
    'workspace.name',
    'workspace.timezone',
    'workspace.meetingDays',
    'workspace.revision',
    'workspace.createdAt',
    'workspace.updatedAt',
    'background.id',
    'background.workspaceId',
    'background.kind',
    'background.fileName',
    'background.originalName',
    'background.createdAt',
    'background.removedAt',
    'background.origin',
    'song.title',
    'song.lyrics',
    'song.author',
    'song.copyright',
    'song.ccli',
    'song.year',
    'song.background',
    'song.background.color',
    'song.background.assetId',
    'song.deck',
    'song.deck.source',
    'song.deck.kind',
    'song.deck.width',
    'song.deck.height',
    'song.deck.pages',
    'song.deck.pages[].image',
    'song.deck.pages[].thumbnail',
    'song.deck.pages[].slide',
    'song.deck.pages[].step',
    'song.deck.pages[].text',
    'song.website',
    'song.website.url',
    'song.video',
    'song.video.file',
    'song.video.source',
    'song.video.width',
    'song.video.height',
    'song.video.durationSeconds',
    'song.video.bytes',
    'song.video.autoplay',
    'song.passage',
    'song.passage.reference',
    'song.passage.texts',
    'song.passage.texts[].version',
    'song.passage.texts[].credit',
    'song.passage.texts[].provider',
    'song.passage.texts[].copyright',
    'song.passage.texts[].units',
    'song.passage.texts[].units[].chapter',
    'song.passage.texts[].units[].verses',
    'song.passage.texts[].units[].label',
    'song.passage.texts[].units[].title',
    'song.passage.texts[].units[].lines',
    'song.passage.texts[].units[].lines[].text',
    'song.passage.texts[].units[].lines[].indent',
    'song.passage.texts[].fumsToken',
    'song.id',
    'song.workspaceId',
    'song.lineIds',
    'song.revision',
    'song.createdAt',
    'song.updatedAt',
    'song.removedAt',
    'song.origin',
    'song.useChurchVersion',
    'song.versions',
    'song.versions.own',
    'song.versions.own.revision',
    'song.versions.own.updatedAt',
    'song.versions.church',
    'song.versions.church.revision',
    'song.versions.church.updatedAt',
    'songRevision.title',
    'songRevision.lyrics',
    'songRevision.author',
    'songRevision.copyright',
    'songRevision.ccli',
    'songRevision.year',
    'songRevision.background',
    'songRevision.background.color',
    'songRevision.background.assetId',
    'songRevision.deck',
    'songRevision.deck.source',
    'songRevision.deck.kind',
    'songRevision.deck.width',
    'songRevision.deck.height',
    'songRevision.deck.pages',
    'songRevision.deck.pages[].image',
    'songRevision.deck.pages[].thumbnail',
    'songRevision.deck.pages[].slide',
    'songRevision.deck.pages[].step',
    'songRevision.deck.pages[].text',
    'songRevision.website',
    'songRevision.website.url',
    'songRevision.video',
    'songRevision.video.file',
    'songRevision.video.source',
    'songRevision.video.width',
    'songRevision.video.height',
    'songRevision.video.durationSeconds',
    'songRevision.video.bytes',
    'songRevision.video.autoplay',
    'songRevision.passage',
    'songRevision.passage.reference',
    'songRevision.passage.texts',
    'songRevision.passage.texts[].version',
    'songRevision.passage.texts[].credit',
    'songRevision.passage.texts[].provider',
    'songRevision.passage.texts[].copyright',
    'songRevision.passage.texts[].units',
    'songRevision.passage.texts[].units[].chapter',
    'songRevision.passage.texts[].units[].verses',
    'songRevision.passage.texts[].units[].label',
    'songRevision.passage.texts[].units[].title',
    'songRevision.passage.texts[].units[].lines',
    'songRevision.passage.texts[].units[].lines[].text',
    'songRevision.passage.texts[].units[].lines[].indent',
    'songRevision.passage.texts[].fumsToken',
    'songRevision.id',
    'songRevision.songId',
    'songRevision.revision',
    'songRevision.lineIds',
    'songRevision.createdAt',
    'runSheet.id',
    'runSheet.workspaceId',
    'runSheet.date',
    'runSheet.revision',
    'runSheet.createdAt',
    'runSheet.updatedAt',
    'runSheetItem.id',
    'runSheetItem.runSheetId',
    'runSheetItem.songId',
    'runSheetItem.position',
    'runSheetItem.revision',
    'runSheetItem.createdAt',
    'runSheetItem.updatedAt',
    'presentation.linesPerPiece',
    'presentation.wrapLongLines',
    'outputProfile.id',
    'outputProfile.workspaceId',
    'outputProfile.kind',
    'outputProfile.fontFamily',
    'outputProfile.scale',
    'outputProfile.backgroundColor',
    'outputProfile.backgroundAssetId',
    'outputProfile.hideCursor',
    'outputProfile.target',
    'outputProfile.target.monitor',
    'outputProfile.target.monitor.name',
    'outputProfile.target.monitor.x',
    'outputProfile.target.monitor.y',
    'outputProfile.target.monitor.width',
    'outputProfile.target.monitor.height',
    'outputProfile.target.enabled',
    'outputProfile.target.allowOperatorScreen',
    'outputProfile.revision',
    'outputProfile.updatedAt',
  ],
};

const RECORDS = {
  workspace: WorkspaceSchema,
  background: BackgroundAssetSchema,
  song: SongSchema,
  songRevision: SongRevisionSchema,
  runSheet: RunSheetSchema,
  runSheetItem: RunSheetItemSchema,
  presentation: PresentationSettingsSchema,
  outputProfile: OutputProfileSchema,
};

interface JsonSchema {
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: JsonSchema | boolean;
}

/** Every field's path in a schema, nested ones too, such as `song.deck.pages[].text`. */
function fieldPaths(schema: JsonSchema, at: string, found: string[]): string[] {
  for (const alternatives of [schema.anyOf, schema.oneOf, schema.allOf]) {
    for (const alternative of alternatives ?? []) fieldPaths(alternative, at, found);
  }
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const path = `${at}.${name}`;
    if (!found.includes(path)) found.push(path);
    fieldPaths(field, path, found);
  }
  if (schema.items) fieldPaths(schema.items, `${at}[]`, found);
  if (typeof schema.additionalProperties === 'object') {
    fieldPaths(schema.additionalProperties, `${at}{}`, found);
  }
  return found;
}

describe('synchronized record fields', () => {
  it('change only with a new protocol version', () => {
    const fields = Object.entries(RECORDS).flatMap(([name, schema]) =>
      fieldPaths(
        z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchema,
        name,
        [],
      ),
    );
    expect(fields, 'Record fields changed: see the steps above PINNED.').toEqual(PINNED.fields);
  });

  it('are pinned for the current protocol version', () => {
    expect(PINNED.protocol, 'PROTOCOL_VERSION changed: update PINNED.').toBe(PROTOCOL_VERSION);
  });
});
