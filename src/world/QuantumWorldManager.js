/**
 * QuantumWorldManager - Dynamic World Management
 * 
 * Features:
 * - Procedural world generation
 * - Chunk-based streaming
 * - Persistent world state
 * - Multi-world instancing
 */

class QuantumWorldManager {
    constructor(engine) {
        this.engine = engine;
        this.worlds = new Map(); // worldId -> World
        this.activeWorld = null;
        this.chunkSize = 32; // meters
        this.renderDistance = 3; // chunks

        // Chunk management
        this.loadedChunks = new Map(); // chunkId -> Chunk
        this.chunkCache = new LRUCache(100); // LRU cache for chunks

        // Procedural generation
        this.generators = new Map(); // worldType -> Generator
        this.registerDefaultGenerators();

        // Persistence
        this.storage = new WorldStorage();

        // Loading queue
        this.loadQueue = [];
        this.isProcessingQueue = false;
    }

    async initialize() {
        await this.storage.initialize();
        console.log('🌍 World Manager initialized');
        return this;
    }

    registerDefaultGenerators() {
        this.registerGenerator('flat', new FlatWorldGenerator());
        this.registerGenerator('noise', new NoiseWorldGenerator());
        this.registerGenerator('solar-system', new SolarSystemGenerator());
    }

    registerGenerator(type, generator) {
        this.generators.set(type, generator);
    }

    async createWorld(config) {
        const worldId = config.id || crypto.randomUUID();
        const generator = this.generators.get(config.type) || this.generators.get('flat');

        const world = new World(worldId, config, generator, this);
        await world.initialize();

        this.worlds.set(worldId, world);
        return world;
    }

    async loadWorld(worldId) {
        // Check if already loaded
        if (this.worlds.has(worldId)) {
            return this.worlds.get(worldId);
        }

        // Load from storage
        const config = await this.storage.loadWorldConfig(worldId);
        if (!config) {
            throw new Error(`World ${worldId} not found`);
        }

        return this.createWorld(config);
    }

    async enterWorld(worldId, spawnPosition = null) {
        const world = await this.loadWorld(worldId);

        if (this.activeWorld) {
            await this.exitWorld();
        }

        this.activeWorld = world;

        // Load initial chunks around spawn
        const position = spawnPosition || world.config.spawn || [0, 10, 0];
        await world.loadChunksAround(position, this.renderDistance);

        // Add to scene
        this.engine.scene.add(world.root);

        // Start streaming
        this.startChunkStreaming();

        console.log(`🌎 Entered world: ${worldId}`);
        return world;
    }

    async exitWorld() {
        if (!this.activeWorld) return;

        // Stop streaming
        this.stopChunkStreaming();

        // Save all modified chunks
        await this.activeWorld.save();

        // Remove from scene
        this.engine.scene.remove(this.activeWorld.root);

        // Unload distant chunks
        this.activeWorld.unloadAllChunks();

        this.activeWorld = null;
    }

    startChunkStreaming() {
        // Update chunks based on player position
        this.engine.events.on('player-moved', (position) => {
            this.updateChunks(position);
        });
    }

    stopChunkStreaming() {
        this.engine.events.off('player-moved');
    }

    async updateChunks(playerPosition) {
        if (!this.activeWorld) return;

        const playerChunk = this.worldToChunk(playerPosition);

        // Determine which chunks should be loaded
        const chunksToLoad = [];
        const chunksToUnload = new Set(this.loadedChunks.keys());

        for (let x = -this.renderDistance; x <= this.renderDistance; x++) {
            for (let z = -this.renderDistance; z <= this.renderDistance; z++) {
                const chunkX = playerChunk.x + x;
                const chunkZ = playerChunk.z + z;
                const chunkId = `${chunkX},${chunkZ}`;

                // Check if already loaded
                if (this.loadedChunks.has(chunkId)) {
                    chunksToUnload.delete(chunkId);
                    continue;
                }

                // Priority based on distance
                const distance = Math.sqrt(x*x + z*z);
                chunksToLoad.push({ id: chunkId, x: chunkX, z: chunkZ, priority: distance });
            }
        }

        // Sort by priority (closest first)
        chunksToLoad.sort((a, b) => a.priority - b.priority);

        // Queue chunks for loading
        for (const chunk of chunksToLoad) {
            this.queueChunkLoad(chunk);
        }

        // Unload distant chunks
        for (const chunkId of chunksToUnload) {
            this.unloadChunk(chunkId);
        }

        // Process load queue
        this.processLoadQueue();
    }

