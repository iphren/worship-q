import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { answersBinding, askRelay, bindingRequest, RelayHealth, relayTarget } from './relayHealth';

const turn = (...urls: string[]) => ({ stun: [], turn: { urls, secret: 's' } });

describe('where the relay is asked', () => {
  it('has no target without a relay, or with only a TLS address', () => {
    expect(relayTarget({ stun: [], turn: null })).toBeNull();
    expect(relayTarget(turn('turns:t.example:5349'))).toBeNull();
  });

  it('takes the host and port of the first plain address', () => {
    expect(relayTarget(turn('turns:a.example', 'turn:t.example:3479?transport=udp'))).toEqual({
      host: 't.example',
      port: 3479,
    });
    expect(relayTarget(turn('turn:t.example'))).toEqual({ host: 't.example', port: 3478 });
    expect(relayTarget(turn('turn:[2001:db8::1]:3478'))).toEqual({
      host: '2001:db8::1',
      port: 3478,
    });
  });

  it('prefers the relay’s own listening address, keeping the port', () => {
    expect(relayTarget(turn('turn:t.example:3479'), ' 10.0.0.5 ')).toEqual({
      host: '10.0.0.5',
      port: 3479,
    });
  });
});

describe('the STUN answer', () => {
  const request = bindingRequest(Buffer.alloc(12, 7));
  const reply = (type: number) => {
    const message = Buffer.from(request);
    message.writeUInt16BE(type, 0);
    return message;
  };

  it('takes a success or an error for this request', () => {
    expect(answersBinding(request, reply(0x0101))).toBe(true);
    expect(answersBinding(request, reply(0x0111))).toBe(true);
  });

  it('refuses another type, another transaction, or a short packet', () => {
    expect(answersBinding(request, reply(0x0001))).toBe(false);
    const other = reply(0x0101);
    other[19] = 8;
    expect(answersBinding(request, other)).toBe(false);
    expect(answersBinding(request, Buffer.alloc(4))).toBe(false);
  });
});

describe('asking over UDP', () => {
  let server: Socket | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });

  const listen = (answer: boolean) =>
    new Promise<number>((resolve) => {
      const socket = createSocket('udp4');
      server = socket;
      socket.on('message', (message, from) => {
        if (!answer) return;
        const reply = Buffer.from(message);
        reply.writeUInt16BE(0x0101, 0);
        socket.send(reply, from.port, from.address);
      });
      socket.bind(0, '127.0.0.1', () => resolve(socket.address().port));
    });

  it('is true when a relay answers', async () => {
    const port = await listen(true);
    await expect(askRelay({ host: '127.0.0.1', port }, 500)).resolves.toBe(true);
  });

  it('is false when nothing answers', async () => {
    const port = await listen(false);
    await expect(askRelay({ host: '127.0.0.1', port }, 50)).resolves.toBe(false);
  });
});

describe('the relay’s health', () => {
  const log = () => ({ info: vi.fn(), warn: vi.fn() });

  it('is down only once every try went unanswered, and warns once', async () => {
    const logger = log();
    const ask = vi.fn(async () => false);
    const health = new RelayHealth(ask, logger, 3);
    expect(health.status).toBe('checking');
    await health.check();
    await health.check();
    expect(health.status).toBe('down');
    expect(ask).toHaveBeenCalledTimes(6);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('is fine when a later try answers, and says when it is back', async () => {
    const logger = log();
    let answers = [false, false, false, false, true];
    const health = new RelayHealth(async () => answers.shift() ?? false, logger, 3);
    await health.check();
    expect(health.status).toBe('down');
    await health.check();
    expect(health.status).toBe('ok');
    expect(logger.info).toHaveBeenCalledTimes(1);
    answers = [];
  });

  it('counts a failed ask as no answer', async () => {
    const health = new RelayHealth(() => Promise.reject(new Error('no')), log(), 1);
    await health.check();
    expect(health.status).toBe('down');
  });
});
