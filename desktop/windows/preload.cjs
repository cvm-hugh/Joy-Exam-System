'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('joyDesktop', Object.freeze({
  exportSession: Object.freeze({ postMessage: (message) => ipcRenderer.invoke('joy-export-session', message).catch(() => false) }),
  switchStage: (stage) => ipcRenderer.send('joy-stage', stage),
  openDataDirectory: () => ipcRenderer.send('joy-open-data'),
  onStatus: (callback) => {
    const listener = (_event, text) => callback(String(text));
    ipcRenderer.on('joy-status', listener);
    return () => ipcRenderer.removeListener('joy-status', listener);
  },
}));
ipcRenderer.on('joy-export-cancelled', () => window.dispatchEvent(new CustomEvent('desktop-export-cancelled')));
ipcRenderer.on('joy-stage-active', (_event, stage) => window.dispatchEvent(new CustomEvent('desktop-stage-active', { detail: stage })));

// Streamlit sends workflow events from its own component iframe.
window.addEventListener('message', (event) => {
  if (location.origin !== 'http://127.0.0.1:8510' || event.data?.type !== 'joy-workflow' || event.data?.target !== 'results') return;
  if (event.origin !== location.origin && event.origin !== 'null') return;
  let source = event.source;
  for (let depth = 0; source && depth < 24; depth++) {
    if (source === window) { ipcRenderer.send('joy-stage', 'results'); return; }
    try { if (source.parent === source) return; source = source.parent; } catch { return; }
  }
});
