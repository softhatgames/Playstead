// The probe's stand-in for Playstead's host. It accepts the game's connection
// on a local socket, forwards frames to the viewer over a WebSocket and the
// viewer's input back to the game, and stamps the frame header's relay times
// on the way through. The message format is in README.md.
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { URL } from 'node:url';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { WebSocketServer } from 'ws';

/** Wall-clock milliseconds, on the same basis as the game's and the viewer's. */
export const now = () => performance.timeOrigin + performance.now();

const JSON_MESSAGE = 1;
const FRAME_MESSAGE = 2;
// A frame the game copied into a shared GPU surface: the header, then the
// surface's ID (on Windows, its handle in the shell's process) and slot. It
// goes to the desktop shell, which imports it.
const SURFACE_FRAME_MESSAGE = 3;
const RELAY_IN = 64;
const RELAY_OUT = 72;
// A preview never queues frames: one is on its way at a time, and a newer
// frame replaces one waiting to follow it.
const IN_FLIGHT = 1;

/** A Unix socket in the run folder, or a named pipe on Windows. */
export function gameAddress(runFolder) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\playstead-preview-${randomBytes(6).toString('hex')}`
    : join(runFolder, 'game.sock');
}

function encodeJson(message) {
  const body = Buffer.from(JSON.stringify(message));
  const prefix = Buffer.alloc(5);
  prefix.writeUInt32LE(body.length + 1, 0);
  prefix[4] = JSON_MESSAGE;
  return Buffer.concat([prefix, body]);
}

/**
 * Starts the relay. `onMessage` receives each JSON message from the game,
 * with the time it arrived.
 */
export async function startRelay(address, onMessage) {
  let game;
  let viewer;
  // The desktop shell's main process, for shared-surface frames, and its
  // process ID, which the game needs to share textures on Windows.
  let shell;
  let shellPid;
  let extraDelay = 0;
  let inFlight = 0;
  let waiting;
  const clockReplies = new Map();
  let clockId = 0;
  const counts = { framesIn: 0, droppedAtRelay: 0 };
  // Only the viewer given this token may connect: any local page can reach the port.
  const token = randomBytes(16).toString('hex');

  const targetFor = (type) => (type === SURFACE_FRAME_MESSAGE ? shell : viewer);

  function send(frame) {
    frame.payload.writeDoubleLE(now(), RELAY_OUT);
    inFlight += 1;
    targetFor(frame.type).send(frame.payload, { binary: true });
  }

  /** A surface the game will not hear about again goes back to it at once. */
  function drop(frame) {
    counts.droppedAtRelay += 1;
    if (frame.type === SURFACE_FRAME_MESSAGE) {
      game?.write(
        encodeJson({ type: 'released', slot: frame.payload.readInt32LE(84) }),
      );
    }
  }

  function forward(frame) {
    if (targetFor(frame.type)?.readyState !== 1) {
      drop(frame);
    } else if (inFlight >= IN_FLIGHT) {
      if (waiting) drop(waiting);
      waiting = frame;
    } else {
      send(frame);
    }
  }

  /** The viewer or shell has a frame: send the newest one waiting, if any. */
  function received() {
    inFlight = Math.max(0, inFlight - 1);
    if (
      waiting &&
      inFlight < IN_FLIGHT &&
      targetFor(waiting.type)?.readyState === 1
    ) {
      const next = waiting;
      waiting = undefined;
      send(next);
    }
  }

  function receive(type, payload, arrived) {
    if (type === FRAME_MESSAGE || type === SURFACE_FRAME_MESSAGE) {
      counts.framesIn += 1;
      payload.writeDoubleLE(arrived, RELAY_IN);
      const frame = { type, payload };
      if (extraDelay > 0) setTimeout(() => forward(frame), extraDelay);
      else forward(frame);
    } else if (type === JSON_MESSAGE) {
      const message = JSON.parse(payload.toString('utf8'));
      if (message.type === 'clock')
        clockReplies.get(message.id)?.(message.time);
      else onMessage(message, arrived);
    }
  }

  const sockets = createServer((socket) => {
    game?.destroy();
    game = socket;
    if (shellPid) socket.write(encodeJson({ type: 'shell', pid: shellPid }));
    let chunks = [];
    let have = 0;
    let need = -1;
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      have += chunk.length;
      for (;;) {
        if (need < 0) {
          if (have < 4) return;
          if (chunks[0].length < 4) chunks = [Buffer.concat(chunks, have)];
          need = 4 + chunks[0].readUInt32LE(0);
        }
        if (have < need) return;
        const arrived = now();
        const whole =
          chunks.length > 1 ? Buffer.concat(chunks, have) : chunks[0];
        const rest = whole.subarray(need);
        receive(whole[4], whole.subarray(5, need), arrived);
        chunks = rest.length > 0 ? [rest] : [];
        have = rest.length;
        need = -1;
      }
    });
    socket.on('error', () => socket.destroy());
    socket.on('close', () => {
      if (game === socket) game = undefined;
    });
  });
  if (process.platform !== 'win32') rmSync(address, { force: true });
  await new Promise((listening, failed) => {
    sockets.once('error', failed);
    sockets.listen(address, listening);
  });

  const webSockets = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((listening) => webSockets.once('listening', listening));
  webSockets.on('connection', (socket, request) => {
    const query = new URL(request.url ?? '', 'ws://relay').searchParams;
    if (query.get('token') !== token) {
      socket.close(1008);
      return;
    }
    if (query.get('role') === 'shell') {
      shell = socket;
      shellPid = Number(query.get('pid'));
      game?.write(encodeJson({ type: 'shell', pid: shellPid }));
    } else {
      viewer = socket;
    }
    inFlight = 0;
    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const message = JSON.parse(data.toString());
      if (message.type === 'received') {
        received();
      } else if (message.type === 'released') {
        game?.write(encodeJson({ type: 'released', slot: message.slot }));
      } else if (message.type === 'input') {
        message.relayed = now();
        game?.write(encodeJson(message));
      }
    });
  });

  return {
    port: webSockets.address().port,
    token,
    get gameConnected() {
      return game !== undefined;
    },
    counts: () => ({ ...counts }),
    /**
     * How far the game's clock is from the relay's, from the round trip with
     * the least delay.
     */
    async gameClock() {
      let best = null;
      for (let sample = 0; sample < 7; sample += 1) {
        const id = (clockId += 1);
        const reply = new Promise((answered) => clockReplies.set(id, answered));
        const before = now();
        game?.write(encodeJson({ type: 'clock', id }));
        const time = await Promise.race([
          reply,
          new Promise((late) => setTimeout(() => late(null), 1000)),
        ]);
        const after = now();
        clockReplies.delete(id);
        if (
          time !== null &&
          (best === null || after - before < best.roundTrip)
        ) {
          best = {
            roundTrip: after - before,
            offset: time - (before + after) / 2,
          };
        }
      }
      return (
        best && {
          offsetMs: Math.round(best.offset * 100) / 100,
          roundTripMs: Math.round(best.roundTrip * 100) / 100,
        }
      );
    },
    /** Holds every frame this long before forwarding it, to check the measurement. */
    setExtraDelay(milliseconds) {
      extraDelay = milliseconds;
    },
    async close() {
      game?.destroy();
      for (const client of webSockets.clients) client.terminate();
      await new Promise((closed) => webSockets.close(closed));
      await new Promise((closed) => sockets.close(closed));
    },
  };
}
