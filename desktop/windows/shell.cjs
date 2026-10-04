for (const stage of ['scanner', 'results']) document.getElementById(stage).onclick = () => {
  window.joyDesktop.switchStage(stage);
  for (const name of ['scanner', 'results']) document.getElementById(name).setAttribute('aria-pressed', String(name === stage));
};
document.getElementById('data').onclick = () => window.joyDesktop.openDataDirectory();
window.joyDesktop.onStatus((text) => { document.getElementById('status').textContent = text; });
window.addEventListener('desktop-stage-active', (event) => {
  for (const name of ['scanner', 'results']) document.getElementById(name).setAttribute('aria-pressed', String(name === event.detail));
});
