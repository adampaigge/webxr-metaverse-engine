/**
 * MVMP - Metaverse Mesh Protocol
 * 
 * A web-native protocol for distributed virtual worlds built on:
 * - WebXR for immersive rendering
 * - WebRTC for peer-to-peer communication
 * - WebTransport for server-authoritative state
 * - IPFS/Content-hashing for asset addressing
 * 
 * Design Goals:
 * 1. Decentralized: No single point of failure
 * 2. Interoperable: Standardized data formats (glTF2.0, VRM)
 * 3. Scalable: Hybrid mesh/SFU topology
 * 4. Secure: End-to-end encryption for meshnets
 * 5. Web-native: Works in browsers without plugins
 */

class MVMPProtocol {
    constructor() {
        this.version = '1.0.0';
        this.schemes = ['mvmp', 'mvmps', 'mvmp+ipfs'];
    }

    parseURI(uri) {
        // Parse MVMP URI format:
        // mvmp://[user@]host[:port]/world[/instance][?params][#spawn]
        // Examples:
        // mvmp://metaverse.example.com/worlds/conference-room
        // mvmp://alice@private.example.com/secret-garden?key=mesh123
        // mvmp+ipfs://QmXyz123.../world-name

        const url = new URL(uri);

        return {
            scheme: url.protocol.slice(0, -1),
            host: url.hostname,
            port: url.port || (url.protocol === 'mvmps:' ? 443 : 80),
            world: url.pathname.slice(1),
            instance: url.hash.slice(1) || 'default',
            params: Object.fromEntries(url.searchParams),
            auth: url.username ? { user: url.username, pass: url.password } : null
        };
    }

    buildURI(components) {
        const scheme = components.scheme || 'mvmp';
        let uri = `${scheme}://`;

        if (components.auth) {
            uri += `${components.auth.user}@${components.host}`;
        } else {
            uri += components.host;
        }

        if (components.port) {
            uri += `:${components.port}`;
        }

        uri += `/${components.world}`;

        if (components.params) {
            const params = new URLSearchParams(components.params);
            uri += `?${params.toString()}`;
        }

        if (components.instance && components.instance !== 'default') {
            uri += `#${components.instance}`;
        }

        return uri;
    }
}

// MVMP Message Types
const MVMPMessages = {
    // Connection
    HELLO: 0x01,
    WELCOME: 0x02,
    AUTHENTICATE: 0x03,
    AUTH_SUCCESS: 0x04,

    // World Management
    WORLD_JOIN: 0x10,
    WORLD_LEAVE: 0x11,
    WORLD_STATE: 0x12,
    INSTANCE_LIST: 0x13,

    // Avatar
    AVATAR_SPAWN: 0x20,
    AVATAR_DESPAWN: 0x21,
    AVATAR_UPDATE: 0x22,
    AVATAR_CHANGE: 0x23,

    // Entity Sync
    ENTITY_CREATE: 0x30,
    ENTITY_DELETE: 0x31,
    ENTITY_UPDATE: 0x32,
    ENTITY_RPC: 0x33,

    // Asset
    ASSET_REQUEST: 0x40,
    ASSET_OFFER: 0x41,
    ASSET_CHUNK: 0x42,

    // Voice/Video
    VOICE_OFFER: 0x50,
    VOICE_ANSWER: 0x51,
    VOICE_CANDIDATE: 0x52,

    // Spatial
    SPATIAL_QUERY: 0x60,
    SPATIAL_RESULT: 0x61,

    // Meshnet
    MESHNET_DISCOVER: 0x70,
    MESHNET_ADVERTISE: 0x71,

    // Error
    ERROR: 0xFF
};

// Binary protocol implementation
class MVMPEncoder {
    constructor() {
        this.textEncoder = new TextEncoder();
    }

    encode(message) {
        const buffer = new ArrayBuffer(65536);
        const view = new DataView(buffer);
        let offset = 0;

        // Header
        view.setUint8(offset++, message.type);
        view.setUint32(offset, message.sequence || 0);
        offset += 4;
        view.setFloat64(offset, message.timestamp || performance.now());
        offset += 8;

        // Payload based on type
        switch(message.type) {
            case MVMPMessages.AVATAR_UPDATE:
                offset = this.encodeAvatarUpdate(view, offset, message.payload);
                break;
            case MVMPMessages.ENTITY_UPDATE:
                offset = this.encodeEntityUpdate(view, offset, message.payload);
                break;
            case MVMPMessages.WORLD_STATE:
                offset = this.encodeWorldState(view, offset, message.payload);
                break;
            default:
                offset = this.encodeJSON(view, offset, message.payload);
        }

        return buffer.slice(0, offset);
    }

