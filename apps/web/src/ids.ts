/** A random id for commands, threads and messages the interface creates. */
export const newId = (): string =>
  Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
