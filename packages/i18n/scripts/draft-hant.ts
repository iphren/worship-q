/**
 * Drafts the Traditional Chinese catalogues from the Simplified ones (translation plan T5).
 *
 *   pnpm --filter @worship-q/i18n draft-hant            new keys only, in every catalogue
 *   pnpm --filter @worship-q/i18n draft-hant --keys a,b  those keys again, and new ones
 *   pnpm --filter @worship-q/i18n draft-hant --all       every key again
 *   pnpm --filter @worship-q/i18n draft-hant --file in out   any text file, such as a page
 *
 * Existing Traditional messages are kept unless named, so corrections made by hand in
 * src/zh-hant/ survive; a correction worth keeping for every draft goes into FIXES (hant.ts).
 * Then run Prettier on what changed and read the drafts through.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { toTraditional } from './hant';

const SRC = resolve(import.meta.dirname, '../src');
const CATALOGUES = {
  common: { type: 'CommonKey', from: '../en/common', exportName: 'common', keyOf: false },
  desktop: { type: 'DesktopKey', from: '../en/desktop', exportName: 'desktop', keyOf: false },
  remote: { type: 'remote', from: '../en/remote', exportName: 'remote', keyOf: true },
  admin: { type: 'admin', from: '../en/admin', exportName: 'admin', keyOf: true },
  output: { type: 'output', from: '../en/output', exportName: 'output', keyOf: true },
} as const;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

if (flag('--file')) {
  const [input, output] = args.slice(args.indexOf('--file') + 1);
  if (!input || !output) throw new Error('--file needs an input and an output path');
  const cwd = process.env.INIT_CWD ?? process.cwd();
  writeFileSync(resolve(cwd, output), toTraditional(readFileSync(resolve(cwd, input), 'utf8')));
  console.log(`Drafted ${output}`);
  process.exit(0);
}

const all = flag('--all');
const named = new Set((value('--keys') ?? '').split(',').filter(Boolean));

const quote = (text: string) => `'${text.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const key = (name: string) => (/^[A-Za-z_$][\w$]*$/.test(name) ? name : quote(name));

for (const [name, info] of Object.entries(CATALOGUES)) {
  const hans = (await import(`../src/zh-hans/${name}.ts`))[info.exportName] as Record<
    string,
    string
  >;
  const file = resolve(SRC, 'zh-hant', `${name}.ts`);
  const hant: Record<string, string> = existsSync(file)
    ? ((await import(`../src/zh-hant/${name}.ts`))[info.exportName] as Record<string, string>)
    : {};
  let drafted = 0;
  const lines = Object.entries(hans).map(([k, simplified]) => {
    const redo = all || named.has(k) || !(k in hant);
    if (redo) drafted += 1;
    return `  ${key(k)}: ${quote(redo ? toTraditional(simplified) : hant[k]!)},`;
  });
  const type = info.keyOf ? `keyof typeof en` : info.type;
  const imports = info.keyOf
    ? `import type { ${info.exportName} as en } from '${info.from}';`
    : `import type { ${info.type} } from '${info.from}';`;
  writeFileSync(
    file,
    `/** The ${name} text in Traditional Chinese: drafted from Simplified by scripts/draft-hant.ts, then read through. */
${imports}

export const ${info.exportName}: Record<${type}, string> = {
${lines.join('\n')}
};
`,
  );
  console.log(`${name}: ${drafted} drafted`);
}
