// Roda em document_start (isolated world) — desregistra SWs e intercepta a tag do map.js
(function () {
  // 1) Desregistra service workers do MapGenie para que o declarativeNetRequest funcione
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => {
        console.log('[CDCompanion] unregistering SW:', r.scope);
        r.unregister();
      });
    });
  }

  // 2) Intercepta a tag <script src="cdn.mapgenie.io/js/map.js..."> antes de ser fetchada
  const overrideUrl = chrome.runtime.getURL('vendor/map.js');
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      for (const node of mut.addedNodes) {
        if (node.nodeType !== 1) continue;
        // Script direto
        if (node.tagName === 'SCRIPT' && node.src && node.src.includes('cdn.mapgenie.io/js/map.js')) {
          node.src = overrideUrl;
          console.log('[CDCompanion] map.js script tag interceptado → local override');
        }
        // Script dentro de um nó pai adicionado de uma vez
        node.querySelectorAll?.('script[src*="cdn.mapgenie.io/js/map.js"]').forEach((s) => {
          s.src = overrideUrl;
          console.log('[CDCompanion] map.js script tag interceptado (nested) → local override');
        });
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
