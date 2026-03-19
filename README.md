Here's the complete **README.md** file:

```markdown
# QuantumWebXR Engine

A foundational WebXR engine for building the spatial internet - a decentralized, interoperable metaverse built on web standards.

## 🌟 Features

- **Web-Native**: Built entirely on WebXR, WebGL2, WebGPU, WebRTC, and WebAssembly
- **Decentralized**: Supports P2P mesh networking, LAN parties, and federated servers
- **Interoperable**: Uses glTF2.0/VRM standards for assets and avatars
- **Scalable**: Hybrid mesh/SFU topology adapts to any group size
- **Cross-Platform**: Desktop, mobile, standalone VR (Quest, Pico), and AR
- **Protocol-First**: Defines MVMP (Metaverse Mesh Protocol) for cross-world compatibility

## 🚀 Quick Start

```bash
# Clone and setup
git clone https://github.com/quantum-webxr/engine.git
cd engine
npm install

# Start development server
npm run dev

# Open https://localhost:3000 in a WebXR-capable browser
```

## 📖 Usage

### Basic Example

```javascript
import { QuantumEngine } from 'quantum-webxr';

const engine = new QuantumEngine({
  rendering: { antialias: true },
  networking: { 
    signalingServer: 'wss://your-server.com',
    enableLAN: true 
  }
});

await engine.initialize();
await engine.enterVR();

// Create or join a world
const world = await engine.worlds.createWorld({
  type: 'noise',
  seed: 12345
});

await engine.worlds.enterWorld(world.id);
```

### Avatar System

```javascript
// Load custom VRM avatar
const avatar = await engine.avatars.loadAvatar('user-id', 
  'https://example.com/avatar.vrm',
  { isLocal: true }
);

// Full-body IK automatically applied from VR tracking
// Supports hand tracking, eye tracking, and lip sync
```

### Networking

```javascript
// Connect to mesh network
await engine.networking.connect('meshnet:my-secret-key');

// Or connect to specific world
await engine.connect('mvmp://server.com/world-name#instance-1');

// Automatic topology switching:
// - < 10 peers: Full mesh P2P (lowest latency)
// - > 10 peers: SFU fallback (scalable)
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    QuantumWebXR Engine                       │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Rendering│ │  Avatar  │ │ Physics  │ │   UI     │       │
│  │ WebGL2/  │ │   VRM    │ │ Cannon/  │ │ World-   │       │
│  │ WebGPU   │ │   IK     │ │  Ammo.js │ │ Space    │       │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘       │
│       └─────────────┴─────────────┴─────────────┘            │
│                         │                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              MVMP Protocol Layer                       │    │
│  │  ┌────────────┐ ┌────────────┐ ┌─────────────────┐   │    │
│  │  │  WebRTC    │ │ WebTransport│ │  IPFS Assets    │   │    │
│  │  │  P2P Mesh  │ │  Server Auth│ │  Content-Addr   │   │    │
│  │  └────────────┘ └────────────┘ └─────────────────┘   │    │
│  └─────────────────────────────────────────────────────┘    │
│                         │                                    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           Distributed Server (Optional)              │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────────┐ │    │
│  │  │  Zone  │ │  Zone  │ │  Zone  │ │   MediaSoup  │ │    │
│  │  │ Server │ │ Server │ │ Server │ │     SFU      │ │    │
│  │  └────────┘ └────────┘ └────────┘ └──────────────┘ │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## 📡 MVMP Protocol

The Metaverse Mesh Protocol (MVMP) enables:

- **Content Addressing**: Assets referenced by IPFS CID (immutable, verifiable)
- **Spatial Networking**: Interest management based on proximity
- **Authority Distribution**: Server-authoritative for physics, P2P for presence
- **World Federation**: Cross-server travel with maintained identity

### URI Scheme

```
mvmp://[user@]host[:port]/world[/instance][?params][#spawn]

Examples:
mvmp://metaverse.example.com/conference-room
mvmp://alice@private.example.com/secret-garden?key=mesh123
mvmp+ipfs://QmXyz123.../decentralized-world
```

## 🎨 Asset Pipeline

```javascript
// IPFS content-addressed assets
const asset = await engine.assets.load('ipfs://QmSg5kmz...');

// Progressive loading with LOD
const world = await engine.assets.loadGLTFProgressive('ipfs://QmWorld...', {
  lod: 1, // Load lower detail first, upgrade as data arrives
  streaming: true
});

// Upload and share
const { cid } = await engine.assets.upload(file, {
  pin: true,
  tags: ['avatar', 'vrm']
});
// Returns: cid = QmNewHash...
```

## 🌐 Deployment

### Static Hosting (IPFS)

```bash
# Build for production
npm run build

# Upload to IPFS
ipfs add -r dist/
# Returns: QmAppHash...

# Access via any IPFS gateway
https://ipfs.io/ipfs/QmAppHash...
```

### Self-Hosted Server

```javascript
// server.js
import { QuantumServer } from 'quantum-webxr/server';

const server = new QuantumServer({
  maxPlayersPerZone: 100,
  enableSFU: true,
  sfuType: 'mediasoup'
});

await server.initialize();
console.log('Server running on port 4433');
```

## 🔧 Configuration

```javascript
const engine = new QuantumEngine({
  // Rendering
  rendering: {
    antialias: true,
    shadows: 'pcf-soft',
    foveation: 1.0,
    enableWebGPU: true
  },
  
  // Physics
  physics: {
    engine: 'cannon', // or 'ammo' for complex sims
    gravity: [0, -9.82, 0],
    deterministic: true // for networked physics
  },
  
  // Networking
  networking: {
    maxMeshPeers: 10,
    signalingServer: 'wss://...',
    iceServers: [...],
    enableLAN: true,
    enableMeshnet: true,
    meshnetKey: 'secret'
  },
  
  // Quality
  quality: 'auto', // auto-adapts based on performance
  targetFrameRate: 72
});
```

## 📚 Documentation

- [Protocol Specification](docs/protocol/MVMP.md)
- [Architecture Overview](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Deployment Guide](docs/DEPLOYMENT.md)

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Three.js for rendering foundation
- WebXR Device API for immersive access
- IPFS for decentralized storage
- cannon-es & Ammo.js for physics
- MediaSoup for SFU capabilities
```
