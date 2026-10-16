import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Resvg } from "@resvg/resvg-js";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { exportIcons } from "./export-icons.ts";

/** A PNG's RGBA pixels, read back through the same rasteriser. */
const pixelsOf = (png: Uint8Array, size: number) => {
  const href = `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><image href="${href}" width="${size}" height="${size}"/></svg>`;
  const image = new Resvg(svg).render();
  return {
    width: image.width,
    alphaAt: (x: number, y: number) => image.pixels[(y * image.width + x) * 4 + 3]!,
  };
};

const pngSize = (png: Uint8Array) => {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
};

/** The sizes in an `.ico`'s directory; 0 stands for 256. */
const icoSizes = (ico: Uint8Array) => {
  const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
  return Array.from({ length: view.getUint16(4, true) }, (_, index) => ico[6 + index * 16] || 256);
};

/** The four-letter entry types in an `.icns`. */
const icnsTypes = (icns: Uint8Array) => {
  const view = new DataView(icns.buffer, icns.byteOffset, icns.byteLength);
  const types: Array<string> = [];
  for (let offset = 8; offset < icns.byteLength; offset += view.getUint32(offset + 4)) {
    types.push(Buffer.from(icns.subarray(offset, offset + 4)).toString("latin1"));
  }
  return { magic: Buffer.from(icns.subarray(0, 4)).toString("latin1"), types };
};

describe("icon export", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("makes each platform's files from the full-tile source, padding only macOS's", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "playstead-icons-" });
        yield* fs.makeDirectory(path.join(root, "assets"), { recursive: true });
        yield* fs.copyFile(
          path.join(import.meta.dirname, "..", "assets", "playstead-icon.svg"),
          path.join(root, "assets", "playstead-icon.svg"),
        );

        const written = yield* exportIcons({ repoRoot: root, check: false });
        const read = (file: string) => fs.readFile(path.join(root, file));

        assert.includeMembers(
          [...written],
          [
            "assets/icons/playstead-macos-1024.png",
            "assets/icons/playstead-macos.icns",
            "assets/icons/playstead-universal-1024.png",
            "assets/icons/playstead-windows.ico",
            "apps/web/public/favicon.ico",
            "apps/web/public/favicon-16x16.png",
            "apps/web/public/favicon-32x32.png",
            "apps/web/public/apple-touch-icon.png",
          ],
        );

        const universal = yield* read("assets/icons/playstead-universal-1024.png");
        assert.deepStrictEqual(pngSize(universal), { width: 1024, height: 1024 });
        const tile = pixelsOf(universal, 1024);
        assert.strictEqual(tile.alphaAt(512, 40), 255, "the tile reaches the edge");

        const mac = yield* read("assets/icons/playstead-macos-1024.png");
        assert.deepStrictEqual(pngSize(mac), { width: 1024, height: 1024 });
        const padded = pixelsOf(mac, 1024);
        assert.strictEqual(padded.alphaAt(512, 40), 0, "macOS's icon sits inside its padding");
        assert.strictEqual(padded.alphaAt(512, 512), 255);

        assert.deepStrictEqual(
          icoSizes(yield* read("assets/icons/playstead-windows.ico")),
          [16, 24, 32, 48, 64, 128, 256],
        );
        assert.deepStrictEqual(icoSizes(yield* read("apps/web/public/favicon.ico")), [16, 32, 48]);
        assert.deepStrictEqual(icnsTypes(yield* read("assets/icons/playstead-macos.icns")), {
          magic: "icns",
          types: [
            "icp4",
            "icp5",
            "icp6",
            "ic07",
            "ic08",
            "ic09",
            "ic10",
            "ic11",
            "ic12",
            "ic13",
            "ic14",
          ],
        });
        assert.deepStrictEqual(pngSize(yield* read("apps/web/public/apple-touch-icon.png")), {
          width: 180,
          height: 180,
        });

        assert.deepStrictEqual(
          [...(yield* exportIcons({ repoRoot: root, check: true }))],
          [],
          "a second run finds every file current",
        );
        yield* fs.writeFileString(path.join(root, "apps/web/public/favicon.ico"), "stale");
        assert.deepStrictEqual(
          [...(yield* exportIcons({ repoRoot: root, check: true }))],
          ["apps/web/public/favicon.ico"],
        );
      }).pipe(Effect.scoped),
    );
  });
});
