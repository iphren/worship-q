/**
 * The MCP tools an assistant sees (MCP plan, C5): names, descriptions and argument schemas,
 * each a thin wrapper over `McpContent`. What the tools do, and every rule they keep, lives
 * there; this file only says it in the assistant's terms.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { McpContent, McpToolError, type ItemInput } from './content';

export const SERVER_INSTRUCTIONS = `Worship Q keeps a church's song library and its run sheets: one per date per workspace, an ordered list of songs, Bible passages, websites and slides.

Never guess which workspace or which date a message means. Before changing a run sheet, be sure of both:
- Workspace: if the person reaches more than one and the message does not clearly name one, ask which.
- Date: chat messages name dates loosely ("Saturday", "this Sunday", "next week") and may be forwarded days after they were written. Work out the date from list_workspaces, and if it could be more than one date (for example "Saturday" when today is Saturday, "next Sunday" meaning this coming one or the one after, or a message that may be old), ask the person, saying the date you think they mean with its weekday ("Saturday 5 December?").
When in doubt, ask before writing. Every run sheet result gives the workspace name, date and weekday: repeat them to the person when you report what you did.

Typical work, such as "here are the songs for this Saturday":
1. Call list_workspaces. It gives each workspace's today, meeting days and next meeting date, so you can turn "this Saturday" or "next Sunday" into a date (YYYY-MM-DD). Confirm the workspace and date with the person when they are unclear, as above.
2. Call match_songs with every title. "exact" means the library has it; for "likely", check the candidates (get_song if needed) or ask; for "none", the song is new.
3. For each new song, call create_song with its full lyrics. Only use lyrics you were given or are certain of; never invent lyrics, and ask the person for them when you do not have them.
4. Call add_to_run_sheet once with all items in order (existing songs by songId, passages by reference, websites by URL).
5. Tell the person what you added and what you created, naming the workspace and the date with its weekday.

add_to_run_sheet and copy_run_sheet_items refuse a date that is already past, or not one of the workspace's meeting days, with "confirm-date". Then ask the person whether that date is really meant; only if they say yes, call again with confirmed: true. Never set confirmed without asking.

To repeat items from another week (e.g. "announcements like last week"), read that date with get_run_sheet and copy the chosen items with copy_run_sheet_items.

Lyrics format: plain text. Each verse or chorus is a block of lines, blocks separated by one blank line. No section labels such as [Chorus] or "Verse 1" (they would be shown on screen); write a repeated chorus out again where it is sung. For songs in two languages, interleave each line with its translation, line by line.

Before editing a song, read it with get_song and pass its revision as expectedRevision. Songs are never deleted from the library here; remove_run_sheet_items only takes items off a run sheet.`;

const workspace = z
  .string()
  .max(100)
  .optional()
  .describe(
    'Workspace id or exact name from list_workspaces. May be left out when you have only one.',
  );
const date = (what = 'The run sheet date') => z.string().describe(`${what}, as YYYY-MM-DD`);
const confirmed = z
  .boolean()
  .optional()
  .describe(
    'Set only after the person confirmed the date, when a previous call answered "confirm-date" (a past date, or not a meeting day). Never set it without asking them.',
  );
const after = z
  .string()
  .max(100)
  .optional()
  .describe(
    'Where to put the new items: "start", "end" (the default), or the itemId to put them after.',
  );

const songFields = {
  title: z.string().max(400).describe('The song title as the church knows it.'),
  lyrics: z
    .string()
    .max(60000)
    .describe('Full lyrics: blocks of lines separated by one blank line, no section labels.'),
  author: z
    .string()
    .max(300)
    .optional()
    .describe('Writers as one line, e.g. "Words: A; Music: B".'),
  copyright: z.string().max(300).optional(),
  ccli: z.string().max(40).optional().describe('CCLI song number, digits only.'),
  year: z.number().int().optional().describe('Year written, when known.'),
};

function ok(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function refused(error: unknown): CallToolResult {
  if (error instanceof McpToolError) {
    const detail =
      Object.keys(error.detail).length > 0 ? `\n${JSON.stringify(error.detail, null, 2)}` : '';
    return {
      isError: true,
      content: [{ type: 'text', text: `${error.code}: ${error.message}${detail}` }],
    };
  }
  throw error;
}

async function run(work: () => unknown): Promise<CallToolResult> {
  try {
    return ok(await work());
  } catch (error) {
    return refused(error);
  }
}

/** An MCP server for one request, its tools acting for one user. */
export function createMcpServer(content: McpContent, name: string): McpServer {
  const server = new McpServer(
    { name: 'worship-q', title: `Worship Q — ${name}`, version: '1.0.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );
  const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
  const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

  server.registerTool(
    'list_workspaces',
    {
      title: 'List workspaces',
      description:
        "The workspaces you can reach, each with its timezone, today's date there, meeting days, next meeting date and Bible versions.",
      annotations: read,
    },
    () => run(() => ({ workspaces: content.listWorkspaces() })),
  );

  server.registerTool(
    'list_run_sheets',
    {
      title: 'List run sheets',
      description:
        'Dates that have a run sheet, with how many items each holds. Defaults to four weeks either side of today.',
      inputSchema: {
        workspace,
        from: z.string().optional().describe('First date, YYYY-MM-DD.'),
        to: z.string().optional().describe('Last date, YYYY-MM-DD.'),
      },
      annotations: read,
    },
    (args) => run(() => content.listRunSheets(args.workspace, args.from, args.to)),
  );

  server.registerTool(
    'get_run_sheet',
    {
      title: 'Get a run sheet',
      description:
        'The items of one date\'s run sheet in order, each with its itemId, songId, kind (song, bible, website, slides, pdf, image, video) and title. "live" means it is being presented now.',
      inputSchema: { workspace, date: date() },
      annotations: read,
    },
    (args) => run(() => content.getRunSheet(args.workspace, args.date)),
  );

  server.registerTool(
    'search_songs',
    {
      title: 'Search songs',
      description:
        'Searches the library like the app does: by title or lyrics, in either Chinese script, pinyin or initials. An empty query lists the latest changed.',
      inputSchema: {
        workspace,
        query: z.string().max(200),
        limit: z.number().int().min(1).max(50).optional(),
      },
      annotations: read,
    },
    (args) => run(() => content.searchSongs(args.workspace, args.query, args.limit)),
  );

  server.registerTool(
    'match_songs',
    {
      title: 'Match song titles',
      description:
        'Checks a list of titles (e.g. read from a chat message) against the library. Each gets "exact" (same title, ignoring case, punctuation and Traditional/Simplified), "likely" (similar songs found) or "none" (not in the library), with candidates.',
      inputSchema: { workspace, titles: z.array(z.string().max(400)).min(1).max(30) },
      annotations: read,
    },
    (args) => run(() => content.matchSongs(args.workspace, args.titles)),
  );

  server.registerTool(
    'get_song',
    {
      title: 'Get a song',
      description: 'A song with its lyrics, author, CCLI number and current revision.',
      inputSchema: { workspace, songId: z.string().max(100) },
      annotations: read,
    },
    (args) => run(() => content.getSong(args.workspace, args.songId)),
  );

  server.registerTool(
    'create_song',
    {
      title: 'Add a song to the library',
      description:
        'Adds a new song of lyrics to the library. Refused when a song with the same title exists, unless allowDuplicate is true (only for a genuinely different song with the same title).',
      inputSchema: {
        workspace,
        ...songFields,
        allowDuplicate: z.boolean().optional(),
      },
      annotations: write,
    },
    (args) => run(() => content.createSong(args.workspace, args)),
  );

  server.registerTool(
    'update_song',
    {
      title: 'Edit a song',
      description:
        "Edits a song of lyrics. Give only the fields to change, and expectedRevision from get_song. In a workspace that does not manage the Church Library, editing a church song makes the workspace's own version of it.",
      inputSchema: {
        workspace,
        songId: z.string().max(100),
        expectedRevision: z.number().int().min(1),
        title: songFields.title.optional(),
        lyrics: songFields.lyrics.optional(),
        author: songFields.author,
        copyright: songFields.copyright,
        ccli: z.string().max(40).nullable().optional().describe('CCLI song number; null to clear.'),
        year: z.number().int().nullable().optional().describe('Year written; null to clear.'),
      },
      annotations: { ...write, idempotentHint: true },
    },
    (args) =>
      run(() =>
        content.updateSong(args.workspace, args.songId, args.expectedRevision, {
          title: args.title,
          lyrics: args.lyrics,
          author: args.author,
          copyright: args.copyright,
          ccli: args.ccli,
          year: args.year,
        }),
      ),
  );

  server.registerTool(
    'add_to_run_sheet',
    {
      title: 'Add items to a run sheet',
      description:
        'Adds items, in order, to a date\'s run sheet (made if there is none). Confirm the workspace and date with the person first if the message leaves either unclear. Each item is exactly one of: {"song": songId}, {"passage": "John 3:16-18", "versions"?: ["NIVUK"]} or {"website": url, "title"?: text}. Passages use the workspace\'s Bible versions unless given. If any item fails, nothing is added.',
      inputSchema: {
        workspace,
        date: date(),
        items: z
          .array(
            z.object({
              song: z.string().max(100).optional().describe('songId of a library song.'),
              passage: z
                .string()
                .max(100)
                .optional()
                .describe('A Bible reference, in English or Chinese.'),
              versions: z
                .array(z.string().max(20))
                .max(2)
                .optional()
                .describe('Bible version ids, at most two.'),
              website: z.string().max(2000).optional().describe('An http or https address.'),
              title: z.string().max(400).optional().describe("A website's title."),
            }),
          )
          .min(1)
          .max(30),
        after,
        confirmed,
      },
      annotations: write,
    },
    (args) =>
      run(async () => {
        const items: ItemInput[] = args.items.map((item, index) => {
          const kinds = [item.song, item.passage, item.website].filter((v) => v !== undefined);
          if (kinds.length !== 1) {
            throw new McpToolError(
              'no-items',
              `Item ${index + 1} must have exactly one of song, passage or website.`,
            );
          }
          if (item.song !== undefined) return { song: item.song };
          if (item.passage !== undefined) return { passage: item.passage, versions: item.versions };
          return { website: item.website!, title: item.title };
        });
        return content.addToRunSheet(args.workspace, args.date, items, args.after, args.confirmed);
      }),
  );

  server.registerTool(
    'move_run_sheet_item',
    {
      title: 'Move a run sheet item',
      description:
        'Moves one item within its run sheet: after another item, or to the "start" or "end".',
      inputSchema: {
        workspace,
        date: date(),
        itemId: z.string().max(100),
        after: z.string().max(100).describe('"start", "end", or the itemId to put it after.'),
      },
      annotations: { ...write, idempotentHint: true },
    },
    (args) =>
      run(() => content.moveRunSheetItem(args.workspace, args.date, args.itemId, args.after)),
  );

  server.registerTool(
    'remove_run_sheet_items',
    {
      title: 'Remove run sheet items',
      description:
        'Takes items off a run sheet. The songs stay in the library. If any itemId is not on the run sheet, nothing is removed.',
      inputSchema: {
        workspace,
        date: date(),
        itemIds: z.array(z.string().max(100)).min(1).max(100),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (args) => run(() => content.removeRunSheetItems(args.workspace, args.date, args.itemIds)),
  );

  server.registerTool(
    'copy_run_sheet_items',
    {
      title: 'Copy items from another date',
      description:
        "Copies items from one date's run sheet to another's, such as last week's announcements. Confirm both dates with the person if the message leaves them unclear. Leave itemIds out to copy them all. The copies point at the same songs; the source is not changed.",
      inputSchema: {
        workspace,
        fromDate: date('The date to copy from'),
        toDate: date('The date to copy to'),
        itemIds: z.array(z.string().max(100)).max(120).optional(),
        after,
        confirmed,
      },
      annotations: write,
    },
    (args) =>
      run(() =>
        content.copyRunSheetItems(
          args.workspace,
          args.fromDate,
          args.toDate,
          args.itemIds,
          args.after,
          args.confirmed,
        ),
      ),
  );

  return server;
}
