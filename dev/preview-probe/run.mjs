// Usage:
//   pnpm probe:preview [--subject <name>] [--frames raw|iosurface|d3d11]
//                      [--interactive] [--seconds <n>] [--show-game-window]
//                      [--note <text>]
//   pnpm probe:preview play [--subject <name>]
//   pnpm probe:preview compare
//
// Runs a subject game from dev/preview-probe/subjects, shows its frames in an
// Electron preview, measures frame rate, delay, input, code reload and sound,
// and records the result in dev/preview-probe/results so technologies can be
// compared. README.md explains the measurements and how to add a subject.
import { spawn, spawnSync } from 'node:child_process';
import { error as reportError, log } from 'node:console';
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import {
  arch,
  cpus,
  homedir,
  platform,
  release,
  tmpdir,
  totalmem,
  version as osVersion,
} from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocketServer } from 'ws';
import { gameAddress, now, startRelay } from './relay.mjs';

const probeFolder = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(probeFolder, '../..');
const resultsFolder = join(probeFolder, 'results');

/**
 * Pass marks proposed for the technical prototype, not yet agreed. Each
 * result records the marks it was judged by, and its raw numbers, so it can
 * be judged again if they change.
 */
const passMarks = {
  displayedFps: 57,
  longGapShare: 0.01,
  addedDelayP95Ms: 50,
  reloadMs: 2000,
  calibrationToleranceMs: 10,
  clockToleranceMs: 2,
};
const CALIBRATION_MS = 100;
const FRAME_MS = 1000 / 60;

// Columns of the viewer's frame records, as viewer.js writes them.
const FRAME = {
  frame: 0,
  update: 1,
  rendered: 2,
  readback: 3,
  sent: 4,
  inputReceived: 5,
  relayIn: 6,
  relayOut: 7,
  received: 8,
  drawn: 9,
  inputSeq: 10,
  marker: 11,
  bitsOk: 12,
  shellIn: 13,
  shellSent: 14,
};
const frameColumns = Object.keys(FRAME);
const frameTimeColumns = new Set(
  [
    'update',
    'rendered',
    'readback',
    'sent',
    'inputReceived',
    'relayIn',
    'relayOut',
    'received',
    'drawn',
    'shellIn',
    'shellSent',
  ].map((name) => FRAME[name]),
);
const inputColumns = ['seq', 'sent', 'code', 'down'];

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    subject: { type: 'string', default: 'monogame-desktopgl' },
    interactive: { type: 'boolean', default: false },
    seconds: { type: 'string', default: '10' },
    frames: { type: 'string', default: 'raw' },
    'show-game-window': { type: 'boolean', default: false },
    note: { type: 'string' },
  },
});

/** Set by Ctrl+C: the run stops, restores the reload file and records nothing. */
let interrupted = false;

const round = (value) => Math.round(value * 10) / 10;
// Home folders become ~, including Windows paths with escaped backslashes.
const redact = (text) =>
  text
    .replaceAll(homedir(), '~')
    .replaceAll(homedir().replaceAll('\\', '\\\\'), '~');

function summary(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = (share) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
  return {
    count: sorted.length,
    p50: round(at(0.5)),
    p95: round(at(0.95)),
    max: round(sorted[sorted.length - 1]),
  };
}

async function waitFor(predicate, timeout, interval = 25) {
  const until = now() + timeout;
  while (now() < until && !interrupted) {
    if (await predicate()) return true;
    await sleep(interval);
  }
  return false;
}

function stopIfInterrupted() {
  if (interrupted) throw new Error('Interrupted.');
}

function loadSubject(name) {
  const folder = join(probeFolder, 'subjects', name);
  const file = join(folder, 'subject.json');
  if (!existsSync(file)) {
    const known = readdirSync(join(probeFolder, 'subjects')).join(', ');
    throw new Error(`No subject "${name}". Subjects: ${known}.`);
  }
  const subject = {
    id: name,
    folder,
    ...JSON.parse(readFileSync(file, 'utf8')),
  };
  if (subject.platforms && !subject.platforms.includes(platform())) {
    const names = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
    const where = subject.platforms.map((name) => names[name] ?? name);
    throw new Error(`${subject.name} runs only on ${where.join(' and ')}.`);
  }
  return subject;
}

