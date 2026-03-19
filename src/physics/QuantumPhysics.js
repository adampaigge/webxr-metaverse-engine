/**
 * QuantumPhysics - WebAssembly Physics Engine Integration
 * 
 * Features:
 * - cannon-es for lightweight physics (JavaScript)
 * - Ammo.js (Bullet) for complex simulations (WASM)
 * - Deterministic lockstep for networking
 * - Spatial audio integration with WebAudio API HRTF
 */

class QuantumPhysics {
    constructor(config = {}) {
        this.config = {
            engine: config.engine || 'cannon', // 'cannon', 'ammo', 'ode'
            gravity: config.gravity || [0, -9.82, 0],
            timestep: config.timestep || 1/60,
            iterations: config.iterations || 10,
            broadphase: config.broadphase || 'sap', // 'naive', 'sap', 'grid'
            ...config
        };

        this.world = null;
        this.bodies = new Map();
        this.constraints = [];
        this.vehicles = new Map();

        // Deterministic simulation
        this.frame = 0;
        this.accumulator = 0;
        this.stateBuffer = [];

        // Spatial audio integration
        this.audioListener = null;
        this.spatialAudio = new SpatialAudioManager();

        // Collision callbacks
        this.collisionCallbacks = new Map();
    }

    async initialize() {
        if (this.config.engine === 'cannon') {
            await this.initCannon();
        } else if (this.config.engine === 'ammo') {
            await this.initAmmo();
        }

        await this.spatialAudio.initialize();

        console.log(`🔧 Physics initialized (${this.config.engine})`);
        return this;
    }

    async initCannon() {
        // cannon-es is pure JavaScript, no WASM loading needed
        const { World, Vec3, SAPBroadphase } = await import('cannon-es');

        this.world = new World({
            gravity: new Vec3(...this.config.gravity),
            broadphase: new SAPBroadphase(this.world)
        });

        this.world.solver.iterations = this.config.iterations;
        this.world.allowSleep = true;

        // Materials
        this.defaultMaterial = new CANNON.Material('default');
        this.defaultContactMaterial = new CANNON.ContactMaterial(
            this.defaultMaterial,
            this.defaultMaterial,
            { friction: 0.3, restitution: 0.3 }
        );
        this.world.addContactMaterial(this.defaultContactMaterial);

        // Collision event handling
        this.world.addEventListener('beginContact', (e) => {
            this.handleCollision(e.contact);
        });
    }

    async initAmmo() {
        // Ammo.js (Bullet Physics) via WebAssembly
        // More accurate but heavier

        const Ammo = await import('ammo.js');
        this.ammo = await Ammo.default();

        const collisionConfig = new this.ammo.btDefaultCollisionConfiguration();
        const dispatcher = new this.ammo.btCollisionDispatcher(collisionConfig);
        const broadphase = new this.ammo.btDbvtBroadphase();
        const solver = new this.ammo.btSequentialImpulseConstraintSolver();

        this.world = new this.ammo.btDiscreteDynamicsWorld(
            dispatcher, broadphase, solver, collisionConfig
        );

        this.world.setGravity(new this.ammo.btVector3(...this.config.gravity));
        this.world.getSolverInfo().set_numIterations(this.config.iterations);
    }

    createBody(options) {
        const id = crypto.randomUUID();
        let body;

        if (this.config.engine === 'cannon') {
            body = this.createCannonBody(options);
        } else {
            body = this.createAmmoBody(options);
        }

        this.bodies.set(id, body);

        // Sync with visual representation
        if (options.mesh) {
            this.syncBodyToMesh(id, body, options.mesh);
        }

        return id;
    }

