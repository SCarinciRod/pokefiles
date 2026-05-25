const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bootApi', {
  onStatus(callback) {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, message) => {
      callback(message);
    };

    ipcRenderer.on('boot:status', listener);
    return () => {
      ipcRenderer.removeListener('boot:status', listener);
    };
  }
});

ipcRenderer.send('boot:ready');
