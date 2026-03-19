
# MVMP: Metaverse Mesh Protocol

## Overview

MVMP is a web-native protocol for distributed virtual worlds, designed for:
- **Decentralization**: No single point of failure
- **Interoperability**: Cross-world asset and identity portability
- **Scalability**: From LAN parties to MMO-scale worlds
- **Privacy**: End-to-end encryption for private spaces

## Core Concepts

### Content Addressing

All assets are referenced by cryptographic hash (CID):
```
ipfs://QmSg5kmzPaoWsujT27rveHJUxYjM6iX8DWEfkvMTQYioTb/avatar.vrm
```

Benefits:
- Immutable: Content cannot change without changing CID
- Verifiable: Clients can verify received data
- Deduplicated: Same content stored once
- Offline-capable: Local cache serves as CDN

### Spatial Networking

State synchronization uses **interest management**:
- Only send updates for entities within AOI (Area of Interest)
- Hierarchical spatial hashing for O(1) queries
- Adaptive update rates based on distance

### Hybrid Topology

```
Small Group (< 10 peers):
┌─────┐      ┌─────┐      ┌─────┐
│  A  │←────→│  B  │←────→│  C  │
└─────┘      └─────┘      └─────┘
   ↑             ↑             ↑
   └─────────────┴─────────────┘
        Full Mesh P2P

Large Group (> 10 peers):
        ┌─────────┐
        │  SFU    │
        │ Server  │
        └────┬────┘
             │
    ┌────┬───┴───┬────┐
    ↓    ↓       ↓    ↓
  ┌──┐ ┌──┐   ┌──┐ ┌──┐
  │A │ │B │   │C │ │D │
  └──┘ └──┘   └──┘ └──┘
  
Direct data channels maintained for close-proximity peers
```

## Message Format

### Binary Protocol

```
[Header][Payload]

Header (13 bytes):
  - type:       uint8  (message type)
  - sequence:   uint32 (packet sequence)
  - timestamp:  uint64 (microseconds)

Payload (variable):
  - Type-specific binary data
```

### Message Types

| Code | Name | Description |
|------|------|-------------|
| 0x01 | HELLO | Initial handshake |
| 0x02 | WELCOME | Server response with session info |
| 0x10 | WORLD_JOIN | Request to join world instance |
| 0x20 | AVATAR_SPAWN | New avatar entered view |
| 0x22 | AVATAR_UPDATE | Position/rotation/animation update |
| 0x30 | ENTITY_CREATE | Dynamic entity spawned |
| 0x32 | ENTITY_UPDATE | Entity state delta |
| 0x40 | ASSET_REQUEST | Request asset by CID |
| 0x50 | VOICE_OFFER | WebRTC offer for voice |
| 0x60 | SPATIAL_QUERY | Query entities in radius |

## Connection Flow

```
Client                                    Server
  │                                         │
  │─── WebTransport connect ───────────────>│
  │<── WELCOME {serverTime, protocol} ───────│
  │                                         │
  │─── AUTHENTICATE {token} ───────────────>│
  │<── AUTH_SUCCESS {playerId, zones} ─────│
  │                                         │
  │─── WORLD_JOIN {worldId, position} ─────>│
  │<── WORLD_STATE {entities, peers} ──────│
  │                                         │
  │<── PEER_CONNECT {peerId, iceCandidates} ─│
  │─── PEER_ACCEPT {iceCandidates} ─────────>│
  │         (WebRTC P2P established)        │
  │                                         │
  │═══ AVATAR_UPDATE (P2P) ════════════════>│
  │<══ VOICE_DATA (SFU) ═══════════════════│
  │<══ ENTITY_RPC (Server) ════════════════│
```

## World Federation

Cross-server travel maintains session:

```
Zone A Server                          Zone B Server
     │                                      │
     │─── 1. MIGRATE_REQUEST ───────────────>│
     │<── 2. MIGRATE_ACCEPT {token} ─────────│
     │                                      │
     │─── 3. NOTIFY_CLIENT {token, newAddr} ─│
     │         (Client reconnects)            │
     │                                      │
     │<── 4. CLIENT_CONNECT {token} ─────────│
     │─── 5. VERIFY_TOKEN ──────────────────>│
     │<── 6. SESSION_RESTORED ───────────────│
```

## Security

### Meshnet Encryption

Private worlds use symmetric key derived from meshnet key:
```
key = PBKDF2(meshnetKey, salt="quantum-mesh", iter=100000)
```

All P2P traffic encrypted with AES-256-GCM.

### Server Authentication

- TLS 1.3 for WebTransport
- JWT tokens for session auth
- Ed25519 signatures for state verification

## References

- [WebXR Device API](https://immersive-web.github.io/webxr/)
- [WebTransport](https://w3c.github.io/webtransport/)
- [IPFS Content Addressing](https://docs.ipfs.io/concepts/content-addressing/)
- [glTF 2.0 Specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [VRM Format](https://vrm.dev/)

