/**
 * Administration from the server's shell, until the admin web app exists:
 *
 *   workspace create <name>     create a workspace and print its connection code
 *   workspace list
 *   workspace code <id>         replace a workspace's connection code
 *   device list [workspace-id]
 *   device revoke <device-id>
 *   settings show
 *   settings set <key> <json>   e.g. settings set linesPerPiece 2
 *   settings unset <key>
 *   import legacy <workspace-id> <file|-> [--dry-run]
 *                               songs exported from the legacy lyrics service
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ChurchSettingsSchema } from '@worship-q/protocol';
import { openDatabase } from './db';
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
      instance
        .listWorkspaces()
        .map((w) => ({ id: w.id, name: w.name, content: w.contentId ?? '(empty)' })),
    );
    break;
  case 'workspace code': {
    const [id] = rest;
    if (!id) fail('Usage: workspace code <workspace-id>');
    console.log(`New connection code: ${instance.rotateCode(id)}`);
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
  default:
    console.log(
      [
        'workspace create <name> | workspace list | workspace code <id>',
        'device list [workspace-id] | device revoke <device-id>',
        'settings show | settings set <key> <json> | settings unset <key>',
        'import legacy <workspace-id> <file|-> [--dry-run]',
      ].join('\n'),
    );
}
instance.db.close();
