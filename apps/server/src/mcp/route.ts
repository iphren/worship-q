/**
 * The MCP endpoint (MCP plan, C5): Streamable HTTP at `/mcp`, stateless, answering in JSON.
 * Each request carries an access token from `/oauth/token`; the tools act for that token's
 * MCP user, in the workspaces they reach at that moment.
 */
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Relay } from '@worship-q/relay';
import type { Instance } from '../instance';
import type { OidcClient } from '../oidc';
import { McpContent, SongKeyCache, type McpBible } from './content';
import { McpOAuth, protectedResourceMetadataUrl, SCOPE } from './oauth';
import { createMcpServer } from './tools';

export interface McpRoutesConfig {
  instance: Instance;
  relay: Pick<Relay, 'contentChanged' | 'contentChangedAll'>;
  bible?: McpBible | null;
  oidc: OidcClient;
  /** This server's public address, with no trailing slash. */
  publicUrl: string;
  /** The instance's name, shown to assistants. */
  name: string;
  /** For rate limits in tests. */
  clock?: () => number;
}

/** Registers the OAuth server and the MCP endpoint; returns the OAuth server for the callback. */
export async function registerMcpRoutes(
  app: FastifyInstance,
  config: McpRoutesConfig,
): Promise<McpOAuth> {
  const { instance, publicUrl } = config;
  const oauth = new McpOAuth({ instance, oidc: config.oidc, publicUrl, clock: config.clock });
  await oauth.register(app);
  const keyCache = new SongKeyCache();

  const unauthorized = (reply: FastifyReply, error?: 'invalid_token') =>
    reply
      .code(401)
      .header(
        'www-authenticate',
        `Bearer realm="worship-q", resource_metadata="${protectedResourceMetadataUrl(publicUrl)}", scope="${SCOPE}"${error ? `, error="${error}"` : ''}`,
      )
      .send({ error: error ?? 'unauthorized' });

  const handle = async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) return unauthorized(reply);
    const user = instance.mcp.authenticate(token);
    if (!user) return unauthorized(reply, 'invalid_token');

    const content = new McpContent(
      { instance, relay: config.relay, bible: config.bible ?? null, keyCache },
      user,
    );
    const server = createMcpServer(content, config.name);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }
      const webRequest = new Request(`${publicUrl}${request.url}`, {
        method: request.method,
        headers,
      });
      const response = await transport.handleRequest(webRequest, { parsedBody: request.body });
      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'content-length') reply.header(key, value);
      });
      reply.header('cache-control', 'no-store');
      const body = await response.text();
      return reply.send(body === '' ? undefined : body);
    } finally {
      await server.close().catch(() => undefined);
    }
  };

  app.post('/mcp', handle);
  // Stateless: there is no stream to open and no session to end.
  app.get('/mcp', async (_request, reply) =>
    reply.code(405).header('allow', 'POST').send({ error: 'method-not-allowed' }),
  );
  app.delete('/mcp', async (_request, reply) =>
    reply.code(405).header('allow', 'POST').send({ error: 'method-not-allowed' }),
  );
  return oauth;
}
