const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pokedexApi', {
  ask(prompt) {
    return ipcRenderer.invoke('bot:ask', prompt);
  },
  reset() {
    return ipcRenderer.invoke('bot:reset');
  },
  ping() {
    return ipcRenderer.invoke('bot:ping');
  },
  listSprites() {
    return ipcRenderer.invoke('sprites:list');
  },
  listPokemon() {
    return ipcRenderer.invoke('pokedex:list');
  },
  getPokemonDetail(identifier) {
    return ipcRenderer.invoke('pokedex:detail', identifier);
  }
});
