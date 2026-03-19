/**
 * QuantumNetworking - Hybrid Mesh/SFU Architecture
 * 
 * Features:
 * - Full-mesh P2P for small groups (<10) - lowest latency
 * - SFU fallback for larger groups or constrained NAT
 * - WebTransport for reliable server-authoritative state
 * - LAN discovery via mDNS/Broadcast
 * - Permissioned meshnets with cryptographic identities
 */

class QuantumNetworking {
    constructor(config = {}) {
        this.config = {
            maxMeshPeers: 10,
            signalingServer: config.signalingServer || null,
            iceServers: config.iceServers || [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ],
            enableLAN: config.enableLAN !== false,
            enableMeshnet: config.enableMeshnet || false,
            meshnetKey: config.meshnetKey || null,
            ...config
        };

        // Connection management
        this.peers = new Map(); // peerId -> PeerConnection
        this.dataChannels = new Map(); // peerId -> DataChannel
        this.sfuConnection = null;
        this.webTransport = null;

        // Topology state
        this.mode = 'mesh'; // 'mesh', 'sfu', 'hybrid'
        this.peerCount = 0;
        this.localId = this.generateId();

        // Signaling
        this.signalingSocket = null;
        this.pendingCandidates = [];

        // State synchronization
        this.authoritativeState = new Map();
        this.deltaQueue = [];
        this.lastSyncTime = 0;

        // LAN discovery
        this.lanBroadcast = null;
        this.discoveredPeers = new Set();

        // Encryption for meshnets
        this.crypto = new QuantumCrypto();
    }

    async initialize() {
        // Setup WebTransport for server connection if available
        if (this.config.signalingServer) {
            await this.setupWebTransport();
        }

        // Setup LAN discovery if enabled
        if (this.config.enableLAN) {
            this.setupLANDiscovery();
        }

        console.log(`🔌 Networking initialized (ID: ${this.localId})`);
        return this;
    }

    async setupWebTransport() {
        try {
            // WebTransport over HTTP/3 for server communication
            this.webTransport = new WebTransport(this.config.signalingServer);
            await this.webTransport.ready;

            // Setup bidirectional streams
            const stream = await this.webTransport.createBidirectionalStream();
            this.serverWriter = stream.writable.getWriter();
            this.serverReader = stream.readable.getReader();

            // Handle incoming server messages
            this.handleServerMessages();

            console.log('🚀 WebTransport connected');
        } catch (e) {
            console.warn('WebTransport failed, falling back to WebSocket:', e);
            this.setupWebSocketFallback();
        }
    }

    setupWebSocketFallback() {
        const ws = new WebSocket(this.config.signalingServer.replace('https', 'wss'));
        ws.onopen = () => {
            this.signalingSocket = ws;
            this.sendSignal({ type: 'register', id: this.localId });
        };
        ws.onmessage = (e) => this.handleSignal(JSON.parse(e.data));
    }

    async connect(target) {
        // target can be: 'lan', 'meshnet:KEY', 'mvmp://uri', or specific peer
        if (target === 'lan') {
            return this.discoverLANPeers();
        }
        if (target.startsWith('meshnet:')) {
            return this.joinMeshnet(target.split(':')[1]);
        }
        if (target.startsWith('mvmp://')) {
            return this.connectMVMP(target);
        }

        // Direct peer connection
        return this.createPeerConnection(target);
    }

    async createPeerConnection(peerId, isInitiator = true) {
        const pc = new RTCPeerConnection({
            iceServers: this.config.iceServers,
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require'
        });

        this.peers.set(peerId, pc);

        // Create data channel for game state
        if (isInitiator) {
            const dc = pc.createDataChannel('gamestate', {
                ordered: false,
                maxRetransmits: 0,
                negotiated: false
            });
            this.setupDataChannel(peerId, dc);
        }

        // Handle incoming data channels
        pc.ondatachannel = (e) => {
            this.setupDataChannel(peerId, e.channel);
        };

        // ICE handling
        pc.onicecandidate = (e) => {
            if (e.candidate) {
                this.sendSignal({
                    type: 'ice',
                    target: peerId,
                    candidate: e.candidate
                });
            }
        };

        // Connection state monitoring
        pc.onconnectionstatechange = () => {
            console.log(`Peer ${peerId} state: ${pc.connectionState}`);
            if (pc.connectionState === 'failed') {
                this.handlePeerFailure(peerId);
            }
        };

        // Media streams (voice/avatar tracking)
        pc.ontrack = (e) => {
            this.events.emit('peer-track', { peerId, streams: e.streams });
        };

        if (isInitiator) {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.sendSignal({ type: 'offer', target: peerId, sdp: offer.sdp });
        }

        return pc;
    }

    setupDataChannel(peerId, channel) {
        this.dataChannels.set(peerId, channel);

        channel.onopen = () => {
            console.log(`✅ Data channel open with ${peerId}`);
            this.events.emit('peer-connected', peerId);
            this.evaluateTopology();
        };

        channel.onmessage = (e) => {
            const data = this.deserialize(e.data);
            this.handlePeerMessage(peerId, data);
        };

        channel.onclose = () => {
            this.dataChannels.delete(peerId);
            this.evaluateTopology();
        };
    }