    queueChunkLoad(chunk) {
        // Check cache first
        if (this.chunkCache.has(chunk.id)) {
            const cached = this.chunkCache.get(chunk.id);
            this.loadChunkFromCache(chunk.id, cached);
            return;
        }

        // Add to queue
        if (!this.loadQueue.find(c => c.id === chunk.id)) {
            this.loadQueue.push(chunk);
        }
    }

    async processLoadQueue() {
        if (this.isProcessingQueue || this.loadQueue.length === 0) return;

        this.isProcessingQueue = true;

        // Process a few chunks per frame
        const chunksPerFrame = 2;

        for (let i = 0; i < Math.min(chunksPerFrame, this.loadQueue.length); i++) {
            const chunk = this.loadQueue.shift();
            await this.loadChunk(chunk);
        }

        this.isProcessingQueue = false;

        // Continue processing if more chunks
        if (this.loadQueue.length > 0) {
            requestAnimationFrame(() => this.processLoadQueue());
        }
    }

    async loadChunk(chunkData) {
        const { id, x, z } = chunkData;

        // Check storage first
        let chunk = await this.storage.loadChunk(this.activeWorld.id, id);

        if (!chunk) {
            // Generate new chunk
            chunk = await this.activeWorld.generator.generateChunk(x, z, this.chunkSize);
        }

        // Create Three.js objects
        const chunkMesh = this.buildChunkMesh(chunk);

        // Position chunk
        chunkMesh.position.set(
            x * this.chunkSize,
            0,
            z * this.chunkSize
        );

        // Add to world
        this.activeWorld.root.add(chunkMesh);
        this.loadedChunks.set(id, { data: chunk, mesh: chunkMesh });

        // Add physics if needed
        if (chunk.collisionMesh) {
            this.engine.physics.createTerrainBody(chunkMesh.position, chunk.collisionMesh);
        }
    }

    unloadChunk(chunkId) {
        const chunk = this.loadedChunks.get(chunkId);
        if (!chunk) return;

        // Save if modified
        if (chunk.data.modified) {
            this.storage.saveChunk(this.activeWorld.id, chunkId, chunk.data);
        }

        // Add to cache
        this.chunkCache.set(chunkId, chunk.data);

        // Remove from scene
        this.activeWorld.root.remove(chunk.mesh);

        // Cleanup
        chunk.mesh.geometry.dispose();
        chunk.mesh.material.dispose();

        this.loadedChunks.delete(chunkId);
    }

    buildChunkMesh(chunk) {
        // Create instanced mesh for performance
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({
            color: 0x808080,
            roughness: 0.8
        });

        const mesh = new THREE.InstancedMesh(geometry, material, chunk.blocks.length);

        const dummy = new THREE.Object3D();
        chunk.blocks.forEach((block, i) => {
            dummy.position.set(block.x, block.y, block.z);
            dummy.updateMatrix();
            mesh.setMatrixAt(i, dummy.matrix);
        });

        mesh.instanceMatrix.needsUpdate = true;
        return mesh;
    }

    worldToChunk(position) {
        return {
            x: Math.floor(position[0] / this.chunkSize),
            z: Math.floor(position[2] / this.chunkSize)
        };
    }

    update(delta) {
        // Update active world
        if (this.activeWorld) {
            this.activeWorld.update(delta);
        }
    }
}

// World class
class World {
    constructor(id, config, generator, manager) {
        this.id = id;
        this.config = config;
        this.generator = generator;
        this.manager = manager;

        this.root = new THREE.Group();
        this.entities = new Map();
        this.modifiedChunks = new Set();

        // Physics world bounds
        this.bounds = {
            min: [-Infinity, -Infinity, -Infinity],
            max: [Infinity, Infinity, Infinity]
        };
    }

    async initialize() {
        await this.generator.initialize(this.config.seed);

        // Load persistent entities
        const savedEntities = await this.manager.storage.loadEntities(this.id);
        for (const entity of savedEntities) {
            this.spawnEntity(entity);
        }
    }