function versionOf(commandLine) {
  const [file, ...args] = commandLine;
  const result = spawnSync(file, args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim().split('\n')[0] : null;
}

function machine() {
  const os =
    platform() === 'darwin'
      ? `macOS ${versionOf(['sw_vers', '-productVersion'])}`
      : osVersion();
  return {
    platform: platform(),
    arch: arch(),
    os,
    osRelease: release(),
    cpu: cpus()[0]?.model.trim() ?? 'unknown',
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
  };
}

function playstead() {
  const git = (...args) =>
    spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).stdout.trim();
  return {
    commit: git('rev-parse', '--short', 'HEAD'),
    uncommittedChanges:
      git('status', '--porcelain', '--untracked-files=no') !== '',
  };
}

/**
 * A private folder for one run's sockets and log. Unix socket paths are
 * limited to about 104 characters, so it stays short: /tmp rather than
 * macOS's long per-user temporary folder.
 */
function newRunFolder() {
  return mkdtempSync(join(platform() === 'win32' ? tmpdir() : '/tmp', 'pp-'));
}

function environmentFor(subject) {
  const environment = { ...subject.environment };
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !(name in environment))
      environment[name] = value;
  }
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

/**
 * Starts a process with its output in the run's log. On Windows its windows
 * are hidden unless `showWindows` is set: Node's windowsHide hides a program's
 * first window, not only a console.
 */