    createCannonBody(options) {
        const { Body, Box, Sphere, Cylinder, Vec3 } = CANNON;

        let shape;
        switch(options.shape) {
            case 'box':
                shape = new Box(new Vec3(...options.halfExtents));
                break;
            case 'sphere':
                shape = new Sphere(options.radius);
                break;
            case 'cylinder':
                shape = new Cylinder(options.radiusTop, options.radiusBottom, options.height, options.segments);
                break;
            case 'trimesh':
                shape = this.createTrimesh(options.vertices, options.indices);
                break;
            default:
                shape = new Box(new Vec3(1, 1, 1));
        }

        const body = new Body({
            mass: options.mass || 0,
            position: new Vec3(...(options.position || [0, 0, 0])),
            quaternion: new CANNON.Quaternion(...(options.rotation || [0, 0, 0, 1])),
            material: options.material || this.defaultMaterial,
            type: options.kinematic ? Body.KINEMATIC : (options.mass === 0 ? Body.STATIC : Body.DYNAMIC)
        });

        body.addShape(shape);
        body.linearDamping = options.linearDamping || 0.01;
        body.angularDamping = options.angularDamping || 0.01;

        this.world.addBody(body);
        return body;
    }

    createAmmoBody(options) {
        // Ammo.js body creation
        const { mass, position, rotation } = options;

        const transform = new this.ammo.btTransform();
        transform.setIdentity();
        transform.setOrigin(new this.ammo.btVector3(...position));
        transform.setRotation(new this.ammo.btQuaternion(...rotation));

        const motionState = new this.ammo.btDefaultMotionState(transform);

        let shape;
        if (options.shape === 'box') {
            shape = new this.ammo.btBoxShape(new this.ammo.btVector3(...options.halfExtents));
        } else if (options.shape === 'sphere') {
            shape = new this.ammo.btSphereShape(options.radius);
        }

        const localInertia = new this.ammo.btVector3(0, 0, 0);
        if (mass > 0) {
            shape.calculateLocalInertia(mass, localInertia);
        }

        const rbInfo = new this.ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
        const body = new this.ammo.btRigidBody(rbInfo);

        this.world.addRigidBody(body);
        return body;
    }

    syncBodyToMesh(id, body, mesh) {
        // Keep physics body and visual mesh synchronized
        const sync = () => {
            if (this.config.engine === 'cannon') {
                mesh.position.copy(body.position);
                mesh.quaternion.copy(body.quaternion);
            } else {
                const transform = new this.ammo.btTransform();
                body.getMotionState().getWorldTransform(transform);
                const origin = transform.getOrigin();
                const rotation = transform.getRotation();
                mesh.position.set(origin.x(), origin.y(), origin.z());
                mesh.quaternion.set(rotation.x(), rotation.y(), rotation.z(), rotation.w());
            }
        };

        this.collisionCallbacks.set(id, sync);
    }

    step(delta) {
        // Fixed timestep with accumulator for determinism
        this.accumulator += delta;

        while (this.accumulator >= this.config.timestep) {
            this.world.step(this.config.timestep);
            this.accumulator -= this.config.timestep;
            this.frame++;

            // Sync visual representations
            this.collisionCallbacks.forEach((sync, id) => sync());

            // Update spatial audio positions
            this.updateSpatialAudio();
        }
    }

    // Raycasting with BVH acceleration
    raycast(from, to, options = {}) {
        if (this.config.engine === 'cannon') {
            const result = new CANNON.RaycastResult();
            const ray = new CANNON.Ray(
                new CANNON.Vec3(...from),
                new CANNON.Vec3(...to)
            );

            ray.intersectWorld(this.world, {
                mode: CANNON.Ray.CLOSEST,
                skipBackfaces: true,
                collisionFilterMask: options.mask || -1,
                collisionFilterGroup: options.group || -1
            }, result);

            return result.hasHit ? {
                hit: true,
                point: [result.hitPointWorld.x, result.hitPointWorld.y, result.hitPointWorld.z],
                normal: [result.hitNormalWorld.x, result.hitNormalWorld.y, result.hitNormalWorld.z],
                body: result.body,
                distance: result.distance
            } : { hit: false };
        }

        // Ammo raycasting
        const fromVec = new this.ammo.btVector3(...from);
        const toVec = new this.ammo.btVector3(...to);
        const rayCallback = new this.ammo.ClosestRayResultCallback(fromVec, toVec);

        this.world.rayTest(fromVec, toVec, rayCallback);

        if (rayCallback.hasHit()) {
            const point = rayCallback.get_m_hitPointWorld();
            const normal = rayCallback.get_m_hitNormalWorld();
            return {
                hit: true,
                point: [point.x(), point.y(), point.z()],
                normal: [normal.x(), normal.y(), normal.z()],
                body: rayCallback.get_m_collisionObject()
            };
        }

        return { hit: false };
    }

