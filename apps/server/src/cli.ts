/**
 * Administration from the server's shell, until the admin web app exists:
 *
 *   workspace create <name>     create a workspace and print its connection code
 *   workspace list
 *   workspace code <id>         replace a workspace's connection code
 *   workspace library <id> on|off [--yes]
 *                               whether the workspace manages the Church Library
 *   device list [workspace-id]
 *   device revoke <device-id>
 *   settings show
 *   settings set <key> <json>   e.g. settings set linesPerPiece 2
 *   settings unset <key>
 *   import legacy <workspace-id> <file|-> [--dry-run]
 *                               songs exported from the legacy lyrics service
 *   deck convert <file> <out-dir>
 *                               renders a slide deck to images, one per click
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ChurchSettingsSchema } from '@worship-q/protocol';
import { openDatabase } from './db';
import { convertDeck, deckTools } from './decks/convert';
import { moveFilesToChurch } from './files';
import { Instance } from './instance';
import { applyLegacyImport, parseLegacyExport, planLegacyImport } from './legacy';

const dataDir = process.env.WORSHIP_Q_DATA ?? '/data';
mkdirSync(dataDir, { recursive: true });
const instance = new Instance(openDatabase(join(dataDir, 'instance.db')));
const [area, action, ...rest] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function table(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return console.log('(none)');
  console.table(rows);
}

switch (`${area} ${action}`) {
  case 'workspace create': {
    const name = rest.join(' ').trim();
    if (!name) fail('Usage: workspace create <name>');
    const { workspace, code } = instance.createWorkspace(name);
    console.log(`Created workspace “${workspace.name}” (${workspace.id}).`);
    console.log(`Connection code: ${code}`);
    console.log('In Worship Q, open Settings → Church connection and enter the address and code.');
    break;
  }
  case 'workspace list':
    table(
      instance.listWorkspaces().map((w) => ({
        id: w.id,
        name: w.name,
        content: w.contentId ?? '(empty)',
        churchLibrary: w.manageLibrary ? 'manages' : '',
      })),
    );
    break;
  case 'workspace code': {
    const [id] = rest;
    if (!id) fail('Usage: workspace code <workspace-id>');
    console.log(`New connection code: ${instance.rotateCode(id)}`);
    break;
  }
  case 'workspace library': {
    const yes = rest.includes('--yes');
    const [id, setting] = rest.filter((arg) => arg !== '--yes');
    if (!id || (setting !== 'on' && setting !== 'off')) {
      fail('Usage: workspace library <workspace-id> on|off [--yes]');
    }
    const workspace = instance.getWorkspace(id);
    if (!workspace) fail(`No workspace ${id}. See: workspace list`);
    const on = setting === 'on';
    if (workspace.manageLibrary === on) {
      console.log(
        `“${workspace.name}” ${on ? 'already manages' : 'does not manage'} the Church Library.`,
      );
      break;
    }
    if (on) {
      const plan = instance.libraryPlan(id);
      const list = (title: string, items: string[]) => {
        console.log(`${title}: ${items.length}`);
        for (const item of items) console.log(`  ${item}`);
      };
      console.log(`“${workspace.name}” will manage the Church Library:`);
      console.log('its songs and backgrounds become the church’s, for every workspace.');
      list('Songs that become the church’s', plan.songs);
      list('Backgrounds that become the church’s', plan.backgrounds);
      list(
        'Church songs this workspace changed; its version replaces them church-wide, also in workspaces without their own',
        plan.overrides,
      );
      list('Church songs and backgrounds this workspace removed, which reappear', plan.hidden);
      console.log('From then on, its additions, edits and removals change the Church Library.');
    } else {
      console.log(`“${workspace.name}” will stop managing the Church Library.`);
      console.log('The Church Library stays as it is. New songs and backgrounds stay in the');
      console.log('workspace, and edits to church songs become the workspace’s own versions.');
    }
    if (!yes) {
      console.log('Nothing was changed. Run again with --yes to do this.');
      break;
    }
    instance.setManageLibrary(id, on);
    if (on) {
      const moved = moveFilesToChurch(dataDir, id);
      console.log(`Done; ${moved} files moved to the Church Library.`);
    } else {
      console.log('Done.');
    }
    console.log('Connected computers receive the change at their next sync, within a minute.');
    break;
  }
  case 'device list':
    table(
      instance.listDevices(rest[0]).map((d) => ({
        id: d.id,
        workspace: d.workspaceId,
        name: d.name,
        lastSeen: d.lastSeenAt,
        revoked: d.revokedAt ?? '',
      })),
    );
    break;
  case 'device revoke': {
    const [id] = rest;
    if (!id) fail('Usage: device revoke <device-id>');
    console.log(instance.revokeDevice(id) ? 'Revoked.' : 'No such device, or already revoked.');
    console.log('A connected device is disconnected within a minute, or when the server restarts.');
    break;
  }
  case 'settings show':
    console.log(JSON.stringify(instance.churchSettings(), null, 2));
    console.log(`Keys: ${Object.keys(ChurchSettingsSchema.shape).join(', ')}`);
    break;
  case 'settings set': {
    const [key, raw] = rest;
    if (!key || raw === undefined) fail('Usage: settings set <key> <json value>');
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    instance.setChurchSetting(key, value);
    console.log(JSON.stringify(instance.churchSettings(), null, 2));
    break;
  }
  case 'settings unset': {
    const [key] = rest;
    if (!key) fail('Usage: settings unset <key>');
    instance.unsetChurchSetting(key);
    console.log(JSON.stringify(instance.churchSettings(), null, 2));
    break;
  }
  case 'import legacy': {
    const dryRun = rest.includes('--dry-run');
    const [workspaceId, source] = rest.filter((arg) => arg !== '--dry-run');
    if (!workspaceId || !source) fail('Usage: import legacy <workspace-id> <file|-> [--dry-run]');
    const workspace = instance.getWorkspace(workspaceId);
    if (!workspace) fail(`No workspace ${workspaceId}. See: workspace list`);
    const songs = parseLegacyExport(readFileSync(source === '-' ? 0 : source, 'utf8'));
    if (songs.length === 0) fail('The export has no songs; nothing was changed.');
    const plan = planLegacyImport(instance, workspaceId, songs, new Date().toISOString());
    console.log(`Workspace “${workspace.name}”, ${songs.length} legacy songs read.`);
    console.log(
      `New ${plan.added}, changed ${plan.updated}, unchanged ${plan.unchanged}, removed ${plan.removed}, ` +
        `without title or lyrics ${plan.skipped}.`,
    );
    if (plan.kept.length > 0) {
      console.log(`Edited in Worship Q, so left as they are: ${plan.kept.join(', ')}`);
    }
    if (dryRun) {
      console.log('Dry run: nothing was changed.');
    } else {
      applyLegacyImport(instance, workspaceId, plan);
      console.log('Imported. Connected computers receive the songs at their next sync.');
    }
    break;
  }
  case 'deck convert': {
    const [file, outDir] = rest;
    if (!file || !outDir) fail('Usage: deck convert <file> <out-dir>');
    const started = Date.now();
    const deck = await convertDeck(resolve(file), resolve(outDir), {
      ...deckTools(),
      workDir: join(resolve(outDir), '.work'),
    });
    writeFileSync(join(outDir, 'deck.json'), JSON.stringify(deck, null, 2));
    const slides = new Set(deck.pages.map((p) => p.slide)).size;
    console.log(
      `${deck.pages.length} images (${deck.width}×${deck.height}) from ${slides} slides ` +
        `in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
    );
    break;
  }
  default:
    console.log(
      [
        'workspace create <name> | workspace list | workspace code <id>',
        'workspace library <id> on|off [--yes]',
        'device list [workspace-id] | device revoke <device-id>',
        'settings show | settings set <key> <json> | settings unset <key>',
        'import legacy <workspace-id> <file|-> [--dry-run]',
        'deck convert <file> <out-dir>',
      ].join('\n'),
    );
}
instance.db.close();
