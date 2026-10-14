// Apply the saved appearance before styles load to avoid a flash of another theme.
(() => {
  let theme = 'dark';
  try { theme = localStorage.getItem('kolo-theme') === 'light' ? 'light' : 'dark'; } catch (_) {}
  document.documentElement.dataset.theme = theme;
  addEventListener('storage', (event) => {
    if (event.key !== 'kolo-theme') return;
    document.documentElement.dataset.theme = event.newValue === 'light' ? 'light' : 'dark';
  });
})();