    // Spatial audio integration
    updateSpatialAudio() {
        // Update listener position from camera/avatar
        if (this.audioListener) {
            this.spatialAudio.setListenerPosition(this.audioListener.position);
            this.spatialAudio.setListenerOrientation(
                this.audioListener.forward,
                this.audioListener.up
            );
        }

        // Update audio sources attached to physics bodies
        this.bodies.forEach((body, id) => {
            if (this.spatialAudio.hasSource(id)) {
                let position;
                if (this.config.engine === 'cannon') {
                    position = [body.position.x, body.position.y, body.position.z];
                } else {
                    const transform = new this.ammo.btTransform();
                    body.getMotionState().getWorldTransform(transform);
                    const origin = transform.getOrigin();
                    position = [origin.x(), origin.y(), origin.z()];
                }
                this.spatialAudio.updateSourcePosition(id, position);
            }
        });
    }

    createAudioSource(id, buffer, options) {
        return this.spatialAudio.createSource(id, buffer, options);
    }

    // Deterministic state for networking
    getState() {
        const state = {
            frame: this.frame,
            bodies: []
        };

        this.bodies.forEach((body, id) => {
            if (this.config.engine === 'cannon') {
                state.bodies.push({
                    id,
                    position: [body.position.x, body.position.y, body.position.z],
                    quaternion: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
                    velocity: [body.velocity.x, body.velocity.y, body.velocity.z],
                    angularVelocity: [body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z]
                });
            }
        });

        return state;
    }

    setState(state) {
        // Apply authoritative state from server
        state.bodies.forEach(bodyState => {
            const body = this.bodies.get(bodyState.id);
            if (body && this.config.engine === 'cannon') {
                body.position.set(...bodyState.position);
                body.quaternion.set(...bodyState.quaternion);
                body.velocity.set(...bodyState.velocity);
                body.angularVelocity.set(...bodyState.angularVelocity);
            }
        });

        this.frame = state.frame;
    }

    handleCollision(contact) {
        // Emit collision event for game logic
        const event = {
            bodyA: contact.bi,
            bodyB: contact.bj,
            contactPoint: contact.getImpactVelocityAlongNormal()
        };

        // Trigger audio if significant impact
        if (Math.abs(event.contactPoint) > 2) {
            this.playImpactSound(contact);
        }

        // Network sync if needed
        this.onCollision?.(event);
    }

    playImpactSound(contact) {
        // Procedural audio based on collision properties
        const intensity = Math.abs(contact.getImpactVelocityAlongNormal());
        const position = [
            contact.bi.position.x + contact.rj.x,
            contact.bi.position.y + contact.rj.y,
            contact.bi.position.z + contact.rj.z
        ];

        this.spatialAudio.playImpact(intensity, position);
    }
}

// Spatial Audio Manager with HRTF
class SpatialAudioManager {
    constructor() {
        this.audioContext = null;
        this.listener = null;
        this.sources = new Map();
        this.masterGain = null;
    }

    async initialize() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioContext = new AudioContext();

        this.listener = this.audioContext.listener;
        this.masterGain = this.audioContext.createGain();
        this.masterGain.connect(this.audioContext.destination);

