// Roda no mundo isolado — tem acesso a chrome.runtime
// Faz ponte entre background.js e content.js (MAIN world) via postMessage

if (window.__cdpBridge) {
  // A aba pode receber injeção manual pelo popup; evita portas duplicadas.
} else {
window.__cdpBridge = true;


const RECONNECT_MS = 3000;
let port = null;
let mainReady = false;
const pendingMessages = [];

function sendToMain(msg) {
  if (!mainReady) {
    pendingMessages.push(msg);
    return;
  }
  window.postMessage({ __cdpFrom: 'background', payload: msg }, '*');
}

function flushPendingMessages() {
  while (pendingMessages.length) sendToMain(pendingMessages.shift());
}

// Comandos vindos do content.js (MAIN world) → repassa ao background
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__cdpFrom !== 'content') return;
  if (e.data.__cdpReady) {
    mainReady = true;
    flushPendingMessages();
    return;
  }
  if (port) try { port.postMessage(e.data.payload); } catch (_) {}
});

function connect() {
  try {
    port = chrome.runtime.connect({ name: 'cdp' });
  } catch (e) {
    setTimeout(connect, RECONNECT_MS);
    return;
  }

  port.onMessage.addListener((msg) => {
    sendToMain(msg);
  });

  port.onDisconnect.addListener(() => {
    port = null;
    sendToMain({ type: 'status', connected: false });
    setTimeout(connect, RECONNECT_MS);
  });
}

connect();
}
