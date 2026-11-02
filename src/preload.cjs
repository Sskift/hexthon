const { contextBridge, ipcRenderer } = require('electron');
const call = async (name, arg) => {
  const result = await ipcRenderer.invoke(name, arg);
  if (!result.ok) throw new Error(result.error);
  return result.data;
};
contextBridge.exposeInMainWorld('hexthon', {
  getState: () => call('get-state'), saveSettings: p => call('save-settings', p),
  selectChampion: key => call('select-champion', key), followChampion: () => call('follow-champion'),
  refresh: () => call('refresh'), setOffers: ids => call('set-offers', ids), scan: () => call('scan'),
  importImage: () => call('import-image'), toggleOverlay: () => call('toggle-overlay'),
  confirmMode: value => call('confirm-mode', value), openSource: kind => call('open-source', kind),
  onState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('state', listener); return () => ipcRenderer.removeListener('state', listener); },
});