function startProcess(
  commandLine,
  cwd,
  environment,
  logFile,
  { showWindows = false } = {},
) {
  const [file, ...args] = commandLine;
  const sink = createWriteStream(logFile, { flags: 'a' });
  sink.write(`\n$ ${commandLine.join(' ')}\n`);
  const child = spawn(file, args, {
    cwd,
    env: environment,
    detached: platform() !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: !showWindows,
  });
  const running = { child, text: '', exit: null };
  const collect = (chunk) => {
    running.text = (running.text + chunk).slice(-200_000);
    sink.write(chunk);
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  running.exited = new Promise((done) => {
    child.on('error', (error) => {
      collect(`\n${error.message}\n`);
      running.exit ??= { code: -1, signal: null };
      done(running.exit);
    });
    child.on('exit', (code, signal) => {
      running.exit ??= { code, signal };
      // Output can follow the exit. A process the game left running can
      // hold the pipes open, so wait only briefly.
      Promise.race([
        new Promise((closed) => child.once('close', closed)),
        sleep(1000),
      ]).then(() => done(running.exit));
    });
  }).finally(() => sink.end());
  return running;
}

async function runToEnd(commandLine, cwd, environment, logFile) {
  const started = now();
  const running = startProcess(commandLine, cwd, environment, logFile);
  const exit = await running.exited;
  return {
    ok: exit.code === 0,
    ms: round(now() - started),
    text: running.text,
  };
}

function signal(pid, name) {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
}

/** Stops a process and everything it started. */
async function stopProcess(running) {
  if (running.exit) return;
  const pid = running.child.pid;
  if (platform() === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F']);
    await Promise.race([running.exited, sleep(5000)]);
    return;
  }
  signal(-pid, 'SIGTERM');
  await Promise.race([running.exited, sleep(3000)]);
  if (!running.exit) signal(-pid, 'SIGKILL');
}

const lastLines = (text, count = 30) =>
  redact(text).trim().split('\n').slice(-count).join('\n');

/**
 * Builds the shell's IOSurface module with clang against Node-API, which
 * Electron loads without rebuilding, unless the build is newer than its
 * source.
 */
function buildSurfaceModule(logFile) {
  const source = join(probeFolder, 'viewer/native/iosurface.c');
  const output = join(probeFolder, 'viewer/native/build/iosurface.node');
  if (existsSync(output) && statSync(output).mtimeMs > statSync(source).mtimeMs)
    return;
  mkdirSync(dirname(output), { recursive: true });
  const include = join(dirname(process.execPath), '..', 'include', 'node');
  const build = spawnSync(
    'clang',
    [
      '-O2',
      '-shared',
      '-undefined',
      'dynamic_lookup',
      `-I${include}`,
      '-o',
      output,
      source,
      '-framework',
      'IOSurface',
      '-framework',
      'CoreFoundation',
    ],
    { encoding: 'utf8' },
  );
  writeFileSync(logFile, `${build.stdout}${build.stderr}`, { flag: 'a' });
  if (build.status !== 0) {
    throw new Error(
      `Building the IOSurface module failed; it needs Xcode's command line tools (xcode-select --install):\n${lastLines(build.stderr ?? '')}`,
    );
  }
}

/**
 * Opens the preview window and a control connection to its Electron main
 * process. `call` runs one of the methods in viewer/main.mjs.
 */
async function openViewer(relay, logFile) {
  const token = randomBytes(16).toString('hex');
  const control = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((listening) => control.once('listening', listening));
  const connected = new Promise((accept) =>
    control.on('connection', (socket, request) => {
      const given = new URL(request.url ?? '', 'ws://control').searchParams;
      if (given.get('token') === token) accept(socket);
      else socket.close(1008);
    }),
  );
  const require = createRequire(join(probeFolder, 'package.json'));
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  const electron = startProcess(
    [
      require('electron'),
      join(probeFolder, 'viewer/main.mjs'),
      `--relay-port=${relay.port}`,
      `--relay-token=${relay.token}`,
      `--control-port=${control.address().port}`,
      `--control-token=${token}`,
      `--frames=${options.frames}`,
    ],
    probeFolder,
    environment,
    logFile,
    { showWindows: true },
  );
  const socket = await Promise.race([
    connected,
    electron.exited.then(() => null),
    sleep(30_000).then(() => null),
  ]);
  if (!socket) {
    await stopProcess(electron);
    control.close();
    throw new Error(
      `The preview window did not start:\n${lastLines(electron.text)}`,
    );
  }
  const pending = new Map();
  let nextId = 0;
  let gone = false;
  socket.on('message', (data) => {
    const { id, result, error } = JSON.parse(data.toString());
    pending.get(id)?.(error === undefined ? { result } : { error });
    pending.delete(id);
  });
  const closed = Promise.race([
    electron.exited,
    new Promise((done) => socket.once('close', done)),
  ]).then(() => {
    gone = true;
    for (const answer of pending.values()) {
      answer({ error: 'The preview window was closed.' });
    }
    pending.clear();
  });
  return {
    async call(method, ...args) {
      if (gone) throw new Error('The preview window was closed.');
      const id = (nextId += 1);
      const reply = new Promise((done) => pending.set(id, done));
      socket.send(JSON.stringify({ id, method, args }));
      const answer = await Promise.race([
        reply,
        sleep(30_000).then(() => null),
      ]);
      if (answer === null)
        throw new Error(`The preview did not answer ${method} within 30 s.`);
      if (answer.error !== undefined) throw new Error(answer.error);
      return answer.result;
    },
    evaluate(expression) {
      return this.call('evaluate', expression);
    },
    closed,
    async close() {
      await stopProcess(electron);
      control.close();
    },
  };
}

/**
 * How far the viewer's clock is from the runner's, from the round trip with
 * the least delay. The game's and the viewer's times are compared directly,
 * so an offset between clocks would shift the frame delay.
 */
async function viewerClock(viewer) {
  let best = null;
  for (let sample = 0; sample < 7; sample += 1) {
    const before = now();
    const time = await viewer.evaluate(
      'performance.timeOrigin + performance.now()',
    );
    const after = now();
    if (best === null || after - before < best.roundTrip) {
      best = { roundTrip: after - before, offset: time - (before + after) / 2 };
    }
  }
  return {
    offsetMs: Math.round(best.offset * 100) / 100,
    roundTripMs: Math.round(best.roundTrip * 100) / 100,
  };
}

/** Frame rate, steadiness, delay and where the delay goes, for one window. */
function frameStats(frames, span) {
  const shown = frames.filter(
    (row) => row[FRAME.drawn] >= span.start && row[FRAME.drawn] < span.end,
  );
  if (shown.length < 2) return null;
  const first = shown[0];
  const last = shown[shown.length - 1];
  const between = (from, to) =>
    summary(shown.map((row) => row[to] - row[from]));
  const delta = (name) => span.after[name] - span.before[name];
  const intervals = shown
    .slice(1)
    .map((row, index) => row[FRAME.drawn] - shown[index][FRAME.drawn]);
  // How evenly the game made its frames, from consecutive frames both shown.
  const gameIntervals = shown
    .slice(1)
    .flatMap((row, index) =>
      row[FRAME.frame] === shown[index][FRAME.frame] + 1
        ? [row[FRAME.rendered] - shown[index][FRAME.rendered]]
        : [],
    );
  return {
    renderedFps: round(
      ((last[FRAME.frame] - first[FRAME.frame]) * 1000) /
        (last[FRAME.rendered] - first[FRAME.rendered]),
    ),
    displayedFps: round((shown.length * 1000) / (span.end - span.start)),
    intervalMs: summary(intervals),
    gameIntervalMs: summary(gameIntervals),
    longGaps: intervals.filter((gap) => gap > 2 * FRAME_MS).length,
    delayMs: between(FRAME.rendered, FRAME.drawn),
    stagesMs: {
      readback: between(FRAME.rendered, FRAME.readback),
      waitToSend: between(FRAME.readback, FRAME.sent),
      gameToRelay: between(FRAME.sent, FRAME.relayIn),
      relay: between(FRAME.relayIn, FRAME.relayOut),
      relayToViewer: between(FRAME.relayOut, FRAME.received),
      ...(shown[0][FRAME.shellIn] > 0
        ? {
            relayToShell: between(FRAME.relayOut, FRAME.shellIn),
            shellImport: between(FRAME.shellIn, FRAME.shellSent),
            shellToViewer: between(FRAME.shellSent, FRAME.received),
          }
        : {}),
      viewerToDrawn: between(FRAME.received, FRAME.drawn),
    },
    frames: {
      rendered: last[FRAME.frame] - first[FRAME.frame] + 1,
      reachedRelay: delta('framesIn'),
      droppedAtRelay: delta('droppedAtRelay'),
      receivedByViewer: delta('received'),
      skippedByViewer: delta('skipped'),
      displayed: shown.length,
    },
  };
}

/** For each input, the first drawn frame that had handled it. */
function inputStats(frames, inputs, span) {
  const transport = [];
  const added = [];
  const total = [];
  let unmatched = 0;
  for (const [seq, sent] of inputs) {
    if (sent < span.start || sent >= span.end) continue;
    const row = frames.find((candidate) => candidate[FRAME.inputSeq] >= seq);
    if (!row) {
      unmatched += 1;
      continue;
    }
    total.push(row[FRAME.drawn] - sent);
    if (row[FRAME.inputSeq] === seq) {
      const leg = row[FRAME.inputReceived] - sent;
      transport.push(leg);
      added.push(leg + row[FRAME.drawn] - row[FRAME.rendered]);
    }
  }
  return {
    inputToGameMs: summary(transport),
    addedDelayMs: summary(added),
    inputToDisplayMs: summary(total),
    unmatched,
  };
}

/** Turns the frames the viewer recorded into the result's measurements. */
function analyse(result, frames, inputs, spans) {
  if (frames.length === 0) return;
  result.startup.launchToFirstFrameMs = round(
    frames[0][FRAME.drawn] - spans.launched,
  );
  result.frames = spans.steady ? frameStats(frames, spans.steady) : null;
  if (spans.input) result.input = inputStats(frames, inputs, spans.input);
  if (!result.frames) return;
  result.frames.pixelRowsChecked = frames.filter(
    (row) => row[FRAME.bitsOk] !== 2,
  ).length;
  result.frames.pixelRowsMismatched = frames.filter(
    (row) => row[FRAME.bitsOk] === 0,
  ).length;
  const calibrated = spans.calibration
    ? frameStats(frames, spans.calibration)
    : null;
  if (calibrated) {
    const measuredMs = round(
      calibrated.delayMs.p50 - result.frames.delayMs.p50,
    );
    result.calibration = {
      addedMs: CALIBRATION_MS,
      measuredMs,
      delayMs: calibrated.delayMs,
      ok:
        Math.abs(measuredMs - CALIBRATION_MS) <=
        passMarks.calibrationToleranceMs,
    };
  }
}

function verdicts(result) {
  const judge = (measured, passed) =>
    measured ? (passed ? 'pass' : 'fail') : 'not measured';
  const frames = result.frames;
  const added = result.input?.addedDelayMs;
  const edits = result.reload?.edits;
  const clocks = result.clocks;
  const clockOk = (clock) =>
    clock !== null &&
    Math.abs(clock.offsetMs) <=
      passMarks.clockToleranceMs + clock.roundTripMs / 2;
  const clocksOk = !clocks || (clockOk(clocks.game) && clockOk(clocks.viewer));
  return {
    ran: result.ran ? 'yes' : 'no',
    frameRate: judge(
      frames,
      frames &&
        frames.displayedFps >= passMarks.displayedFps &&
        frames.longGaps <= passMarks.longGapShare * frames.frames.displayed,
    ),
    delay: judge(added, added && added.p95 <= passMarks.addedDelayP95Ms),
    reload: judge(
      edits,
      edits?.every((edit) =>
        edit.restartExpected
          ? edit.shown
          : edit.shown &&
            !edit.restarted &&
            edit.editToVisibleMs <= passMarks.reloadMs,
      ),
    ),
    measurement: result.calibration
      ? result.calibration.ok && clocksOk
        ? 'checked'
        : 'suspect'
      : 'not checked',
  };
}

function printSummary(result, file) {
  const line = (text) => log(`  ${text}`);
  const verdict = result.verdict;
  const ms = (stats) =>
    stats ? `p50 ${stats.p50} ms, p95 ${stats.p95} ms` : 'not measured';
  log(
    `\n${result.subject.name} on ${result.machine.os} ${result.machine.arch}`,
  );
  if (!result.ran) line('The game did not reach the preview.');
  if (result.frames) {
    line(
      `Frames: ${result.frames.renderedFps} rendered/s, ${result.frames.displayedFps} shown/s, ` +
        `${result.frames.longGaps} gaps over ${round(2 * FRAME_MS)} ms ` +
        `(${verdict.frameRate}, mark ${passMarks.displayedFps}/s)`,
    );
    if (result.frames.gameIntervalMs) {
      line(
        `Game pacing: ${ms(result.frames.gameIntervalMs)} between frames, ` +
          `max ${result.frames.gameIntervalMs.max} ms`,
      );
    }
    line(`Frame delay: ${ms(result.frames.delayMs)}`);
    line(
      `Pixel check: ${result.frames.pixelRowsChecked - result.frames.pixelRowsMismatched} of ` +
        `${result.frames.pixelRowsChecked} checked frames matched their header`,
    );
  }
  if (result.input) {
    line(
      `Added delay over Play: ${ms(result.input.addedDelayMs)} ` +
        `(${verdict.delay}, mark p95 ${passMarks.addedDelayP95Ms} ms)`,
    );
    line(`Input to display: ${ms(result.input.inputToDisplayMs)}`);
  }
  for (const edit of result.reload?.edits ?? []) {
    line(
      `Reload, ${edit.edit}: ` +
        (edit.shown
          ? `shown after ${edit.editToVisibleMs} ms${edit.restarted ? ', restarted' : ''}`
          : 'never shown'),
    );
  }
  if (result.reload) {
    line(
      `Reload: ${verdict.reload}, mark ${passMarks.reloadMs} ms without a restart`,
    );
  }
  if (result.freeze) {
    line(
      `Freeze: ${result.freeze.ok ? 'kept' : 'did not keep'} frame ${result.freeze.frozenFrame} ` +
        `while ${result.freeze.arrivedWhileFrozen} frames arrived`,
    );
  }
  if (result.audio) {
    line(
      result.audio.ok
        ? `Sound: ${result.audio.played} beeps played without errors`
        : `Sound: failed: ${result.audio.errors.join('; ') || 'no beep reported'}`,
    );
  }
  if (result.calibration) {
    line(
      `Measurement check: +${CALIBRATION_MS} ms measured as +${result.calibration.measuredMs} ms; ` +
        `clocks off by ${result.clocks.game?.offsetMs ?? '?'} ms (game) and ${result.clocks.viewer.offsetMs} ms (viewer) ` +
        `(${verdict.measurement})`,
    );
  }
  for (const problem of result.problems) {
    const lines = problem.split('\n');
    const thrown = lines.find((text) => /exception|error:/i.test(text));
    line(`Problem: ${lines[0]}${thrown ? ` ${thrown.trim()}` : ''}`);
  }
  log(`\nRecorded ${relative(root, file)}`);
}

async function measure() {
  const subject = loadSubject(options.subject);
  const routes = subject.frames ?? ['raw'];
  if (!routes.includes(options.frames))
    throw new Error(`${subject.name} sends frames as ${routes.join(' or ')}.`);
  if (options.frames === 'iosurface' && platform() !== 'darwin')
    throw new Error('--frames iosurface needs macOS.');
  const seconds = Number(options.seconds);
  const runFolder = newRunFolder();
  const logFile = join(runFolder, 'probe.log');
  const recordedAt = new Date();
  const result = {
    probe: 'preview',
    format: 1,
    recordedAt: recordedAt.toISOString(),
    subject: {
      id: subject.id,
      name: subject.name,
      technology: subject.technology,
    },
    machine: machine(),
    playstead: playstead(),
    tools: { node: process.version },
    settings: {
      frames: options.frames,
      steadySeconds: seconds,
      passMarks,
    },
    note: options.note ?? null,
    ran: false,
    startup: {},
    problems: [],
  };
  for (const [name, commandLine] of Object.entries(subject.versions ?? {})) {
    result.tools[name] = versionOf(commandLine);
  }

  const cleanups = [];
  const cleanUp = async () => {
    while (cleanups.length > 0) await cleanups.pop()();
  };
  process.once('SIGINT', () => {
    interrupted = true;
    log('\nStopping…');
    cleanUp().finally(() => process.exit(130));
  });

  const environment = environmentFor(subject);
  const spans = {};
  let viewer = null;
  let frames = [];
  let inputs = [];

  try {
    try {
      if (subject.restore) {
        log('Restoring packages…');
        const restore = await runToEnd(
          subject.restore,
          subject.folder,
          environment,
          logFile,
        );
        if (!restore.ok)
          throw new Error(
            `Restoring packages failed:\n${lastLines(restore.text)}`,
          );
      }
      stopIfInterrupted();
      log('Building…');
      const build = await runToEnd(
        subject.build,
        subject.folder,
        environment,
        logFile,
      );
      result.startup.buildMs = build.ms;
      if (!build.ok)
        throw new Error(`The build failed:\n${lastLines(build.text)}`);
      stopIfInterrupted();

      const session = { hellos: [], audio: [], reloads: [] };
      const address = gameAddress(runFolder);
      const relay = await startRelay(address, (message, arrived) => {
        if (message.type === 'hello')
          session.hellos.push({ ...message, arrived });
        else if (message.type === 'audio') session.audio.push(message);
        else if (message.type === 'reloaded') session.reloads.push(message);
      });
      cleanups.push(() => relay.close());

      if (options.frames === 'iosurface') buildSurfaceModule(logFile);
      log('Opening the preview…');
      viewer = await openViewer(relay, logFile);
      cleanups.push(() => viewer.close());
      const details = await viewer.call('details');
      result.tools.electron = details.electron;
      result.machine.displayHz = details.displayHz;

      log('Starting the game…');
      const preview = subject.preview.map((part) =>
        part.replace('{address}', address).replace('{frames}', options.frames),
      );
      if (options['show-game-window'] && subject.showWindowArgument) {
        preview.push(subject.showWindowArgument);
      }
      spans.launched = now();
      const game = startProcess(
        preview,
        subject.folder,
        environment,
        logFile,
      );
      session.game = game;
      cleanups.push(async () => {
        await stopProcess(game);
        await sleep(500);
        if (relay.gameConnected) {
          result.problems.push(
            'The game was still connected after it was stopped; close it by hand if it is still running.',
          );
        }
      });
      const crashed = () =>
        game.exit !== null ||
        (subject.crashPattern !== undefined &&
          new RegExp(subject.crashPattern).test(game.text));
      await waitFor(() => session.hellos.length > 0 || crashed(), 180_000, 100);
      stopIfInterrupted();
      if (session.hellos.length === 0) {
        throw new Error(
          crashed()
            ? `The game stopped before it connected:\n${lastLines(game.text)}`
            : `The game did not connect within three minutes. Its output ends:\n${lastLines(game.text)}`,
        );
      }
      const counts = async () => ({
        ...relay.counts(),
        ...(await viewer.evaluate('window.probe.counts()')),
      });
      const shown = await waitFor(
        async () => (await counts()).displayed > 0,
        30_000,
      );
      stopIfInterrupted();
      if (!shown)
        throw new Error(
          'The game connected, but no frame reached the preview.',
        );
      result.ran = true;
      const hello = session.hellos[0];
      result.game = { ...hello };
      for (const name of ['type', 'pid', 'arrived']) delete result.game[name];
      result.startup.launchToConnectedMs = round(
        hello.arrived - spans.launched,
      );
      if (hello.frames !== options.frames) {
        throw new Error(
          `The game sends ${hello.frames} frames, not ${options.frames}: ${hello.framesError ?? 'it gave no reason'}`,
        );
      }
      result.clocks = {
        game: await relay.gameClock(),
        viewer: await viewerClock(viewer),
      };

      const measureSpan = async (milliseconds) => {
        const before = await counts();
        const start = now();
        await sleep(milliseconds);
        stopIfInterrupted();
        return { start, end: now(), before, after: await counts() };
      };

      log(`Measuring frames for ${seconds} s…`);
      await sleep(2000);
      spans.steady = await measureSpan(seconds * 1000);

      log('Sending input…');
      await viewer.evaluate("document.getElementById('frame').focus()");
      const inputStart = now();
      const keys = ['Right', 'Down', 'Left', 'Up'];
      for (let press = 0; press < 24; press += 1) {
        const key = keys[press % keys.length];
        await viewer.call('key', key, true);
        await sleep(80);
        await viewer.call('key', key, false);
        await sleep(150 + Math.random() * 150);
        stopIfInterrupted();
      }
      await viewer.call('click', 200, 200);
      await sleep(300);
      await viewer.call('key', 'Space', true);
      await sleep(80);
      await viewer.call('key', 'Space', false);
      await sleep(500);
      spans.input = { start: inputStart, end: now() };

      if (subject.reload) {
        log('Reloading code…');
        result.reload = await reloadCode(subject, viewer, session, cleanups);
      }
      stopIfInterrupted();

      log('Checking the measurement…');
      relay.setExtraDelay(CALIBRATION_MS);
      await sleep(1000);
      spans.calibration = await measureSpan(4000);
      relay.setExtraDelay(0);
      await sleep(500);

      log('Freezing a frame…');
      result.freeze = await viewer.evaluate('window.probe.freezeCheck()');
      await sleep(500);
      result.audio = {
        played: session.audio.filter((event) => event.ok).length,
        ok:
          session.audio.length > 0 && session.audio.every((event) => event.ok),
        errors: [
          ...new Set(
            session.audio
              .filter((event) => !event.ok)
              .map((event) => event.error),
          ),
        ],
      };
    } catch (error) {
      result.problems.push(
        redact(error instanceof Error ? error.message : String(error)),
      );
    }
    // Whatever was measured before a problem is still recorded.
    if (viewer && !interrupted) {
      try {
        ({ frames, inputs } = await viewer.evaluate('window.probe.dump()'));
      } catch (error) {
        result.problems.push(`Reading the preview's records failed: ${error}`);
      }
    }
    analyse(result, frames, inputs, spans);
    if (options.interactive && result.ran && !interrupted) {
      // Recorded before playing, so stopping then keeps the measurements.
      result.verdict = verdicts(result);
      printSummary(result, record(result, frames, inputs, recordedAt, subject));
      log(
        '\nThe preview stays open. Play with the arrow keys, Space for a beep and a click to move ' +
          'the square. Compare it with `pnpm probe:preview play`. Close the preview window, ' +
          'or press Enter here, to finish.',
      );
      result.manual = await playThenAsk(viewer);
    }
  } finally {
    await cleanUp();
  }
  if (interrupted) return;

  // Recorded again after stopping, with any answers.
  result.verdict = verdicts(result);
  const file = record(result, frames, inputs, recordedAt, subject);
  if (result.manual) log(`Recorded your answers in ${relative(root, file)}`);
  else printSummary(result, file);
  if (result.problems.length > 0) log(`The run's log is in ${logFile}`);
  else rmSync(runFolder, { recursive: true, force: true });
}

/** Edits the subject's reload file while the game runs, then restores it. */
async function reloadCode(subject, viewer, session, cleanups) {
  const file = join(subject.folder, subject.reload.file);
  const original = readFileSync(file, 'utf8');
  const restore = () => writeFileSync(file, original);
  cleanups.push(restore);
  // The first frame drawn after `since` showing `marker`, or null.
  const waitForMarker = async (marker, since) => {
    let drawn = null;
    await waitFor(
      async () => {
        drawn = await viewer.evaluate(
          `window.probe.firstDrawn(${marker}, ${since})`,
        );
        return drawn !== null || session.game.exit !== null;
      },
      60_000,
      50,
    );
    return drawn;
  };
  const edits = [];
  let text = original;
  for (const edit of subject.reload.edits) {
    for (const [from, to] of edit.replace) {
      if (!text.includes(from))
        throw new Error(`The reload edit "${edit.name}" no longer matches.`);
      text = text.replace(from, to);
    }
    if (interrupted) break;
    const pid = session.hellos[session.hellos.length - 1].pid;
    const appliedBefore = session.reloads.length;
    const edited = now();
    writeFileSync(file, text);
    const drawn = await waitForMarker(edit.expect, edited);
    const applied = session.reloads[appliedBefore];
    edits.push({
      edit: edit.name,
      restartExpected: edit.restartExpected === true,
      shown: drawn !== null,
      restarted: session.hellos.some(
        (hello) => hello.arrived > edited && hello.pid !== pid,
      ),
      editToAppliedMs: applied ? round(applied.time - edited) : null,
      editToVisibleMs: drawn === null ? null : round(drawn - edited),
    });
    await sleep(1500);
  }
  const edited = now();
  restore();
  const drawn = interrupted
    ? null
    : await waitForMarker(subject.reload.initial, edited);
  return { edits, restoredMs: drawn === null ? null : round(drawn - edited) };
}

/**
 * Waits while the person plays, until they close the preview or press Enter,
 * then asks what only they can judge. Lines are read in turn, so answers
 * typed ahead are kept.
 */
async function playThenAsk(viewer) {
  const terminal = createInterface({ input: process.stdin });
  const lines = terminal[Symbol.asyncIterator]();
  const nextLine = () =>
    lines.next().then(({ value, done }) => (done ? '' : value.trim()));
  let waiting = nextLine();
  const finished = await Promise.race([
    viewer.closed.then(() => 'closed'),
    waiting.then(() => 'enter'),
  ]);
  if (finished === 'enter') waiting = null;
  if (interrupted) {
    terminal.close();
    return null;
  }
  await viewer.close();
  const ask = async (question) => {
    process.stdout.write(question);
    const line = await (waiting ?? nextLine());
    waiting = null;
    return line;
  };
  try {
    const heard = await ask('Did you hear the beeps? (y/n, Enter to skip) ');
    const feel = await ask(
      'How did the preview feel compared with Play? (Enter to skip) ',
    );
    return {
      heardSound: heard === '' ? null : /^y/i.test(heard),
      feel: feel === '' ? null : feel,
    };
  } finally {
    terminal.close();
  }
}

function record(result, frames, inputs, recordedAt, subject) {
  mkdirSync(resultsFolder, { recursive: true });
  const stamp = recordedAt.toISOString().slice(0, 16).replace(':', '');
  const id = [
    stamp,
    platform(),
    arch(),
    subject.id,
  ]
    .filter(Boolean)
    .join('-');
  const file = join(resultsFolder, `${id}.json`);
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  if (frames.length === 0) return file;
  // Every frame's and input's times, relative to the first frame, so the
  // summary can be checked by hand.
  const origin = frames[0][FRAME.update];
  const time = (value) =>
    value === 0 ? null : Math.round((value - origin) * 100) / 100;
  writeFileSync(
    join(resultsFolder, `${id}.samples.json`),
    `${JSON.stringify({
      origin,
      frameColumns,
      frames: frames.map((row) =>
        row.map((value, column) =>
          frameTimeColumns.has(column) ? time(value) : value,
        ),
      ),
      inputColumns,
      inputs: inputs.map(([seq, sent, code, down]) => [
        seq,
        time(sent),
        code,
        down,
      ]),
    })}\n`,
  );
  return file;
}

async function play() {
  const subject = loadSubject(options.subject);
  log(
    `Playing ${subject.name} in its own window. Close it, or press Escape, to finish.`,
  );
  const [file, ...args] = subject.play;
  const child = spawn(file, args, {
    cwd: subject.folder,
    env: environmentFor(subject),
    stdio: 'inherit',
  });
  await new Promise((done, failed) => {
    child.on('exit', done);
    child.on('error', failed);
  });
}

function compare() {
  const files = existsSync(resultsFolder)
    ? readdirSync(resultsFolder).filter(
        (name) => name.endsWith('.json') && !name.endsWith('.samples.json'),
      )
    : [];
  if (files.length === 0) {
    log('No results yet. Run `pnpm probe:preview` first.');
    return;
  }
  const results = files
    .map((name) => JSON.parse(readFileSync(join(resultsFolder, name), 'utf8')))
    .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const pair = (stats) => (stats ? `${stats.p50} / ${stats.p95}` : '–');
  const rows = results.map((result) => {
    const reload = result.reload?.edits ?? [];
    const body = reload.find((edit) => !edit.restartExpected);
    const restart = reload.find((edit) => edit.restartExpected);
    return [
      result.recordedAt.slice(0, 16).replace('T', ' '),
      `${result.machine.os} ${result.machine.arch}`,
      String(result.machine.displayHz ?? '–'),
      result.subject.name,
      result.settings.frames ?? 'raw',
      result.sandbox ? 'yes' : 'no',
      result.ran ? 'yes' : 'no',
      result.frames ? String(result.frames.displayedFps) : '–',
      result.frames ? String(result.frames.longGaps) : '–',
      pair(result.frames?.delayMs),
      pair(result.input?.addedDelayMs),
      body?.shown ? `${body.editToVisibleMs}` : '–',
      restart?.shown ? `${restart.editToVisibleMs}` : '–',
      result.audio ? (result.audio.ok ? 'ok' : 'failed') : '–',
      result.verdict.measurement,
    ];
  });
  const header = [
    'Recorded (UTC)',
    'Computer',
    'Display Hz',
    'Subject',
    'Frames',
    'Sandbox',
    'Ran',
    'Shown fps',
    'Long gaps',
    'Frame delay p50 / p95 ms',
    'Added delay p50 / p95 ms',
    'Method reload ms',
    'Restart reload ms',
    'Sound',
    'Measurement',
  ];
  log(`| ${header.join(' | ')} |`);
  log(`| ${header.map(() => '---').join(' | ')} |`);
  for (const row of rows) log(`| ${row.join(' | ')} |`);
}

const command = positionals[0] ?? 'run';
const commands = { run: measure, play, compare };
if (!(command in commands)) {
  reportError(`Unknown command "${command}". Use run, play or compare.`);
  process.exit(1);
}
try {
  await commands[command]();
} catch (error) {
  reportError(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
