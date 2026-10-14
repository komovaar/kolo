// The loading screen also works when the React bundle cannot be downloaded.
window.KoloStartup = {
  fail() {
    window.KoloController?.suspend?.();
    for (const selector of ['.app', '.signin']) document.querySelector(selector).hidden = true;
    document.querySelector('.boot').hidden = false;
    document.querySelector('.boot-message').textContent = 'Could not load the workspace. Reload to try again.';
    const retry = document.querySelector('.boot-retry');
    retry.hidden = false;
    retry.disabled = false;
    retry.onclick = () => location.reload();
  },
};
document.addEventListener('error', (event) => {
  if (event.target?.id === 'workspace-code') window.KoloStartup.fail();
}, true);
