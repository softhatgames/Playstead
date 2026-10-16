// The preview page's preload, in Electron's sandbox: it receives frames the
// shell imported from the game's shared GPU surfaces and hands each to the
// page as a VideoFrame, then releases it so the game can reuse its surface.
/* global require */
// A sandboxed preload must be CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, sharedTexture } = require('electron');

let receiver = null;
sharedTexture.setSharedTextureReceiver(
  async ({ importedSharedTexture }, header, shellIn, shellSent) => {
    const frame = importedSharedTexture.getVideoFrame();
    try {
      if (receiver) await receiver(frame, header, shellIn, shellSent);
    } finally {
      frame.close();
      importedSharedTexture.release();
    }
  },
);

contextBridge.exposeInMainWorld('sharedFrames', {
  onFrame(callback) {
    receiver = callback;
  },
});
