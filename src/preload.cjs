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
  windowAction: action => call('window-action', action), setSelectedAugments: ids => call('set-selected-augments', ids),
  confirmSelectedAugment: id => call('confirm-selected-augment', id),
  undoSelectedCorrection: () => call('undo-selected-correction'),
  probeNativeItemSets:()=>call('native-itemsets-probe'),importNativeItemSet:()=>call('native-itemsets-import'),restoreNativeItemSets:()=>call('native-itemsets-restore'),
  exportDiagnostics:()=>call('export-diagnostics'),
  checkUpdates:()=>call('updates-check'),downloadUpdate:()=>call('updates-stage'),applyUpdate:()=>call('updates-apply'),
  onState: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('state', listener); return () => ipcRenderer.removeListener('state', listener); },
});
