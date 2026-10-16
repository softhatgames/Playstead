// The probe's preview window: an Electron window showing viewer/index.html,
// which connects to the relay on --relay-port with --relay-token. With
// --control-port and --control-token it also takes commands from the probe's
// runner over a WebSocket: input events, reading the page's records and
// details of the computer. The runner does not use Playwright, which reports
// every WebSocket frame over the DevTools protocol and so slows the page it
// measures. With --frames=iosurface or d3d11 it also receives the game's
// shared GPU surfaces from the relay and passes them to the page without a
// copy.
import { app, BrowserWindow, screen, sharedTexture } from 'electron';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { WebSocket } from 'ws';

const now = () => performance.timeOrigin + performance.now();

const option = (name) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);

function control(contents, port, token) {
  const methods = {
    evaluate: (expression) => contents.executeJavaScript(expression),
    key: (keyCode, down) =>
      contents.sendInputEvent({ type: down ? 'keyDown' : 'keyUp', keyCode }),
    click(x, y) {
      for (const type of ['mouseDown', 'mouseUp']) {
        contents.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
      }
    },
    details: () => ({
      electron: process.versions.electron,
      displayHz: Math.round(screen.getPrimaryDisplay().displayFrequency),
    }),
  };
  const socket = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
  socket.on('message', async (data) => {
    const { id, method, args } = JSON.parse(data.toString());
    try {
      const result = await methods[method](...args);
      socket.send(JSON.stringify({ id, result: result ?? null }));
    } catch (error) {
      socket.send(JSON.stringify({ id, error: String(error) }));
    }
  });
}

/** A handle the game duplicated into this process, as Electron takes it. */
function ntHandle(value) {
  const handle = Buffer.alloc(8);
  handle.writeBigUInt64LE(BigInt(value));
  return handle;
}

/**
 * Imports each frame the game copied into one of its shared surfaces and
 * sends it to the page: global IOSurfaces looked up by ID on macOS, Direct3D
 * 11 textures whose handles the game duplicated into this process on Windows.
 * The relay gets "received" once the page has the frame, and "released" with
 * the slot once every process has let the surface go.
 */
function shareSurfaces(contents, port, token, frames) {
  const native =
    frames === 'iosurface'
      ? createRequire(import.meta.url)('./native/build/iosurface.node')
      : null;
  const surfaces = new Map();
  const socket = new WebSocket(
    `ws://127.0.0.1:${port}/?token=${token}&role=shell&pid=${process.pid}`,
  );
  socket.binaryType = 'nodebuffer';
  socket.on('message', async (data, isBinary) => {
    if (!isBinary) return;
    const shellIn = now();
    const header = new Uint8Array(data.subarray(0, 80));
    const view = new DataView(header.buffer);
    const width = view.getUint32(4, true);
    const height = view.getUint32(8, true);
    const id = data.readUInt32LE(80);
    const slot = data.readInt32LE(84);
    if (!surfaces.has(id))
      surfaces.set(id, native ? native.lookup(id) : ntHandle(id));
    const surface = surfaces.get(id);
    if (!surface) {
      socket.send(JSON.stringify({ type: 'released', slot }));
      socket.send('{"type":"received"}');
      return;
    }
    const imported = sharedTexture.importSharedTexture({
      textureInfo: {
        pixelFormat: native ? 'bgra' : 'rgba',
        codedSize: { width, height },
        handle: native ? { ioSurface: surface } : { ntHandle: surface },
      },
      allReferencesReleased: () =>
        socket.send(JSON.stringify({ type: 'released', slot })),
    });
    try {
      await sharedTexture.sendSharedTexture(
        { frame: contents.mainFrame, importedSharedTexture: imported },
        header,
        shellIn,
        now(),
      );
    } finally {
      imported.release();
      socket.send('{"type":"received"}');
    }
  });
  socket.on('close', () => {
    if (!native) return;
    for (const surface of surfaces.values()) {
      if (surface) native.release(surface);
    }
  });
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1280,
    height: 720,
    useContentSize: true,
    title: 'Playstead preview probe',
    backgroundColor: '#000000',
    // The preview must be visible while it is measured, and on Windows a
    // window opened from a terminal can open behind it.
    alwaysOnTop: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      sandbox: true,
      preload: fileURLToPath(new URL('preload.cjs', import.meta.url)),
    },
  });
  await window.loadFile(fileURLToPath(new URL('index.html', import.meta.url)), {
    query: {
      port: option('relay-port') ?? '',
      token: option('relay-token') ?? '',
      frames: option('frames') ?? 'raw',
    },
  });
  if (['iosurface', 'd3d11'].includes(option('frames'))) {
    shareSurfaces(
      window.webContents,
      option('relay-port'),
      option('relay-token'),
      option('frames'),
    );
  }
  const port = option('control-port');
  if (port) control(window.webContents, port, option('control-token'));
});

app.on('window-all-closed', () => app.quit());
