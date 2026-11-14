import { describe, expect, it } from 'vitest';
import { decodePage, pageTitle, titleFromHtml, type PageStart } from './pageTitle';

const page = (html: string, contentType: string | null = 'text/html'): PageStart => ({
  contentType,
  body: new TextEncoder().encode(html),
});

describe('page titles', () => {
  it('takes the og:title before the <title>', () => {
    const html = `<head><title>Live | St Example</title>
      <meta content="Sunday &amp; evening" property="og:title"></head>`;
    expect(titleFromHtml(html)).toBe('Sunday & evening');
  });

  it('falls back to the <title>, tidied', () => {
    expect(titleFromHtml('<title lang="en">\n  Hymns &#8211; &#x4E2D;  </title>')).toBe(
      'Hymns – 中',
    );
    expect(titleFromHtml('<meta property="og:title" content=" "><title>Plain</title>')).toBe(
      'Plain',
    );
  });

  it('has none for a page without one', () => {
    expect(titleFromHtml('<html><body>Hello</body></html>')).toBeNull();
    expect(titleFromHtml('<title>   </title>')).toBeNull();
  });

  it('cuts a very long title', () => {
    const title = titleFromHtml(`<title>${'a'.repeat(300)}</title>`)!;
    expect(title).toHaveLength(120);
    expect(title.endsWith('…')).toBe(true);
  });

  it('reads the character set the header or the page names', () => {
    // 中文 in GBK.
    const gbk = new Uint8Array([
      ...new TextEncoder().encode('<meta charset="gbk"><title>'),
      0xd6,
      0xd0,
      0xce,
      0xc4,
      ...new TextEncoder().encode('</title>'),
    ]);
    expect(titleFromHtml(decodePage({ contentType: 'text/html', body: gbk }))).toBe('中文');
    expect(titleFromHtml(decodePage({ contentType: 'text/html; charset=GBK', body: gbk }))).toBe(
      '中文',
    );
    expect(decodePage(page('<title>é</title>', 'text/html; charset=nonsense'))).toBe(
      '<title>é</title>',
    );
  });

  it('asks YouTube for a video’s title', async () => {
    const asked: string[] = [];
    const title = await pageTitle('https://youtu.be/dQw4w9WgXcQ', async (url) => {
      asked.push(url);
      return page(JSON.stringify({ title: 'Never Gonna Give You Up' }), 'application/json');
    });
    expect(title).toBe('Never Gonna Give You Up');
    expect(asked).toEqual([
      'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fyoutu.be%2FdQw4w9WgXcQ',
    ]);
  });

  it('gives up quietly when the site cannot be read', async () => {
    expect(
      await pageTitle('https://example.org/', () => Promise.reject(new Error('timed out'))),
    ).toBeNull();
    expect(await pageTitle('https://youtu.be/dQw4w9WgXcQ', async () => page('<html>'))).toBeNull();
  });
});
