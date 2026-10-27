import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

// The public site at worship-q.com, built again whenever a release is published.
const REPO = 'iphren/worship-q';
const RELEASES = `https://github.com/${REPO}/releases`;

/** The installer each download button serves, by the end of its file name. */
const INSTALLERS = {
  '%MAC_URL%': '_universal.dmg',
  '%WINDOWS_URL%': '_x64-setup.exe',
};

interface Release {
  tag_name: string;
  published_at: string;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
}

/** The latest published release, which the download buttons serve. */
async function latestRelease(): Promise<Release | null> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) return null;
  return (await response.json()) as Release;
}

/** Writes the release's installer links, version, date and notes link into the page. */
function releaseInfo(): Plugin {
  return {
    name: 'release-info',
    async transformIndexHtml(html) {
      const release = await latestRelease().catch(() => null);
      // A deployed page must link to real installers and name their version.
      const missing = (what: string) => {
        if (process.env.CI) throw new Error(`${what} for ${REPO}`);
        console.warn(`${what}; the page shows placeholders.`);
      };
      if (!release) missing('No published release found');

      for (const [placeholder, suffix] of Object.entries(INSTALLERS)) {
        const asset = release?.assets.find((a) => a.name.endsWith(suffix));
        if (release && !asset) missing(`${release.tag_name} has no *${suffix}`);
        html = html.replaceAll(placeholder, asset?.browser_download_url ?? RELEASES);
      }

      const date = release
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
            new Date(release.published_at),
          )
        : '—';
      return html
        .replaceAll('%RELEASE_VERSION%', release?.tag_name.replace(/^v/, '') ?? '—')
        .replaceAll('%RELEASE_DATE%', date)
        .replaceAll('%RELEASE_URL%', release?.html_url ?? RELEASES);
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), releaseInfo()],
});
