# Crimson Desert Companion — Chrome Extension

Chrome extension for [CD Companion](https://github.com/leandrodiogenes/cd-companion) that shows your real-time player position on the [MapGenie](https://mapgenie.io/crimson-desert) interactive map.

Requires the CD Companion server running on your PC.

---

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **Load unpacked** and select this folder
5. Open [MapGenie Crimson Desert map](https://mapgenie.io/crimson-desert/maps/pywel)
6. The companion overlay appears automatically on the map page

---

## Features

- Real-time player marker on the MapGenie map
- Directional arrow showing character facing direction
- Camera-based map rotation
- Teleport to any point on the map (requires teleport enabled in CD Companion)
- Personal waypoints — save, filter, teleport
- Center-screen teleport with adjustable Y height
- In-game map marker displayed on MapGenie
- Location sync across all connected clients (overlay, Chrome, Firefox)
- Configurable server host/port (default: localhost:7891)

---

## Configuration

Click the extension icon to open the popup:

- **Server host/port**: configure if the server runs on a different machine
- **Follow**: toggle auto-pan to player position
- **Center Y**: height for center-screen teleport
- **Icon size**: player marker size
- **Default zoom**: initial zoom level
- **Hide found/left/right**: auto-hide MapGenie panels
- **Rotate by camera**: rotate the map to match the in-game camera

---

## How it works

The extension connects to the CD Companion WebSocket server via the background service worker. Position data is relayed to the content script running on the MapGenie page, which renders the player marker and handles all map interactions.

```
background.js  ←→  WebSocket (CD Companion server)
     ↕ chrome.runtime port
bridge.js      ←→  window.postMessage
     ↕
content.js     (MapGenie page — marker, waypoints, teleport)
```

---

## Related

- [CD Companion](https://github.com/leandrodiogenes/cd-companion) — main application (overlay + server)
