/**
 * QuantumAssetManager - Universal Asset Pipeline
 * 
 * Features:
 * - IPFS content-addressed storage
 * - Progressive/streaming loading
 * - glTF2.0 + VRM support
 * - KTX2/Basis Universal texture compression
 * - Asset hot-reloading for development
 * - CDN fallback and multi-source resolution
 */

class QuantumAssetManager {
    constructor(config = {}) {
        this.config = {
            ipfsGateway: config.ipfsGateway || 'https://ipfs.io/ipfs/',
            localCache: config.localCache !== false,
            cacheSize: config.cacheSize || 500 * 1024 * 1024, // 500MB
            streaming: config.streaming !== false,
            hotReload: config.hotReload || false,
            fallbackCDNs: config.fallbackCDNs || [],
            ...config
        };

        // Loading systems
        this.loaders = new Map();
        this.registerLoaders();

        // Cache management
        this.cache = new AssetCache(this.config.cacheSize);
        this.loading = new Map(); // CID -> Promise

        // IPFS integration
        this.ipfs = new IPFSResolver(this.config.ipfsGateway, this.config.fallbackCDNs);

        // Streaming
        this.streamQueue = new PriorityQueue();
        this.activeStreams = new Map();

        // Hot reload
        this.watchers = new Map();
        this.wss = null; // WebSocket for dev updates

        // Progress tracking
        this.progress = new Map();
        this.totalProgress = { loaded: 0, total: 0 };

        // Asset registry
        this.registry = new Map(); // CID -> metadata
    }

    async initialize() {
        // Initialize storage
        if (this.config.localCache && typeof window !== 'undefined') {
            await this.cache.initialize();
        }

        // Setup hot reload if enabled
        if (this.config.hotReload) {
            this.setupHotReload();
        }

        console.log('📦 Asset Manager initialized');
        return this;
    }

    registerLoaders() {
        this.loaders.set('gltf', new GLTFLoader());
        this.loaders.set('vrm', new VRMLoader());
        this.loaders.set('ktx2', new KTX2Loader());
        this.loaders.set('texture', new TextureLoader());
        this.loaders.set('audio', new AudioLoader());
        this.loaders.set('video', new VideoLoader());
        this.loaders.set('json', new JSONLoader());
        this.loaders.set('wasm', new WASMLoader());
    }

    // Universal load method
    async load(uri, options = {}) {
        // Parse URI - can be:
        // - CID (Qm...)
        // - ipfs://CID
        // - mvmp://world/asset
        // - https://...
        // - file://...

        const parsed = this.parseURI(uri);
        const cid = parsed.cid || await this.resolveToCID(parsed);

        // Check cache
        if (this.cache.has(cid)) {
            return this.cache.get(cid);
        }

        // Check if already loading
        if (this.loading.has(cid)) {
            return this.loading.get(cid);
        }

        // Start loading
        const loadPromise = this.loadAsset(cid, parsed, options);
        this.loading.set(cid, loadPromise);

        try {
            const asset = await loadPromise;
            this.cache.set(cid, asset);
            this.loading.delete(cid);
            return asset;
        } catch (e) {
            this.loading.delete(cid);
            throw e;
        }
    }

    parseURI(uri) {
        if (uri.startsWith('ipfs://')) {
            return { type: 'ipfs', cid: uri.slice(7) };
        }
        if (uri.startsWith('mvmp://')) {
            return { type: 'mvmp', uri };
        }
        if (uri.startsWith('Qm') || uri.startsWith('bafy')) {
            return { type: 'cid', cid: uri };
        }
        if (uri.startsWith('http://') || uri.startsWith('https://')) {
            return { type: 'http', url: uri };
        }
        if (uri.startsWith('file://')) {
            return { type: 'file', path: uri.slice(7) };
        }

        return { type: 'path', path: uri };
    }

    async resolveToCID(parsed) {
        if (parsed.cid) return parsed.cid;

        if (parsed.type === 'mvmp') {
            // Resolve through MVMP protocol
            return this.resolveMVMP(parsed.uri);
        }

        if (parsed.type === 'http') {
            // Fetch and compute CID
            const response = await fetch(parsed.url);
            const data = await response.arrayBuffer();
            return this.computeCID(data);
        }

        throw new Error(`Cannot resolve CID for ${parsed.type}`);
    }

