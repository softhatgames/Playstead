/* global window, document, WebSocket, performance, requestAnimationFrame, URLSearchParams */
// The probe's preview page. It draws the latest frame on each display refresh,
// sends the person's input back, and records when each frame was drawn. Raw
// frames arrive from the relay as pixels; with ?frames=iosurface or d3d11 the
// preload hands over the game's shared GPU surfaces as VideoFrames instead. The
// probe's runner reads the records through window.probe.
'use strict';

(function () {
  const HEADER = 80;
  const BLOCK = 8;
  // Shared frames are checked against their pixels every this many frames:
  // reading them back from the GPU costs more than reading raw pixels.
  const CHECK_EVERY = 15;
  const now = () => performance.timeOrigin + performance.now();
  const canvas = document.getElementById('frame');
  const status = document.getElementById('status');
  const query = new URLSearchParams(window.location.search);
  const shared = ['iosurface', 'd3d11'].includes(query.get('frames'));
  // Columns of a frame record, below.
  const RENDERED = 2;
  const DRAWN = 9;
  const MARKER = 11;

  // Frame records: frame, update, rendered, readback, sent, inputReceived,
  // relayIn, relayOut, received, drawn, inputSeq, marker, bitsOk (1 matched,
  // 0 did not, 2 not checked), shellIn, shellSent (0 for raw frames).
  const frames = [];
  // Input records: seq, sent, code, down.
  const inputs = [];
  const counts = { received: 0, skipped: 0, displayed: 0 };
  let latest = null;
  let seq = 0;
  let socket = null;
  let frozen = false;
  // The frame number of the frame the texture holds.
  let textureFrame = null;

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    desynchronized: true,
  });
  const program = gl.createProgram();
  for (const [type, source] of [
    [
      gl.VERTEX_SHADER,
      `#version 300 es
      in vec2 position;
      uniform bool bottomUp;
      out vec2 uv;
      void main() {
        uv = vec2((position.x + 1.0) * 0.5,
          bottomUp ? (position.y + 1.0) * 0.5 : (1.0 - position.y) * 0.5);
        gl_Position = vec4(position, 0.0, 1.0);
      }`,
    ],
    [
      gl.FRAGMENT_SHADER,
      `#version 300 es
      precision mediump float;
      in vec2 uv;
      uniform sampler2D frame;
      out vec4 colour;
      void main() { colour = texture(frame, uv); }`,
    ],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const bottomUp = gl.getUniformLocation(program, 'bottomUp');
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  let textureSize = '';

  /**
   * Reads the game's three machine-readable rows of 32 blocks (input number,
   * reload marker, frame number) from pixels whose rows start at the top.
   */
  function readRows(pixels, width, rowsBottomUp, height) {
    return [0, 1, 2].map((row) => {
      let value = 0;
      for (let bit = 0; bit < 32; bit += 1) {
        const x = bit * BLOCK + BLOCK / 2;
        const top = row * BLOCK + BLOCK / 2;
        const y = rowsBottomUp ? height - 1 - top : top;
        if (pixels[(y * width + x) * 4] > 127) value |= 1 << bit;
      }
      return value >>> 0;
    });
  }

  /** The same rows, read back from what the canvas just drew. */
  const strip = new Uint8Array(32 * BLOCK * 3 * BLOCK * 4);
  function readCanvasRows() {
    const width = 32 * BLOCK;
    const height = 3 * BLOCK;
    gl.readPixels(
      0,
      canvas.height - height,
      width,
      height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      strip,
    );
    // readPixels returns rows from the bottom.
    return readRows(strip, width, true, height);
  }

  function upload(pixels, width, height) {
    const size = `${width}x${height}`;
    if (size !== textureSize) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA8,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
      textureSize = size;
    } else {
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        0,
        0,
        width,
        height,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels,
      );
    }
  }

  function drawTexture(rowsBottomUp) {
    gl.uniform1i(bottomUp, rowsBottomUp ? 1 : 0);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function draw() {
    requestAnimationFrame(draw);
    const next = latest;
    if (next === null || frozen) return;
    latest = null;
    const view = next.header;
    const width = view.getUint32(4, true);
    const height = view.getUint32(8, true);
    const rowsBottomUp = (view.getUint32(20, true) & 1) === 1;
    const frame = view.getUint32(0, true);
    if (next.pixels) {
      upload(next.pixels, width, height);
      textureFrame = frame;
    }
    drawTexture(rowsBottomUp);
    const drawn = now();

    const inputSeq = view.getUint32(12, true);
    const marker = view.getInt32(16, true);
    let rows = null;
    if (next.pixels) rows = readRows(next.pixels, width, rowsBottomUp, height);
    else if (counts.displayed % CHECK_EVERY === 0) rows = readCanvasRows();
    const bitsOk =
      rows === null
        ? 2
        : rows[0] === inputSeq && rows[1] === marker >>> 0 && rows[2] === frame
          ? 1
          : 0;
    frames.push([
      frame,
      view.getFloat64(24, true),
      view.getFloat64(32, true),
      view.getFloat64(40, true),
      view.getFloat64(48, true),
      view.getFloat64(56, true),
      view.getFloat64(64, true),
      view.getFloat64(72, true),
      next.received,
      drawn,
      inputSeq,
      marker,
      bitsOk,
      next.shellIn ?? 0,
      next.shellSent ?? 0,
    ]);
    counts.displayed += 1;
  }

  function arrived(frame) {
    if (latest !== null) counts.skipped += 1;
    latest = frame;
    counts.received += 1;
  }

  function connect() {
    socket = new WebSocket(
      `ws://127.0.0.1:${query.get('port')}/?token=${query.get('token')}`,
    );
    socket.binaryType = 'arraybuffer';
    socket.onmessage = (event) => {
      const received = now();
      arrived({
        header: new DataView(event.data, 0, HEADER),
        pixels: new Uint8Array(event.data, HEADER),
        received,
      });
      // The relay sends the next frame only once this one has arrived.
      socket.send('{"type":"received"}');
    };
    socket.onclose = () => {
      status.textContent = 'Disconnected from the probe';
    };
  }

  /**
   * Resolves once the GPU has run every command issued so far. WebGL updates
   * a fence's status only between tasks, so it is checked on a timer.
   */
  function gpuFinished() {
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    return new Promise((done) => {
      const check = () => {
        if (gl.getSyncParameter(fence, gl.SYNC_STATUS) === gl.SIGNALED) {
          gl.deleteSync(fence);
          done();
        } else {
          window.setTimeout(check, 0);
        }
      };
      window.setTimeout(check, 0);
    });
  }

  if (shared) {
    // The frame is copied into the page's texture on the GPU as it arrives,
    // and the game's surface goes back to it once the GPU has run the copy:
    // on Windows the copy can run so late that the game has drawn into the
    // surface again, and a frozen picture changes.
    window.sharedFrames.onFrame(async (frame, header, shellIn, shellSent) => {
      const received = now();
      const view = new DataView(header.buffer, header.byteOffset, HEADER);
      let copied = null;
      if (!frozen) {
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          frame,
        );
        textureSize = '';
        textureFrame = view.getUint32(0, true);
        copied = gpuFinished();
      }
      arrived({ header: view, received, shellIn, shellSent });
      // The preload releases the surface when this returns.
      await copied;
    });
  }

  function send(message) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  const keys = /^(Arrow(Left|Right|Up|Down)|Space|Enter|Key[A-Z]|Digit[0-9])$/;
  // Events injected by Electron's sendInputEvent carry a key but no code.
  function codeOf(event) {
    if (event.code) return event.code;
    if (event.key === ' ') return 'Space';
    if (/^[a-z]$/i.test(event.key)) return `Key${event.key.toUpperCase()}`;
    if (/^[0-9]$/.test(event.key)) return `Digit${event.key}`;
    return event.key;
  }
  function onKey(event, down) {
    const code = codeOf(event);
    if (!keys.test(code)) return;
    event.preventDefault();
    if (event.repeat) return;
    // The event's own time: when the system delivered the key, not when this ran.
    const sent = performance.timeOrigin + event.timeStamp;
    seq += 1;
    inputs.push([seq, sent, code, down]);
    send({ type: 'input', seq, kind: 'key', code, down, sent });
  }
  window.addEventListener('keydown', (event) => onKey(event, true));
  window.addEventListener('keyup', (event) => onKey(event, false));
  canvas.addEventListener('mousedown', (event) => {
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(
      box.width / canvas.width,
      box.height / canvas.height,
    );
    const left = box.left + (box.width - canvas.width * scale) / 2;
    const top = box.top + (box.height - canvas.height * scale) / 2;
    const sent = performance.timeOrigin + event.timeStamp;
    seq += 1;
    inputs.push([seq, sent, 'Mouse', true]);
    send({
      type: 'input',
      seq,
      kind: 'mouse',
      down: true,
      x: (event.clientX - left) / scale,
      y: (event.clientY - top) / scale,
      sent,
    });
    canvas.focus();
  });

  window.setInterval(() => {
    const recent = frames.filter((record) => record[DRAWN] > now() - 1000);
    if (recent.length === 0) return;
    const delays = recent
      .map((record) => record[DRAWN] - record[RENDERED])
      .sort((a, b) => a - b);
    const last = recent[recent.length - 1];
    status.textContent =
      `${recent.length} frames/s  frame delay ${delays[delays.length >> 1].toFixed(1)} ms  ` +
      `frame ${last[0]}  reload marker ${last[MARKER]}  ${shared ? 'shared surfaces' : 'raw frames'}\n` +
      'Keep this window visible while the probe measures.';
  }, 500);

  window.probe = {
    counts: () => ({ ...counts }),
    dump: () => ({ frames, inputs }),
    /** The earliest time a frame showing this reload marker was drawn after `since`. */
    firstDrawn(marker, since) {
      let first = null;
      for (let index = frames.length - 1; index >= 0; index -= 1) {
        const record = frames[index];
        if (record[DRAWN] < since) break;
        if (record[MARKER] === marker) first = record[DRAWN];
      }
      return first;
    },
    /**
     * Freezes the picture for a second while frames keep arriving, as drawing
     * feedback over a frozen frame will, then checks the frozen picture is
     * still the frame it froze on.
     */
    async freezeCheck() {
      frozen = true;
      const frozenFrame = textureFrame;
      const before = counts.received;
      await new Promise((done) => window.setTimeout(done, 1000));
      drawTexture(false);
      const shownFrame = readCanvasRows()[2];
      const arrivedWhileFrozen = counts.received - before;
      latest = null;
      frozen = false;
      return {
        frozenFrame,
        shownFrame,
        arrivedWhileFrozen,
        ok: shownFrame === frozenFrame && arrivedWhileFrozen > 0,
      };
    },
  };

  connect();
  canvas.focus();
  requestAnimationFrame(draw);
})();
