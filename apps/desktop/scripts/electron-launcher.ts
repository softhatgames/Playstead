// @effect-diagnostics nodeBuiltinImport:off -- A launcher script on plain Node, as T3 Code's is.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";

import { identity } from "@playstead/shared/identity";

/**
 * How the desktop app's Electron is found and started, after T3 Code's
 * `apps/desktop/scripts/electron-launcher.mjs`. On macOS the development app
 * runs from a copy of Electron's bundle carrying Playstead's development name,
 * bundle id and icon, so the Dock shows Playstead (Dev) beside T3 Code.
 */

export const desktopDir = NodePath.join(import.meta.dirname, "..");
const repoRoot = NodePath.join(desktopDir, "..", "..");
const require = NodeModule.createRequire(import.meta.url);

/**
 * The shell's variables that must not reach the app: T3 Code's own, which its
 * agent shells carry, and `ELECTRON_RUN_AS_NODE`, which would start Electron
 * as plain Node (T3 Code's `dev-electron.mjs` deletes it too).
 */
const isLeakedVariable = (name: string) => {
  const upper = name.toUpperCase();
  return (
    upper === "ELECTRON_RUN_AS_NODE" ||
    upper === "CLAUDECODE" ||
    upper.startsWith("T3CODE_") ||
    upper.startsWith("CLAUDE_CODE_")
  );
};

export const createElectronEnv = (
  baseEnv: Readonly<Record<string, string | undefined>>,
): Record<string, string> => {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (value !== undefined && !isLeakedVariable(name)) env[name] = value;
  }
  return env;
};

/**
 * Electron's binary. `require("electron")` runs Electron's own installer the
 * first time, which downloads the build and checks it against the package's
 * checksums, then caches it once per machine.
 */
const resolveElectronBinary = (): string => {
  const binary: unknown = require("electron");
  if (typeof binary !== "string") {
    throw new Error("`electron` resolved to a module, not a path: is ELECTRON_RUN_AS_NODE set?");
  }
  return binary;
};

const run = (command: string, args: ReadonlyArray<string>) => {
  const result = NodeChildProcess.spawnSync(command, args, { stdio: ["ignore", "ignore", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr?.toString() ?? ""}`);
  }
};

const setPlistString = (plist: string, key: string, value: string) =>
  run("plutil", ["-replace", key, "-string", value, plist]);

const MAC_HELPERS = [
  ["Electron Helper.app", "helper", "Helper"],
  ["Electron Helper (GPU).app", "helper.gpu", "Helper (GPU)"],
  ["Electron Helper (Plugin).app", "helper.plugin", "Helper (Plugin)"],
  ["Electron Helper (Renderer).app", "helper.renderer", "Helper (Renderer)"],
] as const;

/**
 * A copy of `Electron.app` named Playstead (Dev), with the development bundle
 * id and the exported icon, signed ad hoc and registered with Launch
 * Services. It is made again only when Electron, the identity or the icon
 * changes.
 */
const ensureMacDevelopmentBundle = (electronBinary: string): string => {
  const sourceBundle = NodePath.resolve(electronBinary, "..", "..", "..");
  const displayName = identity.productName.development;
  const appId = identity.appId.development;
  const runtimeDir = NodePath.join(desktopDir, ".electron-runtime");
  const bundle = NodePath.join(runtimeDir, `${displayName}.app`);
  const icon = NodePath.join(repoRoot, "assets", "icons", "playstead-macos.icns");
  const metadataPath = NodePath.join(runtimeDir, "metadata.json");
  const metadata = JSON.stringify({
    electron: NodeFS.readFileSync(NodePath.join(sourceBundle, "..", "version"), "utf8").trim(),
    displayName,
    appId,
    icon: NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(icon)).digest("hex"),
  });
  const executable = NodePath.join(bundle, "Contents", "MacOS", "Electron");
  if (
    NodeFS.existsSync(executable) &&
    NodeFS.existsSync(metadataPath) &&
    NodeFS.readFileSync(metadataPath, "utf8") === metadata
  ) {
    return executable;
  }

  NodeFS.rmSync(runtimeDir, { recursive: true, force: true });
  NodeFS.mkdirSync(runtimeDir, { recursive: true });
  NodeFS.cpSync(sourceBundle, bundle, { recursive: true, verbatimSymlinks: true });
  const plist = NodePath.join(bundle, "Contents", "Info.plist");
  setPlistString(plist, "CFBundleDisplayName", displayName);
  setPlistString(plist, "CFBundleName", displayName);
  setPlistString(plist, "CFBundleIdentifier", appId);
  setPlistString(plist, "CFBundleIconFile", "icon.icns");
  NodeFS.copyFileSync(icon, NodePath.join(bundle, "Contents", "Resources", "icon.icns"));
  for (const [helper, suffix, label] of MAC_HELPERS) {
    const helperPlist = NodePath.join(
      bundle,
      "Contents",
      "Frameworks",
      helper,
      "Contents",
      "Info.plist",
    );
    if (!NodeFS.existsSync(helperPlist)) continue;
    setPlistString(helperPlist, "CFBundleIdentifier", `${appId}.${suffix}`);
    setPlistString(helperPlist, "CFBundleName", `${displayName} ${label}`);
  }
  run("codesign", ["--force", "--deep", "--sign", "-", bundle]);
  run(
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
    ["-f", bundle],
  );
  NodeFS.writeFileSync(metadataPath, metadata);
  return executable;
};

/** The command that starts the desktop app from `dist-electron/`. */
export const resolveElectronCommand = (options: { readonly development: boolean }) => {
  const binary = resolveElectronBinary();
  const command =
    options.development && process.platform === "darwin"
      ? ensureMacDevelopmentBundle(binary)
      : binary;
  return { command, args: [desktopDir] };
};
