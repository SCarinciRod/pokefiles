const statusNode = document.getElementById('boot-status');

if (window.bootApi && typeof window.bootApi.onStatus === 'function') {
  window.bootApi.onStatus((message) => {
    if (!statusNode) {
      return;
    }

    const text = String(message || '').trim();
    if (text) {
      statusNode.textContent = text;
    }
  });
}