    async loadChunksAround(position, radius) {
        const centerChunk = this.manager.worldToChunk(position);

        for (let x = -radius; x <= radius; x++) {
            for (let z = -radius; z <= radius; z++) {
                const chunkX = centerChunk.x + x;
                const chunkZ = centerChunk.z + z;
                const chunkId = `${chunkX},${chunkZ}`;

                await this.manager.loadChunk({ id: chunkId, x: chunkX, z: chunkZ });
            }
        }
    }

    unloadAllChunks() {
        for (const chunkId of this.manager.loadedChunks.keys()) {
            this.manager.unloadChunk(chunkId);
        }
    }

    spawnEntity(data) {
        const entity = new Entity(data.id, data, this);
        this.entities.set(data.id, entity);
        this.root.add(entity.mesh);
        return entity;
    }

    despawnEntity(id) {
        const entity = this.entities.get(id);
        if (entity) {
            this.root.remove(entity.mesh);
            this.entities.delete(id);
        }
    }

    async save() {
        // Save all modified chunks
        for (const chunkId of this.modifiedChunks) {
            const chunk = this.manager.loadedChunks.get(chunkId);
            if (chunk) {
                await this.manager.storage.saveChunk(this.id, chunkId, chunk.data);
            }
        }
        this.modifiedChunks.clear();

        // Save entities
        const entityData = Array.from(this.entities.values()).map(e => e.serialize());
        await this.manager.storage.saveEntities(this.id, entityData);
    }

    update(delta) {
        // Update entities
        for (const entity of this.entities.values()) {
            entity.update(delta);
        }
    }
}

// Procedural Generators
class FlatWorldGenerator {
    async initialize(seed) {
        this.seed = seed || 12345;
    }

    async generateChunk(cx, cz, size) {
        const blocks = [];

        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                // Flat ground at y=0
                blocks.push({
                    x: cx * size + x,
                    y: 0,
                    z: cz * size + z,
                    type: 'grass'
                });
            }
        }

        return { blocks, collisionMesh: null };
    }
}

class NoiseWorldGenerator {
    async initialize(seed) {
        this.seed = seed || Math.random() * 65536;
        this.noise = new SimplexNoise(this.seed);
    }

    async generateChunk(cx, cz, size) {
        const blocks = [];
        const heightMap = [];

        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const worldX = cx * size + x;
                const worldZ = cz * size + z;

                // Generate height using noise
                const height = Math.floor(
                    (this.noise.noise2D(worldX * 0.01, worldZ * 0.01) + 1) * 10
                );

                heightMap.push({ x, z, height });

                // Fill blocks up to height
                for (let y = -5; y <= height; y++) {
                    let type = 'stone';
                    if (y === height) type = 'grass';
                    else if (y > height - 3) type = 'dirt';

                    blocks.push({ x: worldX, y, z: worldZ, type });
                }
            }
        }

        // Generate collision mesh from heightmap
        const collisionMesh = this.buildCollisionMesh(heightMap, size, cx, cz);

        return { blocks, collisionMesh };
    }

    buildCollisionMesh(heightMap, size, cx, cz) {
        // Create simplified collision geometry
        // Could use heightfield or trimesh
        return null;
    }
}

class SolarSystemGenerator {
    async initialize(seed) {
        this.seed = seed || Date.now();
        this.rng = new SeededRandom(this.seed);
    }

    async generateChunk(cx, cz, size) {
        // Space doesn't use chunks in the traditional sense
        // Instead generate celestial bodies

        const bodies = [];
        const numBodies = Math.floor(this.rng.random() * 5);

        for (let i = 0; i < numBodies; i++) {
            bodies.push({
                type: this.rng.random() > 0.5 ? 'planet' : 'asteroid',
                position: [
                    (cx * size + this.rng.random() * size) * 1000,
                    (this.rng.random() - 0.5) * 1000,
                    (cz * size + this.rng.random() * size) * 1000
                ],
                radius: this.rng.random() * 100 + 10,
                seed: this.rng.random() * 65536
            });
        }

        return { bodies, blocks: [] };
    }
}

// Entity class
class Entity {
    constructor(id, data, world) {
        this.id = id;
        this.data = data;
        this.world = world;
        this.mesh = null;

        this.createMesh();
    }