    async resolveMVMP(uri) {
        // Query MVMP resolver for asset CID
        // This would communicate with the world server
        const response = await fetch(uri.replace('mvmp://', 'https://'));
        const metadata = await response.json();
        return metadata.cid;
    }

    async loadAsset(cid, parsed, options) {
        const extension = this.getExtension(parsed);
        const loader = this.loaders.get(extension) || this.loaders.get('json');

        // Determine loading strategy
        if (options.streaming && loader.supportsStreaming) {
            return this.loadStreaming(cid, loader, options);
        }

        return this.loadFull(cid, loader, options);
    }

    async loadFull(cid, loader, options) {
        // Fetch from IPFS or cache
        const data = await this.ipfs.fetch(cid, {
            onProgress: (loaded, total) => {
                this.updateProgress(cid, loaded, total);
            }
        });

        // Parse asset
        const asset = await loader.parse(data, options);
        asset.cid = cid;

        return asset;
    }

    async loadStreaming(cid, loader, options) {
        // Progressive loading for large assets
        const stream = await this.ipfs.stream(cid);

        return new Promise((resolve, reject) => {
            const chunks = [];
            const reader = stream.getReader();

            const processChunk = async ({ done, value }) => {
                if (done) {
                    // Assemble and parse
                    const data = this.concatenateChunks(chunks);
                    const asset = await loader.parse(data, options);
                    asset.cid = cid;
                    resolve(asset);
                    return;
                }

                chunks.push(value);

                // Update progress
                const loaded = chunks.reduce((sum, c) => sum + c.length, 0);
                this.updateProgress(cid, loaded, value.total || loaded * 2);

                // Continue reading
                reader.read().then(processChunk);
            };

            reader.read().then(processChunk);
        });
    }

    // Progressive glTF loading with LOD support
    async loadGLTFProgressive(cid, options = {}) {
        // First load minimal structure
        const header = await this.ipfs.fetchRange(cid, 0, 1024);
        const gltf = JSON.parse(new TextDecoder().decode(header));

        // Create placeholder scene
        const scene = new THREE.Scene();
        const placeholders = new Map();

        // Load meshes progressively by LOD
        const loadPromises = [];

        for (const mesh of gltf.meshes || []) {
            for (const primitive of mesh.primitives) {
                // Determine which LOD to load based on distance/importance
                const lod = options.lod || 0;

                // Create placeholder
                const placeholder = this.createPlaceholder(primitive);
                scene.add(placeholder);
                placeholders.set(primitive, placeholder);

                // Queue actual mesh loading
                loadPromises.push(this.loadPrimitive(cid, gltf, primitive, lod)
                    .then(geometry => {
                        // Replace placeholder
                        const mesh = new THREE.Mesh(geometry, placeholder.material);
                        mesh.position.copy(placeholder.position);
                        mesh.rotation.copy(placeholder.rotation);
                        mesh.scale.copy(placeholder.scale);
                        scene.remove(placeholder);
                        scene.add(mesh);
                    }));
            }
        }

        // Load textures progressively
        for (const texture of gltf.textures || []) {
            this.loadTextureProgressive(cid, gltf, texture)
                .then(tex => {
                    // Apply to materials
                });
        }

        // Return immediately with placeholders, upgrade as data arrives
        return {
            scene,
            gltf,
            ready: Promise.all(loadPromises),
            placeholders
        };
    }

    createPlaceholder(primitive) {
        // Simple bounding box placeholder
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshBasicMaterial({
            color: 0x808080,
            wireframe: true
        });
        return new THREE.Mesh(geometry, material);
    }

    async loadPrimitive(cid, gltf, primitive, lod) {
        // Fetch bufferView for this primitive
        const accessor = gltf.accessors[primitive.attributes.POSITION];
        const bufferView = gltf.bufferViews[accessor.bufferView];

        // Calculate byte range
        const offset = bufferView.byteOffset || 0;
        const length = bufferView.byteLength;

        // Fetch geometry data
        const data = await this.ipfs.fetchRange(cid, offset, length);

        // Parse geometry
        return this.parseGeometry(data, accessor, primitive);
    }