        // Initialize listener position
        this.setListenerPosition([0, 0, 0]);
        this.setListenerOrientation([0, 0, -1], [0, 1, 0]);

        console.log('🔊 Spatial Audio initialized');
    }

    createSource(id, buffer, options = {}) {
        const source = this.audioContext.createBufferSource();
        source.buffer = buffer;

        // Create panner for 3D spatialization
        const panner = this.audioContext.createPanner();
        panner.panningModel = 'HRTF'; // Head-related transfer function for realistic 3D audio
        panner.distanceModel = options.distanceModel || 'inverse';
        panner.refDistance = options.refDistance || 1;
        panner.maxDistance = options.maxDistance || 10000;
        panner.rolloffFactor = options.rolloffFactor || 1;
        panner.coneInnerAngle = options.coneInnerAngle || 360;
        panner.coneOuterAngle = options.coneOuterAngle || 360;
        panner.coneOuterGain = options.coneOuterGain || 0;

        // Set initial position
        if (options.position) {
            panner.positionX.value = options.position[0];
            panner.positionY.value = options.position[1];
            panner.positionZ.value = options.position[2];
        }

        // Connect graph
        source.connect(panner);
        panner.connect(this.masterGain);

        // Store source
        this.sources.set(id, { source, panner, options });

        return { source, panner };
    }

    updateSourcePosition(id, position) {
        const source = this.sources.get(id);
        if (source) {
            const now = this.audioContext.currentTime;
            source.panner.positionX.setValueAtTime(position[0], now);
            source.panner.positionY.setValueAtTime(position[1], now);
            source.panner.positionZ.setValueAtTime(position[2], now);
        }
    }

    updateSourceOrientation(id, orientation) {
        const source = this.sources.get(id);
        if (source && orientation) {
            const now = this.audioContext.currentTime;
            source.panner.orientationX.setValueAtTime(orientation[0], now);
            source.panner.orientationY.setValueAtTime(orientation[1], now);
            source.panner.orientationZ.setValueAtTime(orientation[2], now);
        }
    }

    setListenerPosition(position) {
        const now = this.audioContext.currentTime;
        this.listener.positionX.setValueAtTime(position[0], now);
        this.listener.positionY.setValueAtTime(position[1], now);
        this.listener.positionZ.setValueAtTime(position[2], now);
    }

    setListenerOrientation(forward, up) {
        const now = this.audioContext.currentTime;
        this.listener.forwardX.setValueAtTime(forward[0], now);
        this.listener.forwardY.setValueAtTime(forward[1], now);
        this.listener.forwardZ.setValueAtTime(forward[2], now);
        this.listener.upX.setValueAtTime(up[0], now);
        this.listener.upY.setValueAtTime(up[1], now);
        this.listener.upZ.setValueAtTime(up[2], now);
    }

    playImpact(intensity, position) {
        // Procedural impact sound
        const osc = this.audioContext.createOscillator();
        const gain = this.audioContext.createGain();
        const panner = this.audioContext.createPanner();

        panner.panningModel = 'HRTF';
        panner.positionX.value = position[0];
        panner.positionY.value = position[1];
        panner.positionZ.value = position[2];

        osc.frequency.setValueAtTime(100 + intensity * 50, this.audioContext.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, this.audioContext.currentTime + 0.1);

        gain.gain.setValueAtTime(Math.min(intensity * 0.1, 1), this.audioContext.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(panner);
        panner.connect(this.masterGain);

        osc.start();
        osc.stop(this.audioContext.currentTime + 0.1);
    }

    hasSource(id) {
        return this.sources.has(id);
    }

    removeSource(id) {
        const source = this.sources.get(id);
        if (source) {
            source.source.stop();
            this.sources.delete(id);
        }
    }

    setMasterVolume(volume) {
        this.masterGain.gain.setValueAtTime(volume, this.audioContext.currentTime);
    }
}
