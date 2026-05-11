// Background service worker — conecta ao position server e retransmite para content scripts

const DEFAULT_HOST = 'localhost';
const DEFAULT_WS_PORT = 7891;
const DEFAULT_WSS_PORT = 7892;
const RECONNECT_MS = 3000;

let wsUrls = [];
let wsUrlIndex = 0;
let ws = null;
const ports = new Set();
let lastWaypoints = null;

// Carrega configuração de host/porta salva pelo popup
async function loadWsUrls() {
  try {
    const data = await chrome.storage.local.get(['wsHost', 'wsPort', 'wssPort']);
    const host = data.wsHost || DEFAULT_HOST;
    const port = data.wsPort || DEFAULT_WS_PORT;
    const sslPort = data.wssPort || DEFAULT_WSS_PORT;
    wsUrls = [`ws://${host}:${port}`, `wss://${host}:${sslPort}`];
  } catch (_) {
    wsUrls = [`ws://${DEFAULT_HOST}:${DEFAULT_WS_PORT}`, `wss://${DEFAULT_HOST}:${DEFAULT_WSS_PORT}`];
  }
}

// Reconecta quando as configurações mudam
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.wsHost || changes.wsPort || changes.wssPort) {
    loadWsUrls().then(() => {
      wsUrlIndex = 0;
      if (ws) {
        try { ws.close(); } catch (_) {}
        ws = null;
      }
      connect();
      chrome.storage.local.get(['wsHost', 'wsPort', 'wssPort'], (data) => {
        const msg = { type: 'server_config',
          wsHost: data.wsHost || DEFAULT_HOST,
          wsPort: data.wsPort || DEFAULT_WS_PORT,
          wssPort: data.wssPort || DEFAULT_WSS_PORT };
        for (const port of ports) {
          try { port.postMessage(msg); } catch (_) {}
        }
      });
    });
  }
});

// Content scripts conectam via port para receber posição e enviar comandos
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cdp') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener((msg) => {
    if (msg.cmd === 'get_server_config') {
      chrome.storage.local.get(['wsHost', 'wsPort', 'wssPort'], (data) => {
        try { port.postMessage({ type: 'server_config',
          wsHost: data.wsHost || DEFAULT_HOST,
          wsPort: data.wsPort || DEFAULT_WS_PORT,
          wssPort: data.wssPort || DEFAULT_WSS_PORT }); } catch (_) {}
      });
      return;
    }
    if (msg.cmd === 'set_server_config') {
      const toSet = {};
      const toRemove = [];
      if (msg.wsHost  !== undefined) msg.wsHost  ? (toSet.wsHost  = msg.wsHost)  : toRemove.push('wsHost');
      if (msg.wsPort  !== undefined) msg.wsPort  ? (toSet.wsPort  = msg.wsPort)  : toRemove.push('wsPort');
      if (msg.wssPort !== undefined) msg.wssPort ? (toSet.wssPort = msg.wssPort) : toRemove.push('wssPort');
      if (Object.keys(toSet).length) chrome.storage.local.set(toSet);
      if (toRemove.length) chrome.storage.local.remove(toRemove);
      return;
    }
    // Repassa comandos do content script para o servidor
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  });
  // Informa o estado atual imediatamente ao conectar
  port.postMessage({ type: 'status', connected: ws && ws.readyState === WebSocket.OPEN });
  chrome.storage.local.get(['wsHost', 'wsPort', 'wssPort'], (data) => {
    try { port.postMessage({ type: 'server_config',
      wsHost: data.wsHost || DEFAULT_HOST,
      wsPort: data.wsPort || DEFAULT_WS_PORT,
      wssPort: data.wssPort || DEFAULT_WSS_PORT }); } catch (_) {}
  });
  if (lastWaypoints) port.postMessage(lastWaypoints);
});

function broadcast(msg) {
  for (const port of ports) {
    try { port.postMessage(msg); } catch (_) {}
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  if (!wsUrls.length) return;

  const url = wsUrls[wsUrlIndex % wsUrls.length];
  ws = new WebSocket(url);
  console.log('[CDCompanion bg] trying', url);

  ws.addEventListener('open', () => {
    console.log('[CDCompanion bg] connected');
    broadcast({ type: 'status', connected: true });
  });

  ws.addEventListener('message', (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg && msg.type === 'waypoints') lastWaypoints = msg;
      broadcast(msg);
    } catch (_) {}
  });

  ws.addEventListener('close', () => {
    broadcast({ type: 'status', connected: false });
    setTimeout(connect, RECONNECT_MS);
  });

  ws.addEventListener('error', (e) => {
    console.error('[CDCompanion bg] ws error on', url);
    wsUrlIndex++;  // tenta próxima URL no próximo reconnect
    broadcast({ type: 'status', connected: false });
  });
}

// Inicializa: carrega config e conecta
loadWsUrls().then(connect);