    parseGeometry(data, accessor, primitive) {
        const geometry = new THREE.BufferGeometry();

        // Parse vertex positions
        const positions = new Float32Array(data, accessor.byteOffset || 0, accessor.count * 3);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

        // Parse indices if present
        if (primitive.indices !== undefined) {
            const indicesAccessor = gltf.accessors[primitive.indices];
            const indices = new Uint16Array(data, indicesAccessor.byteOffset, indicesAccessor.count);
            geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        }

        // Parse normals, UVs, etc.

        return geometry;
    }

    async loadTextureProgressive(cid, gltf, textureInfo) {
        const texture = gltf.textures[textureInfo.source];
        const image = gltf.images[texture.source];

        // Check for KTX2/Basis
        if (image.uri && image.uri.endsWith('.ktx2')) {
            return this.loadKTX2(cid, image);
        }

        // Standard texture loading with progressive JPEG
        return this.loadStandardTexture(cid, image);
    }

    async loadKTX2(cid, image) {
        // KTX2 with Basis Universal compression
        const data = await this.ipfs.fetch(cid); // Full fetch for now
        const ktx2Loader = this.loaders.get('ktx2');
        return ktx2Loader.parse(data);
    }

    computeCID(data) {
        // SHA-256 hash for content addressing
        if (typeof window !== 'undefined') {
            return crypto.subtle.digest('SHA-256', data).then(hash => {
                const bytes = new Uint8Array(hash);
                // Convert to base58btc (simplified - real implementation needs multiformats)
                return 'Qm' + Array.from(bytes.slice(0, 22))
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join('');
            });
        }

        // Node.js
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256').update(data).digest();
        return 'Qm' + hash.slice(0, 22).toString('hex');
    }

    getExtension(parsed) {
        const path = parsed.path || parsed.url || '';
        const match = path.match(/\.([^.]+)$/);
        return match ? match[1].toLowerCase() : 'json';
    }

    updateProgress(cid, loaded, total) {
        this.progress.set(cid, { loaded, total });

        // Calculate total progress
        let totalLoaded = 0;
        let totalSize = 0;
        for (const [_, p] of this.progress) {
            totalLoaded += p.loaded;
            totalSize += p.total;
        }

        this.totalProgress = { loaded: totalLoaded, total: totalSize };

        // Emit progress event
        this.onProgress?.({
            cid,
            loaded,
            total,
            percent: (loaded / total * 100).toFixed(2),
            totalPercent: (totalLoaded / totalSize * 100).toFixed(2)
        });
    }

    setupHotReload() {
        if (typeof window === 'undefined') return;

        // Connect to development server
        this.wss = new WebSocket('ws://localhost:35729');

        this.wss.onmessage = (event) => {
            const msg = JSON.parse(event.data);
            if (msg.type === 'asset-change') {
                this.hotReloadAsset(msg.cid, msg.path);
            }
        };
    }

    async hotReloadAsset(cid, path) {
        console.log(`🔄 Hot reloading ${cid}`);

        // Clear cache
        this.cache.delete(cid);

        // Reload asset
        const asset = await this.load(path, { force: true });

        // Notify engine to update references
        this.onHotReload?.({ cid, asset });
    }

    // Asset upload for creators
    async upload(data, options = {}) {
        // Compute CID
        const cid = await this.computeCID(data);

        // Check if already exists
        if (await this.ipfs.exists(cid)) {
            return { cid, cached: true };
        }

        // Upload to IPFS
        const result = await this.ipfs.add(data, {
            pin: options.pin !== false,
            wrapWithDirectory: options.wrap || false
        });

        // Register metadata
        this.registry.set(cid, {
            cid,
            size: data.byteLength || data.length,
            type: options.type || 'application/octet-stream',
            uploaded: Date.now(),
            tags: options.tags || []
        });

        return { cid: result.cid, cached: false };
    }

    // Get asset metadata
    getMetadata(cid) {
        return this.registry.get(cid);
    }

    // Preload assets for upcoming scene
    async preload(cids, priority = 'normal') {
        const promises = cids.map(cid => {
            return this.load(cid).catch(e => {
                console.warn(`Failed to preload ${cid}:`, e);
            });
        });

        return Promise.all(promises);
    }