    encodeAvatarUpdate(view, offset, payload) {
        // Compact avatar update format
        // 2 bytes: avatar ID
        // 6 bytes: head position (3 x 16-bit quantized)
        // 6 bytes: head rotation (3 x 16-bit quantized euler)
        // 50 bytes: left hand joints (25 x 2 bytes)
        // 50 bytes: right hand joints
        // 10 bytes: facial blendshapes (10 x 1 byte)

        view.setUint16(offset, payload.avatarId);
        offset += 2;

        // Quantized head position (range -100 to 100 meters, 1mm precision)
        const quantize = (val) => Math.floor((val + 100) * 327.67);
        view.setUint16(offset, quantize(payload.head.position.x));
        view.setUint16(offset + 2, quantize(payload.head.position.y));
        view.setUint16(offset + 4, quantize(payload.head.position.z));
        offset += 6;

        // Quantized rotation (range -PI to PI)
        const quantizeRot = (val) => Math.floor((val + Math.PI) * 10430.2); // 2^15 / 2PI
        view.setUint16(offset, quantizeRot(payload.head.rotation.x));
        view.setUint16(offset + 2, quantizeRot(payload.head.rotation.y));
        view.setUint16(offset + 4, quantizeRot(payload.head.rotation.z));
        offset += 6;

        // Hand joints (simplified - just wrist and fingertips)
        // In production, encode full hand skeleton or use delta compression

        return offset;
    }

    encodeEntityUpdate(view, offset, payload) {
        // Entity ID
        view.setUint32(offset, payload.entityId);
        offset += 4;

        // Component mask (which components are present)
        let mask = 0;
        if (payload.transform) mask |= 0x01;
        if (payload.physics) mask |= 0x02;
        if (payload.custom) mask |= 0x04;
        view.setUint8(offset++, mask);

        if (payload.transform) {
            // Position (3 floats)
            view.setFloat32(offset, payload.transform.position.x);
            view.setFloat32(offset + 4, payload.transform.position.y);
            view.setFloat32(offset + 8, payload.transform.position.z);
            offset += 12;

            // Rotation (quaternion, 4 floats)
            view.setFloat32(offset, payload.transform.rotation.x);
            view.setFloat32(offset + 4, payload.transform.rotation.y);
            view.setFloat32(offset + 8, payload.transform.rotation.z);
            view.setFloat32(offset + 12, payload.transform.rotation.w);
            offset += 16;

            // Scale (3 floats, optional)
            if (payload.transform.scale) {
                view.setFloat32(offset, payload.transform.scale.x);
                view.setFloat32(offset + 4, payload.transform.scale.y);
                view.setFloat32(offset + 8, payload.transform.scale.z);
                offset += 12;
            }
        }

        return offset;
    }

    encodeJSON(view, offset, payload) {
        const json = JSON.stringify(payload);
        const bytes = this.textEncoder.encode(json);

        view.setUint16(offset, bytes.length);
        offset += 2;

        for (let i = 0; i < bytes.length; i++) {
            view.setUint8(offset + i, bytes[i]);
        }

        return offset + bytes.length;
    }
}

// Content addressing for assets (IPFS-style)
class ContentAddressing {
    static async hash(data) {
        // SHA-256 hash for content addressing
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return `Qm${hashHex.substring(0, 44)}`; // IPFS-style CID
    }

    static async hashFromURL(url) {
        const response = await fetch(url);
        const data = await response.arrayBuffer();
        return this.hash(data);
    }

    static verify(data, expectedHash) {
        return this.hash(data).then(hash => hash === expectedHash);
    }
}

// Spatial indexing for interest management
class SpatialHash {
    constructor(cellSize = 10) {
        this.cellSize = cellSize;
        this.cells = new Map(); // cellKey -> Set of entityIds
        this.entityCells = new Map(); // entityId -> cellKey
    }

    getCellKey(x, y, z) {
        const cx = Math.floor(x / this.cellSize);
        const cy = Math.floor(y / this.cellSize);
        const cz = Math.floor(z / this.cellSize);
        return `${cx},${cy},${cz}`;
    }

    insert(entityId, position) {
        const key = this.getCellKey(position.x, position.y, position.z);

        // Remove from old cell
        const oldKey = this.entityCells.get(entityId);
        if (oldKey && oldKey !== key) {
            const oldCell = this.cells.get(oldKey);
            if (oldCell) oldCell.delete(entityId);
        }

        // Add to new cell
        if (!this.cells.has(key)) {
            this.cells.set(key, new Set());
        }
        this.cells.get(key).add(entityId);
        this.entityCells.set(entityId, key);
    }

    queryRadius(center, radius) {
        const results = new Set();
        const rCells = Math.ceil(radius / this.cellSize);

        const cx = Math.floor(center.x / this.cellSize);
        const cy = Math.floor(center.y / this.cellSize);
        const cz = Math.floor(center.z / this.cellSize);

        for (let x = cx - rCells; x <= cx + rCells; x++) {
            for (let y = cy - rCells; y <= cy + rCells; y++) {
                for (let z = cz - rCells; z <= cz + rCells; z++) {
                    const key = `${x},${y},${z}`;
                    const cell = this.cells.get(key);
                    if (cell) {
                        cell.forEach(id => results.add(id));
                    }
                }
            }
        }

        return Array.from(results);
    }

    remove(entityId) {
        const key = this.entityCells.get(entityId);
        if (key) {
            const cell = this.cells.get(key);
            if (cell) cell.delete(entityId);
            this.entityCells.delete(entityId);
        }
    }
}

// Export protocol components
if (typeof module !== 'undefined') {
    module.exports = {
        MVMPProtocol,
        MVMPMessages,
        MVMPEncoder,
        ContentAddressing,
        SpatialHash
    };
}
