// Observe the real vendored terminal without exposing application state in
// production. Each replacement instance becomes the current test terminal.
async function installTerminalProbe(page) {
  await page.addInitScript(() => {
    let constructor;
    Object.defineProperty(window, 'Terminal', {
      configurable: true,
      get: () => constructor,
      set(Terminal) {
        constructor = class extends Terminal {
          constructor(...args) {
            super(...args);
            window.testTerminal = this;
          }
        };
      },
    });
  });
}
module.exports = { installTerminalProbe };