    // Clear cache
    clear() {
        this.cache.clear();
        this.loading.clear();
        this.progress.clear();
    }

    dispose() {
        this.clear();
        this.wss?.close();
    }
}

// IPFS Resolver with multi-gateway fallback
class IPFSResolver {
    constructor(primaryGateway, fallbackGateways = []) {
        this.gateways = [primaryGateway, ...fallbackGateways];
        this.activeGateway = 0;
        this.failedGateways = new Set();
    }

    async fetch(cid, options = {}) {
        // Try gateways in order
        for (let i = 0; i < this.gateways.length; i++) {
            const gatewayIndex = (this.activeGateway + i) % this.gateways.length;
            const gateway = this.gateways[gatewayIndex];

            if (this.failedGateways.has(gateway)) continue;

            try {
                const url = `${gateway}${cid}`;
                const response = await fetch(url, {
                    signal: options.signal
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                // Track progress if callback provided
                if (options.onProgress && response.body) {
                    return this.trackProgress(response, options.onProgress);
                }

                return response.arrayBuffer();
            } catch (e) {
                console.warn(`Gateway ${gateway} failed:`, e);
                this.failedGateways.add(gateway);
            }
        }

        throw new Error('All IPFS gateways failed');
    }

    async stream(cid) {
        const gateway = this.gateways[this.activeGateway];
        const url = `${gateway}${cid}`;

        const response = await fetch(url);
        return response.body;
    }

    async fetchRange(cid, start, end) {
        const gateway = this.gateways[this.activeGateway];
        const url = `${gateway}${cid}`;

        const response = await fetch(url, {
            headers: {
                'Range': `bytes=${start}-${end}`
            }
        });

        return response.arrayBuffer();
    }

    async exists(cid) {
        try {
            const gateway = this.gateways[this.activeGateway];
            const response = await fetch(`${gateway}${cid}?format=raw`, {
                method: 'HEAD'
            });
            return response.ok;
        } catch {
            return false;
        }
    }

    async add(data, options = {}) {
        // Upload to IPFS via local node or pinning service
        // This would use ipfs-http-client or similar

        const formData = new FormData();
        formData.append('file', new Blob([data]));

        const response = await fetch('http://localhost:5001/api/v0/add', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        return { cid: result.Hash };
    }

    trackProgress(response, onProgress) {
        const contentLength = response.headers.get('Content-Length');
        const total = parseInt(contentLength, 10);

        return new Promise((resolve, reject) => {
            const reader = response.body.getReader();
            const chunks = [];
            let loaded = 0;

            const read = () => {
                reader.read().then(({ done, value }) => {
                    if (done) {
                        const allChunks = new Uint8Array(loaded);
                        let position = 0;
                        for (const chunk of chunks) {
                            allChunks.set(chunk, position);
                            position += chunk.length;
                        }
                        resolve(allChunks.buffer);
                        return;
                    }

                    chunks.push(value);
                    loaded += value.length;
                    onProgress(loaded, total);

                    read();
                }).catch(reject);
            };

            read();
        });
    }
}

// Asset Cache with LRU eviction
class AssetCache {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.currentSize = 0;
        this.cache = new Map(); // CID -> { asset, size, lastAccess }
        this.db = null;
    }

    async initialize() {
        if (typeof window !== 'undefined' && 'indexedDB' in window) {
            this.db = await this.openDB();
            await this.loadFromDB();
        }
    }

    openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('AssetCache', 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('assets')) {
                    db.createObjectStore('assets', { keyPath: 'cid' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    has(cid) {
        return this.cache.has(cid);
    }

    get(cid) {
        const entry = this.cache.get(cid);
        if (entry) {
            entry.lastAccess = Date.now();
            return entry.asset;
        }
        return null;
    }

    set(cid, asset) {
        const size = this.estimateSize(asset);

        // Evict if necessary
        while (this.currentSize + size > this.maxSize && this.cache.size > 0) {
            this.evictLRU();
        }

        this.cache.set(cid, {
            asset,
            size,
            lastAccess: Date.now()
        });

        this.currentSize += size;

        // Persist to IndexedDB
        if (this.db) {
            this.persist(cid, asset);
        }
    }

    estimateSize(asset) {
        // Rough estimation
        if (asset instanceof THREE.Texture) {
            return asset.image.width * asset.image.height * 4;
        }
        if (asset instanceof THREE.BufferGeometry) {
            return asset.attributes.position.array.byteLength;
        }
        return 1024 * 1024; // Default 1MB
    }

    evictLRU() {
        let oldest = null;
        let oldestTime = Infinity;

        for (const [cid, entry] of this.cache) {
            if (entry.lastAccess < oldestTime) {
                oldestTime = entry.lastAccess;
                oldest = cid;
            }
        }

        if (oldest) {
            const entry = this.cache.get(oldest);
            this.currentSize -= entry.size;
            this.cache.delete(oldest);
        }
    }

    clear() {
        this.cache.clear();
        this.currentSize = 0;
    }

    async loadFromDB() {
        // Load cache index from IndexedDB
        const tx = this.db.transaction(['assets'], 'readonly');
        const store = tx.objectStore('assets');
        const request = store.getAll();

        request.onsuccess = () => {
            for (const entry of request.result) {
                // Restore to memory cache
                this.cache.set(entry.cid, {
                    asset: entry.asset,
                    size: entry.size,
                    lastAccess: entry.lastAccess
                });
                this.currentSize += entry.size;
            }
        };
    }

    async persist(cid, asset) {
        const tx = this.db.transaction(['assets'], 'readwrite');
        const store = tx.objectStore('assets');

        // Serialize asset for storage
        const serialized = await this.serializeAsset(asset);

        store.put({
            cid,
            data: serialized,
            size: this.estimateSize(asset),
            lastAccess: Date.now()
        });
    }

    serializeAsset(asset) {
        // Custom serialization based on type
        if (asset instanceof THREE.BufferGeometry) {
            return {
                type: 'geometry',
                attributes: Object.fromEntries(
                    Object.entries(asset.attributes).map(([k, v]) => [k, v.array])
                )
            };
        }
        return asset;
    }
}

// Priority Queue for streaming
class PriorityQueue {
    constructor() {
        this.items = [];
    }

    enqueue(item, priority) {
        this.items.push({ item, priority });
        this.items.sort((a, b) => a.priority - b.priority);
    }

    dequeue() {
        return this.items.shift()?.item;
    }

    isEmpty() {
        return this.items.length === 0;
    }
}

// Loader implementations
class GLTFLoader {
    constructor() {
        this.supportsStreaming = true;
    }

    async parse(data, options) {
        // Use Three.js GLTFLoader
        const loader = new THREE.GLTFLoader();

        return new Promise((resolve, reject) => {
            loader.parse(data, '', (gltf) => {
                resolve(gltf);
            }, reject);
        });
    }
}

class VRMLoader extends GLTFLoader {
    async parse(data, options) {
        // VRM is glTF2.0 with extensions
        const gltf = await super.parse(data, options);

        // Process VRM specific data
        if (gltf.userData.vrm) {
            // Setup spring bones, blend shapes, etc.
        }

        return gltf;
    }
}

class KTX2Loader {
    constructor() {
        this.basisLoader = null;
    }

    async parse(data) {
        // Parse KTX2 container
        // Transcode to GPU format
        return new THREE.CompressedTexture();
    }
}

class TextureLoader {
    async parse(data, options) {
        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);

        return new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(url, (texture) => {
                URL.revokeObjectURL(url);
                resolve(texture);
            }, undefined, reject);
        });
    }
}

class AudioLoader {
    async parse(data, options) {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const buffer = await context.decodeAudioData(data);
        return buffer;
    }
}

class VideoLoader {
    async parse(data, options) {
        const blob = new Blob([data], { type: 'video/mp4' });
        const url = URL.createObjectURL(blob);

        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = 'anonymous';

        return new Promise((resolve, reject) => {
            video.onloadeddata = () => {
                const texture = new THREE.VideoTexture(video);
                resolve({ video, texture });
            };
            video.onerror = reject;
        });
    }
}

class JSONLoader {
    async parse(data) {
        const text = new TextDecoder().decode(data);
        return JSON.parse(text);
    }
}

class WASMLoader {
    async parse(data) {
        return WebAssembly.compile(data);
    }
}

// Export
if (typeof module !== 'undefined') {
    module.exports = { QuantumAssetManager, IPFSResolver };
}
