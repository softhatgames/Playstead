/**
 * Playstead's identity, defined once. The server, the desktop app, the
 * interface and the build scripts read these values here instead of spelling
 * them out. Playstead runs beside the installed T3 Code, so none of them may
 * equal T3 Code's.
 *
 * T3 Code spreads the same values over its desktop environment, user-data and
 * state-path modules, its Electron protocol, its web branding and its server
 * config (see docs/ARCHITECTURE.md, "Identity").
 */

const urlScheme = {
  production: "playstead",
  development: "playstead-dev",
} as const;

export const identity = {
  /** The name people see, in the window, dock or taskbar and installer. */
  productName: {
    production: "Playstead",
    development: "Playstead (Dev)",
  },
  /** The macOS bundle id and the Windows AppUserModelID. */
  appId: {
    production: "com.softhatgames.playstead",
    development: "com.softhatgames.playstead.dev",
  },
  /** The URL scheme, which also serves the interface to the desktop window. */
  urlScheme,
  /** Where the desktop window loads the interface from. */
  windowUrl: {
    production: `${urlScheme.production}://app/`,
    development: `${urlScheme.development}://app/`,
  },
  /**
   * The Playstead home: the base data directory, `~/.playstead` unless the
   * variable moves it. Runtime state goes in one area under it, development
   * state in another, and a worktree in development uses its own home.
   */
  home: {
    directoryName: ".playstead",
    variable: "PLAYSTEAD_HOME",
    stateDirectoryName: {
      production: "userdata",
      development: "dev",
    },
    worktreeDirectoryName: ".playstead",
  },
  /**
   * Electron's user-data folder. `playstead-v1` follows T3 Code's `t3code-v2`
   * and avoids v0's `Playstead` folder, which a case-insensitive disk would
   * treat as the same name as `playstead`.
   */
  electronUserDataFolder: {
    production: "playstead-v1",
    development: "playstead-dev",
  },
  /** The prefix of every environment variable Playstead reads. */
  environmentVariablePrefix: "PLAYSTEAD_",
  /** The HTTP path where the server describes its environment. */
  environmentDescriptorPath: "/.well-known/playstead/environment",
} as const;
