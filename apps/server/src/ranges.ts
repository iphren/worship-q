/**
 * Sending a stored file, whole or in the part a `Range` header asks for. Safari plays a video
 * only from a server that sends parts of it on request.
 */
import { createReadStream, statSync } from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The part of a file a `Range` header asks for, inclusive at both ends. Null means the whole
 * file: no header, one this does not understand, or several ranges, which browsers playing
 * video never ask for.
 */
export function byteRange(
  header: string | undefined,
  size: number,
): { start: number; end: number } | 'unsatisfiable' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match) return null;
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return null;
  if (from === '') {
    // The last `to` bytes.
    const length = Number(to);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(from);
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}

const TYPES: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  png: 'image/png',
};

/** The type a stored background, slide image or video is sent as, by its name. */
function fileType(name: string): string {
  return TYPES[name.toLowerCase().split('.').pop() ?? ''] ?? 'image/jpeg';
}

/** Sends a file, or the part of it asked for; caching headers are the caller's. */
export function sendFile(request: FastifyRequest, reply: FastifyReply, path: string, name: string) {
  const { size } = statSync(path);
  reply.header('accept-ranges', 'bytes');
  reply.type(fileType(name));
  const range = byteRange(request.headers.range, size);
  if (range === 'unsatisfiable') {
    reply.header('content-range', `bytes */${size}`);
    return reply.code(416).send();
  }
  if (range) {
    reply.code(206);
    reply.header('content-range', `bytes ${range.start}-${range.end}/${size}`);
    reply.header('content-length', range.end - range.start + 1);
    return reply.send(createReadStream(path, range));
  }
  reply.header('content-length', size);
  return reply.send(createReadStream(path));
}
