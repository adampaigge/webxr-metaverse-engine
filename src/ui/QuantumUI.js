/**
 * QuantumUI - Immersive Interface System
 * 
 * Features:
 * - WebXR DOM Overlay for handheld AR
 * - World-space UI panels for VR
 * - Diegetic (in-world) interfaces
 * - Hand/wrist-attached UI
 * - Gaze-based interaction
 * - Voice command integration
 */

class QuantumUI {
    constructor(engine) {
        this.engine = engine;
        this.panels = new Map();
        this.activePanel = null;
        this.overlayElement = null;

        // Interaction modes
        this.mode = 'laser'; // 'laser', 'gaze', 'hand', 'voice'
        this.laserPointer = null;
        this.gazeCursor = null;
        this.handRay = null;

        // DOM overlay for AR
        this.domOverlay = null;

        // World-space UI
        this.uiScene = new THREE.Scene();
        this.uiCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);

        // Event system
        this.events = new QuantumEventBus();

        // Voice recognition
        this.voiceRecognizer = null;

        // Accessibility
        this.accessibility = {
            fontScale: 1.0,
            highContrast: false,
            reduceMotion: false
        };
    }

    async initialize() {
        // Setup DOM overlay container
        this.setupDOMOverlay();

        // Create laser pointer for VR
        this.createLaserPointer();

        // Create gaze cursor
        this.createGazeCursor();

        // Initialize voice if available
        if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            this.setupVoiceRecognition();
        }

        console.log('🖥️ UI System initialized');
        return this;
    }

    setupDOMOverlay() {
        // Create overlay element for WebXR DOM Overlay API
        this.overlayElement = document.createElement('div');
        this.overlayElement.id = 'quantum-ui-overlay';
        this.overlayElement.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            pointer-events: none;
            display: none;
            z-index: 10000;
        `;

        // Add :xr-overlay styles
        const style = document.createElement('style');
        style.textContent = `
            :xr-overlay {
                background: rgba(0,0,0,0) !important;
            }
            #quantum-ui-overlay :xr-overlay {
                display: initial !important;
            }
        `;
        document.head.appendChild(style);

        document.body.appendChild(this.overlayElement);
    }

    createLaserPointer() {
        // Visual laser pointer for VR interaction
        const geometry = new THREE.CylinderGeometry(0.002, 0.002, 1, 8);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, 0, -0.5);

        const material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending
        });

        this.laserPointer = new THREE.Mesh(geometry, material);
        this.laserPointer.visible = false;

        // Add to camera for head-relative positioning
        this.engine.camera.add(this.laserPointer);

        // Cursor at end of laser
        const cursorGeo = new THREE.SphereGeometry(0.01, 16, 16);
        const cursorMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.5
        });
        this.laserCursor = new THREE.Mesh(cursorGeo, cursorMat);
        this.laserPointer.add(this.laserCursor);
        this.laserCursor.position.z = -1;
    }

    createGazeCursor() {
        // Reticle for gaze-based interaction
        const geometry = new THREE.RingGeometry(0.02, 0.03, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.5,
            side: THREE.DoubleSide
        });

        this.gazeCursor = new THREE.Mesh(geometry, material);
        this.gazeCursor.position.z = -2;
        this.gazeCursor.visible = false;
        this.engine.camera.add(this.gazeCursor);

        // Gaze timer (fill circle)
        const timerGeo = new THREE.RingGeometry(0, 0.02, 32);
        const timerMat = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.8
        });
        this.gazeTimer = new THREE.Mesh(timerGeo, timerMat);
        this.gazeTimer.position.z = -2.01;
        this.gazeTimer.scale.set(0, 0, 0);
        this.gazeCursor.add(this.gazeTimer);
    }

    setupVoiceRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.voiceRecognizer = new SpeechRecognition();
        this.voiceRecognizer.continuous = true;
        this.voiceRecognizer.interimResults = true;

        this.voiceRecognizer.onresult = (event) => {
            const transcript = Array.from(event.results)
                .map(result => result[0])
                .map(result => result.transcript)
                .join('');

            this.handleVoiceCommand(transcript);
        };
    }

    handleVoiceCommand(command) {
        // Parse voice commands
        const commands = {
            'menu': () => this.toggleMenu(),
            'settings': () => this.openPanel('settings'),
            'map': () => this.openPanel('map'),
            'inventory': () => this.openPanel('inventory'),
            'mute': () => this.engine.audio.setMasterVolume(0),
            'unmute': () => this.engine.audio.setMasterVolume(1)
        };

        for (const [key, action] of Object.entries(commands)) {
            if (command.toLowerCase().includes(key)) {
                action();
                break;
            }
        }
    }

    // Create world-space UI panel
    createPanel(id, options = {}) {
        const panel = new UIPanel(id, options, this);
        this.panels.set(id, panel);
        return panel;
    }

    // Open panel with animation
    openPanel(id, options = {}) {
        const panel = this.panels.get(id);
        if (!panel) {
            console.warn(`Panel ${id} not found`);
            return;
        }

        // Position panel
        if (options.position) {
            panel.setPosition(options.position);
        } else if (options.attachTo === 'hand') {
            this.attachToHand(panel, options.hand || 'left');
        } else if (options.attachTo === 'head') {
            this.attachToHead(panel, options.offset || [0, 0, -1]);
        } else if (options.worldPosition) {
            panel.setWorldPosition(options.worldPosition);
        }

        // Show with animation
        panel.show(options.animate !== false);
        this.activePanel = panel;

        // Play sound
        this.engine.audio.playUISound('open');

        return panel;
    }

    closePanel(id) {
        const panel = this.panels.get(id);
        if (panel) {
            panel.hide();
            if (this.activePanel === panel) {
                this.activePanel = null;
            }
        }
    }

    attachToHand(panel, hand) {
        // Attach UI to wrist/hand
        const avatar = this.engine.avatars.localAvatar;
        if (!avatar) return;

        const handBone = avatar.getBone(`${hand}Hand`);
        if (handBone) {
            handBone.add(panel.root);
            panel.root.position.set(0, 0.1, 0); // Slightly above hand
            panel.root.rotation.set(-Math.PI / 2, 0, 0);
        }
    }

    attachToHead(panel, offset) {
        // Attach UI to head/camera
        this.engine.camera.add(panel.root);
        panel.root.position.set(...offset);
        panel.root.lookAt(0, 0, 0);
    }

    // Enable DOM overlay for AR
    enableDOMOverlay(session) {
        if (session.domOverlayState) {
            this.domOverlay = true;
            this.overlayElement.style.display = 'block';
            this.overlayElement.style.pointerEvents = 'auto';

            // Add :xr-overlay class
            this.overlayElement.classList.add('xr-overlay');
        }
    }

    // Create diegetic (in-world) UI element
    createDiegeticUI(mesh, options) {
        // UI that exists as part of the world (e.g., screens, panels)
        const ui = new DiegeticUI(mesh, options, this);
        return ui;
    }

    update(delta) {
        // Update interaction mode based on input
        this.updateInteractionMode();

        // Update laser pointer
        if (this.mode === 'laser' && this.laserPointer.visible) {
            this.updateLaserPointer();
        }

        // Update gaze interaction
        if (this.mode === 'gaze' && this.gazeCursor.visible) {
            this.updateGazeInteraction(delta);
        }

        // Update panels
        this.panels.forEach(panel => panel.update(delta));
    }

    updateInteractionMode() {
        // Auto-switch based on available input
        const session = this.engine.session;
        if (!session) return;

        for (const inputSource of session.inputSources) {
            if (inputSource.targetRayMode === 'tracked-pointer') {
                this.mode = 'laser';
                this.laserPointer.visible = true;
                this.gazeCursor.visible = false;
                return;
            } else if (inputSource.targetRayMode === 'gaze') {
                this.mode = 'gaze';
                this.laserPointer.visible = false;
                this.gazeCursor.visible = true;
                return;
            }
        }
    }

    updateLaserPointer() {
        // Raycast from controller
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera({ x: 0, y: 0 }, this.engine.camera);

        // Check intersections with UI panels
        const intersects = raycaster.intersectObjects(
            Array.from(this.panels.values()).map(p => p.mesh),
            false
        );

        if (intersects.length > 0) {
            const hit = intersects[0];
            this.laserCursor.position.z = -hit.distance;
            this.laserCursor.material.color.setHex(0x00ffff);

            // Trigger hover
            hit.object.userData.panel?.onHover(hit.point);
        } else {
            this.laserCursor.position.z = -10;
            this.laserCursor.material.color.setHex(0x00ff00);
        }
    }

    updateGazeInteraction(delta) {
        // Raycast from center of view
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera({ x: 0, y: 0 }, this.engine.camera);

        const intersects = raycaster.intersectObjects(
            Array.from(this.panels.values()).map(p => p.mesh),
            false
        );

        if (intersects.length > 0) {
            this.gazeTimer.scale.x += delta * 2;
            this.gazeTimer.scale.y += delta * 2;

            if (this.gazeTimer.scale.x >= 1) {
                // Trigger selection
                intersects[0].object.userData.panel?.onSelect();
                this.gazeTimer.scale.set(0, 0, 0);
            }
        } else {
            this.gazeTimer.scale.set(0, 0, 0);
        }
    }

    render(renderer) {
        // Render world-space UI
        if (this.panels.size > 0) {
            renderer.render(this.uiScene, this.uiCamera);
        }
    }

    // Toggle voice recognition
    toggleVoice() {
        if (this.voiceRecognizer) {
            if (this.voiceRecognizer.listening) {
                this.voiceRecognizer.stop();
            } else {
                this.voiceRecognizer.start();
            }
        }
    }

    // Set accessibility options
    setAccessibility(options) {
        Object.assign(this.accessibility, options);

        // Apply to all panels
        this.panels.forEach(panel => {
            panel.setFontScale(this.accessibility.fontScale);
            panel.setHighContrast(this.accessibility.highContrast);
        });
    }
}

// UI Panel class
class UIPanel {
    constructor(id, options, ui) {
        this.id = id;
        this.ui = ui;
        this.options = {
            width: options.width || 1,
            height: options.height || 0.6,
            resolution: options.resolution || 512,
            curved: options.curved || false,
            opacity: options.opacity || 0.9,
            ...options
        };

        this.root = new THREE.Group();
        this.mesh = null;
        this.canvas = null;
        this.context = null;
        this.texture = null;

        this.elements = [];
        this.isVisible = false;
        this.animation = { scale: 0, targetScale: 1 };

        this.createMesh();
    }

    createMesh() {
        // Create canvas for 2D UI rendering
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.options.resolution;
        this.canvas.height = this.options.resolution * (this.options.height / this.options.width);
        this.context = this.canvas.getContext('2d');

        // Create texture
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.minFilter = THREE.LinearFilter;
        this.texture.magFilter = THREE.LinearFilter;

        // Create geometry
        let geometry;
        if (this.options.curved) {
            // Curved panel for comfortable viewing
            geometry = new THREE.CylinderGeometry(
                1, 1, this.options.height, 32, 1, true,
                -Math.PI / 4, Math.PI / 2
            );
            geometry.scale(this.options.width / Math.PI, 1, 0.2);
        } else {
            geometry = new THREE.PlaneGeometry(this.options.width, this.options.height);
        }

        // Create material
        const material = new THREE.MeshBasicMaterial({
            map: this.texture,
            transparent: true,
            opacity: this.options.opacity,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.userData.panel = this;
        this.root.add(this.mesh);

        // Add collider for interaction
        this.mesh.geometry.computeBoundingBox();
    }

    addElement(element) {
        this.elements.push(element);
        element.panel = this;
        this.render();
        return element;
    }

    render() {
        const ctx = this.context;
        const w = this.canvas.width;
        const h = this.canvas.height;

        // Clear
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = 'rgba(20, 20, 30, 0.9)';
        ctx.fillRect(0, 0, w, h);

        // Border
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, w, h);

        // Render elements
        for (const element of this.elements) {
            element.render(ctx);
        }

        // Update texture
        this.texture.needsUpdate = true;
    }

    show(animate = true) {
        this.isVisible = true;
        this.root.visible = true;

        if (animate) {
            this.animation.scale = 0;
            this.animateIn();
        }
    }

    hide() {
        this.isVisible = false;
        this.root.visible = false;
    }

    animateIn() {
        const animate = () => {
            if (!this.isVisible) return;

            this.animation.scale += (this.animation.targetScale - this.animation.scale) * 0.1;
            this.root.scale.setScalar(this.animation.scale);

            if (Math.abs(this.animation.targetScale - this.animation.scale) > 0.001) {
                requestAnimationFrame(animate);
            }
        };
        animate();
    }

    setPosition(position) {
        this.root.position.set(...position);
    }

    setWorldPosition(position) {
        this.ui.engine.scene.add(this.root);
        this.root.position.set(...position);
        this.root.lookAt(this.ui.engine.camera.position);
    }

    onHover(point) {
        // Convert world point to local UV
        // Trigger element hover
    }

    onSelect() {
        // Handle selection
        this.ui.engine.audio.playUISound('select');
    }

    update(delta) {
        // Update animations
    }

    setFontScale(scale) {
        // Update all text elements
    }

    setHighContrast(enabled) {
        // Update colors for high contrast
    }
}

// UI Element base class
class UIElement {
    constructor(options) {
        this.x = options.x || 0;
        this.y = options.y || 0;
        this.width = options.width || 100;
        this.height = options.height || 40;
        this.style = options.style || {};
    }

    render(ctx) {
        // Override in subclasses
    }
}

class Button extends UIElement {
    constructor(options) {
        super(options);
        this.text = options.text || 'Button';
        this.onClick = options.onClick || (() => {});
        this.hovered = false;
    }

    render(ctx) {
        // Background
        ctx.fillStyle = this.hovered ? '#00ffff' : '#004444';
        ctx.fillRect(this.x, this.y, this.width, this.height);

        // Text
        ctx.fillStyle = this.hovered ? '#000000' : '#ffffff';
        ctx.font = '24px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
            this.text,
            this.x + this.width / 2,
            this.y + this.height / 2
        );
    }
}

class Text extends UIElement {
    constructor(options) {
        super(options);
        this.text = options.text || '';
        this.fontSize = options.fontSize || 24;
    }

    render(ctx) {
        ctx.fillStyle = this.style.color || '#ffffff';
        ctx.font = `${this.fontSize}px sans-serif`;
        ctx.textAlign = this.style.align || 'left';
        ctx.fillText(this.text, this.x, this.y);
    }
}

class Slider extends UIElement {
    constructor(options) {
        super(options);
        this.value = options.value || 0;
        this.min = options.min || 0;
        this.max = options.max || 1;
        this.onChange = options.onChange || (() => {});
    }

    render(ctx) {
        // Track
        ctx.fillStyle = '#333333';
        ctx.fillRect(this.x, this.y + this.height / 2 - 2, this.width, 4);

        // Fill
        const fillWidth = (this.value - this.min) / (this.max - this.min) * this.width;
        ctx.fillStyle = '#00ffff';
        ctx.fillRect(this.x, this.y + this.height / 2 - 2, fillWidth, 4);

        // Handle
        ctx.beginPath();
        ctx.arc(this.x + fillWidth, this.y + this.height / 2, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
    }
}

// Diegetic UI (in-world)
class DiegeticUI {
    constructor(mesh, options, ui) {
        this.mesh = mesh;
        this.ui = ui;
        this.options = options;

        // Add interactive behavior to world object
        this.mesh.userData.interactive = true;
        this.mesh.userData.onInteract = () => this.onInteract();
    }

    onInteract() {
        // Trigger interaction
        this.ui.events.emit('diegetic-interact', this);
    }
}

// Export
if (typeof module !== 'undefined') {
    module.exports = { QuantumUI, UIPanel, Button, Text, Slider };
}