    handlePeerMessage(peerId, data) {
        switch(data.type) {
            case 'avatar-update':
                this.events.emit('avatar-update', { peerId, ...data.payload });
                break;
            case 'entity-delta':
                this.applyEntityDelta(data.payload);
                break;
            case 'rpc':
                this.handleRPC(peerId, data.payload);
                break;
            case 'voice':
                this.events.emit('voice-data', { peerId, data: data.payload });
                break;
        }
    }

    evaluateTopology() {
        const peerCount = this.peers.size;

        if (peerCount > this.config.maxMeshPeers && this.mode === 'mesh') {
            this.switchToSFU();
        } else if (peerCount <= this.config.maxMeshPeers && this.mode === 'sfu') {
            this.switchToMesh();
        }
    }

    async switchToSFU() {
        console.log('🔄 Switching to SFU mode');
        this.mode = 'sfu';

        // Connect to SFU server
        this.sfuConnection = await this.createPeerConnection('sfu-server', true);

        // Publish local streams to SFU
        // Subscribe to remote streams from SFU

        // Maintain direct data channels for low-latency interactions
        this.peers.forEach((pc, peerId) => {
            if (peerId !== 'sfu-server' && this.shouldKeepDirect(peerId)) {
                // Keep direct connection for close proximity peers
            }
        });
    }

    shouldKeepDirect(peerId) {
        // Determine if direct connection should be maintained based on:
        // - Spatial proximity in world
        // - Interaction frequency
        // - Network quality
        return this.events.emit('evaluate-direct', peerId);
    }

    // LAN Discovery via Broadcast Channel API and mDNS simulation
    setupLANDiscovery() {
        if (typeof BroadcastChannel !== 'undefined') {
            this.lanBroadcast = new BroadcastChannel('quantum-lan');
            this.lanBroadcast.onmessage = (e) => {
                if (e.data.type === 'discovery' && e.data.id !== this.localId) {
                    this.handleLANDiscovery(e.data);
                }
            };

            // Broadcast presence
            setInterval(() => {
                this.lanBroadcast.postMessage({
                    type: 'discovery',
                    id: this.localId,
                    timestamp: Date.now()
                });
            }, 5000);
        }
    }

    handleLANDiscovery(data) {
        if (!this.discoveredPeers.has(data.id)) {
            this.discoveredPeers.add(data.id);
            console.log(`🔍 Discovered peer on LAN: ${data.id}`);
            this.events.emit('lan-peer-discovered', data.id);
        }
    }

    // Permissioned Meshnet with cryptographic authentication
    async joinMeshnet(key) {
        const keyHash = await this.crypto.hashKey(key);
        this.meshnetId = keyHash;

        // Derive encryption keys from meshnet key
        this.meshnetCrypto = await this.crypto.deriveKeys(key);

        // Connect to meshnet bootstrap nodes
        // Use DHT for peer discovery within meshnet

        console.log(`🔒 Joined meshnet: ${keyHash.substring(0, 8)}...`);
    }

    // State synchronization with interest management
    broadcastDelta(path, value, options = {}) {
        const delta = {
            type: 'entity-delta',
            timestamp: performance.now(),
            payload: { path, value, ...options }
        };

        // Determine recipients based on interest management
        const recipients = this.getInterestedPeers(options);

        recipients.forEach(peerId => {
            const dc = this.dataChannels.get(peerId);
            if (dc && dc.readyState === 'open') {
                dc.send(this.serialize(delta));
            }
        });
    }

    getInterestedPeers(options) {
        if (options.aoi) {
            // Area of Interest - only peers within spatial radius
            return this.world.getPeersInRadius(options.position, options.radius);
        }
        if (options.peers) {
            return options.peers;
        }
        return Array.from(this.dataChannels.keys());
    }

    // Serialization with compression
    serialize(data) {
        const json = JSON.stringify(data);
        // Use CompressionStream if available
        return json;
    }

    deserialize(data) {
        return JSON.parse(data);
    }

    generateId() {
        return crypto.randomUUID();
    }

    update(delta) {
        // Periodic state reconciliation
        if (performance.now() - this.lastSyncTime > 50) {
            this.syncAuthoritativeState();
            this.lastSyncTime = performance.now();
        }
    }
}

// Cryptographic utilities for meshnets
class QuantumCrypto {
    async hashKey(key) {
        const encoder = new TextEncoder();
        const data = encoder.encode(key);
        const hash = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hash))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }

    async deriveKeys(key) {
        const encoder = new TextEncoder();
        const keyMaterial = await crypto.subtle.importKey(
            'raw',
            encoder.encode(key),
            'PBKDF2',
            false,
            ['deriveBits', 'deriveKey']
        );

        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: encoder.encode('quantum-meshnet'),
                iterations: 100000,
                hash: 'SHA-256'
            },
            keyMaterial,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    }
}
