/**
 * Makes each platform's icon files from the one source, `assets/playstead-icon.svg`,
 * a full-bleed tile. macOS's icon gets the padding and shadow of its icon
 * grid; Windows, Linux and the favicon use the tile as it is.
 *
 * Follows T3 Code's `scripts/export-brand-icons.ts` and
 * `scripts/lib/icon-export.ts` (the outputs, the `.ico` sizes and `--check`).
 * T3 Code renders an Icon Composer project with Apple's `ictool`, which only
 * macOS has; Playstead's source is an SVG, rendered by resvg on any OS.
 *
 *   node scripts/export-icons.ts           write the files that changed
 *   node scripts/export-icons.ts --check   fail if any file is out of date
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Resvg } from "@resvg/resvg-js";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

const SOURCE = "assets/playstead-icon.svg";

/** T3 Code's `WINDOWS_ICON_SIZES`. */
const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const FAVICON_ICO_SIZES = [16, 32, 48];

/** Apple's icon grid at 1024: an 824 body, 100 in from each edge, over a soft shadow. */
const MAC_CANVAS = 1024;
const MAC_INSET = 100;
const MAC_BODY = MAC_CANVAS - 2 * MAC_INSET;

/** Each `.icns` entry's type and pixel size; every entry holds a PNG. */
const ICNS_ENTRIES: ReadonlyArray<readonly [string, number]> = [
  ["icp4", 16],
  ["icp5", 32],
  ["icp6", 64],
  ["ic07", 128],
  ["ic08", 256],
  ["ic09", 512],
  ["ic10", 1024],
  ["ic11", 32],
  ["ic12", 64],
  ["ic13", 256],
  ["ic14", 512],
];

const svgContents = (svg: string) =>
  svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const svgViewBox = (svg: string) => /viewBox="([^"]+)"/.exec(svg)?.[1] ?? "0 0 512 512";

/** The tile inside macOS's padding, over the shadow macOS icons cast. */
const macComposition = (source: string) =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${MAC_CANVAS}" height="${MAC_CANVAS}" viewBox="0 0 ${MAC_CANVAS} ${MAC_CANVAS}">`,
    `<defs><filter id="mac-shadow" x="-20%" y="-20%" width="140%" height="140%">`,
    `<feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#000000" flood-opacity="0.3"/>`,
    `</filter></defs>`,
    `<g filter="url(#mac-shadow)">`,
    `<svg x="${MAC_INSET}" y="${MAC_INSET}" width="${MAC_BODY}" height="${MAC_BODY}" viewBox="${svgViewBox(source)}">`,
    svgContents(source),
    `</svg></g></svg>`,
  ].join("");

const render = (svg: string, size: number): Uint8Array =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

const concat = (parts: ReadonlyArray<Uint8Array>) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
};

/** An `.ico` holding one PNG per size, as Windows Vista and later read them. */
const encodeIco = (svg: string, sizes: ReadonlyArray<number>) => {
  const images = sizes.map((size) => render(svg, size));
  const header = new DataView(new ArrayBuffer(6 + 16 * sizes.length));
  header.setUint16(2, 1, true);
  header.setUint16(4, sizes.length, true);
  let offset = header.byteLength;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header.setUint8(entry, size >= 256 ? 0 : size);
    header.setUint8(entry + 1, size >= 256 ? 0 : size);
    header.setUint16(entry + 4, 1, true);
    header.setUint16(entry + 6, 32, true);
    header.setUint32(entry + 8, images[index]!.byteLength, true);
    header.setUint32(entry + 12, offset, true);
    offset += images[index]!.byteLength;
  });
  return concat([new Uint8Array(header.buffer), ...images]);
};

/** An `.icns` of PNG entries, which macOS reads on every OS that builds it. */
const encodeIcns = (svg: string) => {
  const entries = ICNS_ENTRIES.map(([type, size]) => {
    const png = render(svg, size);
    const head = new DataView(new ArrayBuffer(8));
    for (let index = 0; index < 4; index++) head.setUint8(index, type.charCodeAt(index));
    head.setUint32(4, 8 + png.byteLength);
    return concat([new Uint8Array(head.buffer), png]);
  });
  const head = new DataView(new ArrayBuffer(8));
  for (let index = 0; index < 4; index++) head.setUint8(index, "icns".charCodeAt(index));
  head.setUint32(4, 8 + entries.reduce((total, entry) => total + entry.byteLength, 0));
  return concat([new Uint8Array(head.buffer), ...entries]);
};

/** Every exported file, by its path from the repository root. */
const makeOutputs = (source: string): ReadonlyArray<readonly [string, Uint8Array]> => {
  const mac = macComposition(source);
  return [
    ["assets/icons/playstead-macos-1024.png", render(mac, 1024)],
    ["assets/icons/playstead-macos.icns", encodeIcns(mac)],
    ["assets/icons/playstead-universal-1024.png", render(source, 1024)],
    ["assets/icons/playstead-windows.ico", encodeIco(source, WINDOWS_ICON_SIZES)],
    ["apps/web/public/favicon.ico", encodeIco(source, FAVICON_ICO_SIZES)],
    ["apps/web/public/favicon-16x16.png", render(source, 16)],
    ["apps/web/public/favicon-32x32.png", render(source, 32)],
    ["apps/web/public/apple-touch-icon.png", render(source, 180)],
  ];
};

const sameBytes = (left: Uint8Array, right: Uint8Array) =>
  left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);

/**
 * Writes the outputs that differ from what is on disk, or with `check` only
 * lists them. Returns their paths from the repository root.
 */
export const exportIcons = Effect.fn("exportIcons")(function* (options: {
  readonly repoRoot: string;
  readonly check: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = yield* fs.readFileString(path.join(options.repoRoot, SOURCE));
  const changed: Array<string> = [];
  for (const [file, contents] of makeOutputs(source)) {
    const target = path.join(options.repoRoot, ...file.split("/"));
    const current = yield* fs.readFile(target).pipe(Effect.option);
    if (current._tag === "Some" && sameBytes(current.value, contents)) continue;
    changed.push(file);
    if (options.check) continue;
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    yield* fs.writeFile(temporary, contents);
    yield* fs.rename(temporary, target);
  }
  return changed;
});

if (import.meta.main) {
  const check = process.argv.includes("--check");
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const changed = yield* exportIcons({ repoRoot: path.join(import.meta.dirname, ".."), check });
    if (check && changed.length > 0) {
      yield* Console.error(
        `These icon files are out of date; run \`vp run icons:export\`:\n${changed.join("\n")}`,
      );
      return yield* Effect.die("Icon files are out of date.");
    }
    yield* Console.log(
      changed.length === 0 ? "Every icon file is current." : `Wrote:\n${changed.join("\n")}`,
    );
  }).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
