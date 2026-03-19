/**
 * QuantumWebXR Engine - Core Architecture
 * A foundational WebXR engine for the spatial internet
 * 
 * Architecture Principles:
 * - Web-native: Built on WebXR, WebGL2, WebRTC, WebAssembly
 * - Protocol-first: Defines MVMP (Metaverse Mesh Protocol) for interoperability
 * - Distributed: Supports mesh networking, LAN, and federated servers
 * - Extensible: Plugin-based architecture for world/avatar/asset systems
 */

class QuantumEngine {
    constructor(config = {}) {
        // Core systems
        this.renderer = new QuantumRenderer(config.rendering);
        this.physics = new QuantumPhysics(config.physics);
        this.networking = new QuantumNetworking(config.networking);
        this.assets = new QuantumAssetManager(config.assets);
        this.avatars = new QuantumAvatarSystem(config.avatars);
        this.worlds = new QuantumWorldManager(config.worlds);

        // Protocol layer
        this.protocol = new MVMPProtocol(config.protocol);

        // Session state
        this.session = null;
        this.isImmersive = false;
        this.referenceSpace = null;

        // Global update loop
        this.clock = new THREE.Clock();
        this.isRunning = false;

        // Event system
        this.events = new QuantumEventBus();

        // Bind methods
        this.renderLoop = this.renderLoop.bind(this);
        this.onXRFrame = this.onXRFrame.bind(this);
    }

    async initialize() {
        // Initialize WebXR support detection
        if (!navigator.xr) {
            throw new Error('WebXR not supported');
        }

        // Initialize core systems in dependency order
        await this.assets.initialize();
        await this.physics.initialize();
        await this.renderer.initialize();
        await this.avatars.initialize();
        await this.worlds.initialize();
        await this.networking.initialize();

        // Setup protocol handlers
        this.setupProtocolHandlers();

        console.log('🚀 QuantumWebXR Engine initialized');
        return this;
    }

    async enterVR(mode = 'immersive-vr') {
        const session = await navigator.xr.requestSession(mode, {
            requiredFeatures: ['local-floor', 'hand-tracking'],
            optionalFeatures: ['layers', 'depth-sensing', 'dom-overlay'],
            domOverlay: { root: document.getElementById('xr-overlay') }
        });

        this.session = session;
        this.isImmersive = true;

        // Setup WebGL layer
        const gl = this.renderer.gl;
        const xrLayer = new XRWebGLLayer(session, gl);
        session.updateRenderState({ baseLayer: xrLayer });

        // Get reference space
        this.referenceSpace = await session.requestReferenceSpace('local-floor');

        // Start render loop
        session.requestAnimationFrame(this.onXRFrame);

        this.events.emit('session-started', { mode, session });
        return session;
    }

    onXRFrame(time, frame) {
        const session = frame.session;
        const pose = frame.getViewerPose(this.referenceSpace);

        if (pose) {
            // Update head tracking
            this.avatars.updateLocalHead(pose);

            // Get hand tracking data
            for (const inputSource of session.inputSources) {
                if (inputSource.hand) {
                    const handData = frame.getJointPose(inputSource.hand, this.referenceSpace);
                    this.avatars.updateLocalHand(inputSource.handedness, handData);
                }
            }
        }

        // Render
        const glLayer = session.renderState.baseLayer;
        const gl = this.renderer.gl;

        gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);

        for (const view of pose.views) {
            const viewport = glLayer.getViewport(view);
            gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);

            this.renderer.render(view);
        }

        session.requestAnimationFrame(this.onXRFrame);
    }

    renderLoop() {
        if (!this.isImmersive) {
            const delta = this.clock.getDelta();
            this.update(delta);
            this.renderer.render();
            requestAnimationFrame(this.renderLoop);
        }
    }

    update(delta) {
        this.physics.step(delta);
        this.avatars.update(delta);
        this.worlds.update(delta);
        this.networking.update(delta);
    }

    setupProtocolHandlers() {
        // MVMP Protocol message handlers
        this.protocol.on('world:join', this.handleWorldJoin.bind(this));
        this.protocol.on('avatar:spawn', this.handleAvatarSpawn.bind(this));
        this.protocol.on('avatar:update', this.handleAvatarUpdate.bind(this));
        this.protocol.on('entity:sync', this.handleEntitySync.bind(this));
        this.protocol.on('asset:request', this.handleAssetRequest.bind(this));
    }

    async connect(uri) {
        // Parse MVMP URI: mvmp://server/world#instance
        const parsed = this.protocol.parseURI(uri);
        return this.networking.connect(parsed);
    }
}

// Export for module systems
if (typeof module !== 'undefined') module.exports = QuantumEngine;
