import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';

// The public site at worship-q.com, built again whenever a release is published.
const REPO = 'iphren/worship-q';

interface Release {
  tag_name: string;
  published_at: string;
  html_url: string;
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

/** Writes the release's version, date and notes link into the page. */
function releaseInfo(): Plugin {
  return {
    name: 'release-info',
    async transformIndexHtml(html) {
      const release = await latestRelease().catch(() => null);
      if (!release) {
        // A deployed page must name the version it serves.
        if (process.env.CI) throw new Error(`No published release found for ${REPO}`);
        console.warn('No published release found; the page shows placeholders.');
      }
      const date = release
        ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(
            new Date(release.published_at),
          )
        : '—';
      return html
        .replaceAll('%RELEASE_VERSION%', release?.tag_name.replace(/^v/, '') ?? '—')
        .replaceAll('%RELEASE_DATE%', date)
        .replaceAll('%RELEASE_URL%', release?.html_url ?? `https://github.com/${REPO}/releases`);
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), releaseInfo()],
});
