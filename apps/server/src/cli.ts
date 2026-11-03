/**
 * Administration from the server's shell. The admin web app at /admin/ does the same
 * (phase 3); the commands stay as the way back in when sign-in is unavailable (D35).
 *
 *   admin add <email>           make an e-mail address an administrator
 *   admin list
 *   admin remove <email>
 *   workspace create <name>     create a workspace and print its connection code
 *   workspace list
 *   workspace code <id>         replace a workspace's connection code
 *   workspace library <id> <types>|all|none [--yes]
 *                               what the workspace manages in the Church Library, of
 *                               songs, backgrounds, slides and websites (comma-separated)
 *   workspace library-take <id> <types> [--yes]
 *                               takes the Church Library's items of those types into the
 *                               workspace's own library, which must not manage them
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
import { ChurchSettingsSchema, LIBRARY_TYPES, type LibraryType } from '@worship-q/protocol';
import { openDatabase } from './db';
import { convertDeck, deckTools } from './decks/convert';
import { moveFilesToChurch, moveFilesToWorkspace } from './files';
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

/** Library types from `all`, `none`, `on`, `off` or a comma-separated list; null if unknown. */
function parseTypes(value: string | undefined): LibraryType[] | null {
  if (value === 'all' || value === 'on') return [...LIBRARY_TYPES];
  if (value === 'none' || value === 'off') return [];
  const names = (value ?? '').split(',').filter(Boolean);
  if (names.length === 0) return null;
  if (!names.every((name) => (LIBRARY_TYPES as readonly string[]).includes(name))) return null;
  return LIBRARY_TYPES.filter((type) => names.includes(type));
}

const typeList = (types: readonly string[]) => (types.length > 0 ? types.join(', ') : 'nothing');

function table(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return console.log('(none)');
  console.table(rows);
}

switch (`${area} ${action}`) {
  case 'admin add': {
    const [email] = rest;
    if (!email) fail('Usage: admin add <email>');
    const admin = instance.addAdministrator(email, null);
    console.log(`${admin.email} is an administrator. Sign in at <server>/admin/.`);
    if (!instance.listWorkspaces().some((w) => w.codesEnabled)) {
      console.log('Connection codes are now off; new computers pair from the admin app.');
    }
    break;
  }
  case 'admin list':
    table(
      instance.listAdministrators().map((a) => ({
        email: a.email,
        name: a.name ?? '',
        lastSignIn: a.lastSignInAt ?? 'never',
        addedBy: a.addedBy ? (instance.getAdministrator(a.addedBy)?.email ?? a.addedBy) : '',
      })),
    );
    break;
  case 'admin remove': {
    const [email] = rest;
    if (!email) fail('Usage: admin remove <email>');
    const admin = instance.findAdministrator(email);
    if (!admin) fail(`${email} is not an administrator.`);
    instance.removeAdministrator(admin.id);
    console.log('Removed.');
    break;
  }
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
        churchLibrary: w.libraryTypes.join(', '),
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
    const types = parseTypes(setting);
    if (!id || !types) {
      fail(`Usage: workspace library <workspace-id> <types>|all|none [--yes]
  types: ${LIBRARY_TYPES.join(',')}`);
    }
    const workspace = instance.getWorkspace(id);
    if (!workspace) fail(`No workspace ${id}. See: workspace list`);
    if (types.join() === workspace.libraryTypes.join()) {
      console.log(`“${workspace.name}” already manages ${typeList(types)} in the Church Library.`);
      break;
    }
    const added = types.filter((type) => !workspace.libraryTypes.includes(type));
    const dropped = workspace.libraryTypes.filter((type) => !types.includes(type));
    console.log(
      `“${workspace.name}” will manage ${typeList(types)} in the Church Library (now ${typeList(workspace.libraryTypes)}).`,
    );
    if (added.length > 0) {
      const plan = instance.libraryPlan(id, added);
      const list = (title: string, items: string[]) => {
        console.log(`${title}: ${items.length}`);
        for (const item of items) console.log(`  ${item}`);
      };
      console.log(`Its ${typeList(added)} become the church’s, for every workspace.`);
      if (added.includes('songs')) list('Songs that become the church’s', plan.songs);
      if (added.includes('slides')) list('Slides that become the church’s', plan.slides);
      if (added.includes('websites')) list('Websites that become the church’s', plan.websites);
      if (added.includes('backgrounds')) {
        list('Backgrounds that become the church’s', plan.backgrounds);
      }
      list(
        'Church items this workspace changed; its version replaces them church-wide, also in workspaces without their own',
        plan.overrides
          .filter((o) => !o.usesChurchVersion)
          .map((o) => (o.churchChangedSince ? `${o.title} (the church’s changed since)` : o.title)),
      );
      list(
        'Church items this workspace made a version of but uses the church’s; the version is dropped',
        plan.overrides.filter((o) => o.usesChurchVersion).map((o) => o.title),
      );
      list('Church items this workspace removed, which reappear', plan.hidden);
      console.log(
        'From then on, its additions, edits and removals of these change the Church Library.',
      );
    }
    if (dropped.length > 0) {
      console.log(`It stops managing ${typeList(dropped)}. The Church Library stays as it is:`);
      console.log('new ones stay in the workspace, and edits to the church’s become the');
      console.log('workspace’s own versions. To take the church’s into the workspace, see');
      console.log('workspace library-take.');
    }
    if (!yes) {
      console.log('Nothing was changed. Run again with --yes to do this.');
      break;
    }
    const files = instance.setLibraryTypes(id, types);
    const moved = moveFilesToChurch(dataDir, id, files);
    console.log(moved > 0 ? `Done; ${moved} files moved to the Church Library.` : 'Done.');
    console.log('Connected computers receive the change at their next sync, within a minute.');
    break;
  }
  case 'workspace library-take': {
    const yes = rest.includes('--yes');
    const [id, setting] = rest.filter((arg) => arg !== '--yes');
    const types = parseTypes(setting);
    if (!id || !types || types.length === 0) {
      fail(`Usage: workspace library-take <workspace-id> <types> [--yes]
  types: ${LIBRARY_TYPES.join(',')}`);
    }
    const workspace = instance.getWorkspace(id);
    if (!workspace) fail(`No workspace ${id}. See: workspace list`);
    const managed = types.filter((type) => workspace.libraryTypes.includes(type));
    if (managed.length > 0) {
      fail(
        `“${workspace.name}” manages ${typeList(managed)} in the Church Library. Stop first: workspace library ${id} <types> --yes`,
      );
    }
    const plan = instance.takeFromChurch(id, types, yes);
    console.log(
      `The Church Library’s ${typeList(types)} ${yes ? 'were' : 'will be'} taken into “${workspace.name}”:`,
    );
    for (const type of types) {
      const items = plan.items.filter((item) => item.type === type);
      console.log(`${type}: ${items.length}`);
      for (const item of items) {
        console.log(
          `  ${item.title}${item.ownVersion ? ' (keeps the workspace’s own version)' : ''}`,
        );
      }
    }
    console.log('Every other workspace sees them deleted from the Church Library; one that made');
    console.log('its own version of one keeps that version as its own. They cannot be restored');
    console.log('to the Church Library afterwards.');
    if (!yes) {
      console.log('Nothing was changed. Run again with --yes to do this.');
      break;
    }
    const moved = moveFilesToWorkspace(dataDir, id, plan.files, plan.sharedFiles);
    console.log(`Done; ${moved} files moved to the workspace.`);
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
        'admin add <email> | admin list | admin remove <email>',
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