    createMesh() {
        // Create visual representation
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
        this.mesh = new THREE.Mesh(geometry, material);

        this.mesh.position.set(...(this.data.position || [0, 0, 0]));
    }

    update(delta) {
        // Update logic
    }

    serialize() {
        return {
            id: this.id,
            type: this.data.type,
            position: [this.mesh.position.x, this.mesh.position.y, this.mesh.position.z]
        };
    }
}

// Storage backend
class WorldStorage {
    constructor() {
        this.db = null;
    }

    async initialize() {
        // Could use IndexedDB, localStorage, or remote API
        if (typeof window !== 'undefined' && window.indexedDB) {
            this.db = await this.openIndexedDB();
        }
    }

    openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('QuantumWorlds', 1);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('worlds')) {
                    db.createObjectStore('worlds', { keyPath: 'id' });
                }

                if (!db.objectStoreNames.contains('chunks')) {
                    const chunkStore = db.createObjectStore('chunks', { keyPath: 'id' });
                    chunkStore.createIndex('worldId', 'worldId', { unique: false });
                }

                if (!db.objectStoreNames.contains('entities')) {
                    const entityStore = db.createObjectStore('entities', { keyPath: 'id' });
                    entityStore.createIndex('worldId', 'worldId', { unique: false });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async loadWorldConfig(worldId) {
        if (!this.db) return null;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['worlds'], 'readonly');
            const store = tx.objectStore('worlds');
            const request = store.get(worldId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveWorldConfig(config) {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['worlds'], 'readwrite');
            const store = tx.objectStore('worlds');
            const request = store.put(config);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadChunk(worldId, chunkId) {
        if (!this.db) return null;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['chunks'], 'readonly');
            const store = tx.objectStore('chunks');
            const request = store.get(`${worldId}:${chunkId}`);

            request.onsuccess = () => resolve(request.result?.data);
            request.onerror = () => reject(request.error);
        });
    }

    async saveChunk(worldId, chunkId, data) {
        if (!this.db) return;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['chunks'], 'readwrite');
            const store = tx.objectStore('chunks');
            const request = store.put({
                id: `${worldId}:${chunkId}`,
                worldId,
                chunkId,
                data,
                timestamp: Date.now()
            });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async loadEntities(worldId) {
        if (!this.db) return [];

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['entities'], 'readonly');
            const store = tx.objectStore('entities');
            const index = store.index('worldId');
            const request = index.getAll(worldId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveEntities(worldId, entities) {
        if (!this.db) return;

        const tx = this.db.transaction(['entities'], 'readwrite');
        const store = tx.objectStore('entities');

        for (const entity of entities) {
            await store.put({ ...entity, worldId });
        }
    }
}

// Simple LRU Cache implementation
class LRUCache {
    constructor(maxSize) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }

    has(key) {
        return this.cache.has(key);
    }

    get(key) {
        if (!this.cache.has(key)) return undefined;

        // Move to end (most recent)
        const value = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, value);
        return value;
    }

    set(key, value) {
        if (this.cache.has(key)) {
            this.cache.delete(key);
        } else if (this.cache.size >= this.maxSize) {
            // Remove oldest
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, value);
    }
}

// Simplex noise implementation (simplified)
class SimplexNoise {
    constructor(seed = 0) {
        this.p = new Uint8Array(256);
        for (let i = 0; i < 256; i++) this.p[i] = i;

        // Shuffle with seed
        let s = seed;
        for (let i = 255; i > 0; i--) {
            s = (s * 16807) % 2147483647;
            const j = s % (i + 1);
            [this.p[i], this.p[j]] = [this.p[j], this.p[i]];
        }

        this.perm = new Uint8Array(512);
        for (let i = 0; i < 512; i++) this.perm[i] = this.p[i & 255];
    }

    noise2D(x, y) {
        // Simplified 2D simplex noise
        // Real implementation would be more complex
        return Math.sin(x * 0.5) * Math.cos(y * 0.5);
    }
}

// Seeded random number generator
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }

    random() {
        this.seed = (this.seed * 16807) % 2147483647;
        return (this.seed - 1) / 2147483646;
    }
}

// Export
if (typeof module !== 'undefined') {
    module.exports = { QuantumWorldManager, World, NoiseWorldGenerator };
}
