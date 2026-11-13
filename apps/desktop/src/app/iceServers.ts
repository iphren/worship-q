/**
 * The ICE servers for live audio connections (A10; task breakdown M5.2): asked of the church
 * server before every new connection and ICE restart, as a relay credential lasts ten
 * minutes, reusing one answer for at most five. With no server, or one that cannot answer,
 * the list is empty: devices on the venue network still connect by their own addresses.
 */
import type { IceServer } from '@worship-q/protocol';

/** One answer is reused for at most this long. */
export const ICE_REUSE_MS = 5 * 60 * 1000;

export class IceServers {
  private cached: { servers: IceServer[]; at: number } | null = null;

  constructor(
    /** Fetches `GET /api/v1/ice`; null when no server is joined. */
    private readonly fetchList: (() => Promise<{ iceServers: IceServer[] }>) | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async get(): Promise<IceServer[]> {
    const now = this.now();
    if (this.cached && now - this.cached.at < ICE_REUSE_MS) return this.cached.servers;
    if (!this.fetchList) return [];
    try {
      const { iceServers } = await this.fetchList();
      const servers = Array.isArray(iceServers) ? iceServers : [];
      this.cached = { servers, at: now };
      return servers;
    } catch {
      return [];
    }
  }

  /** The server's settings may have changed: the next connection asks again. */
  forget(): void {
    this.cached = null;
  }
}
