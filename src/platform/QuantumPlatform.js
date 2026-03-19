/**
 * QuantumPlatform - Cross-Platform Abstraction Layer
 * 
 * Features:
 * - WebXR device support detection
 * - Mobile/desktop input handling
 * - Performance adaptation
 * - Battery and thermal monitoring
 * - Platform-specific optimizations
 */

class QuantumPlatform {
    constructor(engine) {
        this.engine = engine;
        this.type = this.detectPlatform();
        this.capabilities = {};
        this.input = new InputManager(this);
        this.performance = new PerformanceMonitor(this);

        // Device info
        this.device = {
            isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
            isStandaloneVR: false,
            isPCVR: false,
            supportsHandTracking: false,
            supportsEyeTracking: false,
            supportsPassthrough: false
        };

        // Quality settings
        this.quality = 'auto'; // 'low', 'medium', 'high', 'ultra', 'auto'
        this.targetFrameRate = 72; // VR default

        // Adaptive quality
        this.frameTimeHistory = [];
        this.adaptiveQualityEnabled = true;
    }

    async initialize() {
        await this.detectCapabilities();
        await this.input.initialize();
        this.performance.initialize();

        // Setup platform-specific optimizations
        this.applyOptimizations();

        console.log(`📱 Platform: ${this.type}`, this.device);
        return this;
    }

    detectPlatform() {
        if (typeof window === 'undefined') return 'node';

        // Check for VR headsets
        if (navigator.xr) {
            // Will be determined by XR session
            return 'webxr-ready';
        }

        if (this.device.isMobile) {
            return 'mobile';
        }

        return 'desktop';
    }

    async detectCapabilities() {
        if (!navigator.xr) return;

        // Check VR support
        this.device.supportsVR = await navigator.xr.isSessionSupported('immersive-vr');
        this.device.supportsAR = await navigator.xr.isSessionSupported('immersive-ar');

        // Check for hand tracking
        try {
            const session = await navigator.xr.requestSession('inline', {
                requiredFeatures: [],
                optionalFeatures: ['hand-tracking']
            });
            this.device.supportsHandTracking = true;
            session.end();
        } catch (e) {
            this.device.supportsHandTracking = false;
        }

        // Check for other features
        this.device.supportsPassthrough = this.device.supportsAR;

        // Detect specific headsets
        const ua = navigator.userAgent;
        if (ua.includes('Quest')) {
            this.device.isStandaloneVR = true;
            this.device.headset = 'Meta Quest';
        } else if (ua.includes('Pico')) {
            this.device.isStandaloneVR = true;
            this.device.headset = 'Pico';
        } else if (this.device.supportsVR) {
            this.device.isPCVR = true;
        }
    }

    applyOptimizations() {
        // Mobile optimizations
        if (this.device.isMobile) {
            this.engine.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            this.engine.renderer.shadowMap.enabled = false;
            this.targetFrameRate = 60;
        }

        // VR optimizations
        if (this.device.isStandaloneVR) {
            // Foveated rendering
            this.engine.renderer.xr.setFoveation(1.0);

            // Fixed foveated rendering for Quest
            if (this.device.headset === 'Meta Quest') {
                this.setupFixedFoveatedRendering();
            }

            this.targetFrameRate = 72;
        }

        // PC VR optimizations
        if (this.device.isPCVR) {
            this.targetFrameRate = 90;
        }

        // Battery optimization
        if ('getBattery' in navigator) {
            navigator.getBattery().then(battery => {
                this.monitorBattery(battery);
            });
        }
    }

    setupFixedFoveatedRendering() {
        // Quest-specific optimization
        // Reduce rendering quality in periphery
        if (this.engine.renderer.xr.getSession()) {
            // Set via WebXR layer if supported
        }
    }

    monitorBattery(battery) {
        battery.addEventListener('levelchange', () => {
            if (battery.level < 0.2 && !battery.charging) {
                // Reduce quality to save battery
                this.setQuality('low');
            }
        });
    }

    setQuality(level) {
        this.quality = level;

        const settings = {
            low: {
                shadows: false,
                antialias: false,
                pixelRatio: 1,
                lodBias: 2,
                drawDistance: 50
            },
            medium: {
                shadows: 'basic',
                antialias: true,
                pixelRatio: 1,
                lodBias: 1,
                drawDistance: 100
            },
            high: {
                shadows: 'pcf-soft',
                antialias: true,
                pixelRatio: 1.5,
                lodBias: 0,
                drawDistance: 200
            },
            ultra: {
                shadows: 'pcf-soft',
                antialias: true,
                pixelRatio: 2,
                lodBias: -1,
                drawDistance: 500
            }
        };

        const config = settings[level] || settings.medium;

        // Apply settings
        this.engine.renderer.shadowMap.enabled = config.shadows !== false;
        this.engine.renderer.setPixelRatio(config.pixelRatio);

        // Update world draw distance
        this.engine.worlds.renderDistance = config.drawDistance;
    }

    adaptQuality() {
        if (!this.adaptiveQualityEnabled) return;

        // Calculate average frame time
        const avgFrameTime = this.frameTimeHistory.reduce((a, b) => a + b, 0) 
            / this.frameTimeHistory.length;

        const targetFrameTime = 1000 / this.targetFrameRate;

        // Adjust quality based on performance
        if (avgFrameTime > targetFrameTime * 1.2) {
            // Frame time too high, reduce quality
            this.decreaseQuality();
        } else if (avgFrameTime < targetFrameTime * 0.8) {
            // Frame time good, can increase quality
            this.increaseQuality();
        }
    }

    decreaseQuality() {
        const levels = ['ultra', 'high', 'medium', 'low'];
        const current = levels.indexOf(this.quality);
        if (current < levels.length - 1) {
            this.setQuality(levels[current + 1]);
        }
    }

    increaseQuality() {
        const levels = ['low', 'medium', 'high', 'ultra'];
        const current = levels.indexOf(this.quality);
        if (current < levels.length - 1) {
            this.setQuality(levels[current + 1]);
        }
    }

    update(delta) {
        // Track frame time
        this.frameTimeHistory.push(delta * 1000);
        if (this.frameTimeHistory.length > 60) {
            this.frameTimeHistory.shift();
        }

        // Adaptive quality every 5 seconds
        if (this.frameTimeHistory.length === 60 && this.engine.clock.elapsedTime % 5 < delta) {
            this.adaptQuality();
        }

        this.input.update(delta);
        this.performance.update(delta);
    }
}

// Input Manager
class InputManager {
    constructor(platform) {
        this.platform = platform;
        this.engine = platform.engine;

        // Input state
        this.controllers = {
            left: { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), buttons: {} },
            right: { position: new THREE.Vector3(), rotation: new THREE.Quaternion(), buttons: {} }
        };

        this.hands = {
            left: { joints: [], skeleton: null },
            right: { joints: [], skeleton: null }
        };

        // Mouse/keyboard fallback
        this.mouse = { x: 0, y: 0, buttons: {} };
        this.keyboard = new Set();

        // Touch
        this.touches = new Map();

        // Gestures
        this.gestures = new GestureRecognizer();

        // Haptics
        this.haptics = {
            left: null,
            right: null
        };
    }

    async initialize() {
        // Setup XR input
        this.setupXRInput();

        // Setup fallback inputs
        if (!this.platform.device.supportsVR) {
            this.setupMouseKeyboard();
        }

        if (this.platform.device.isMobile) {
            this.setupTouch();
        }

        return this;
    }

    setupXRInput() {
        // Monitor XR session for input sources
        this.engine.events.on('session-started', () => {
            const session = this.engine.session;

            session.addEventListener('inputsourceschange', (e) => {
                for (const input of e.added) {
                    this.onInputSourceAdded(input);
                }
                for (const input of e.removed) {
                    this.onInputSourceRemoved(input);
                }
            });
        });
    }

    onInputSourceAdded(input) {
        const handedness = input.handedness; // 'left', 'right', 'none'

        if (input.targetRayMode === 'tracked-pointer') {
            // Controller
            this.controllers[handedness].inputSource = input;

            // Setup haptics
            if (input.gamepad && input.gamepad.hapticActuators) {
                this.haptics[handedness] = input.gamepad.hapticActuators[0];
            }
        } else if (input.targetRayMode === 'hands') {
            // Hand tracking
            this.hands[handedness].inputSource = input;
        }
    }

    onInputSourceRemoved(input) {
        const handedness = input.handedness;

        if (this.controllers[handedness].inputSource === input) {
            this.controllers[handedness].inputSource = null;
        }

        if (this.hands[handedness].inputSource === input) {
            this.hands[handedness].inputSource = null;
        }
    }

    setupMouseKeyboard() {
        window.addEventListener('mousemove', (e) => {
            this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
            this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        });

        window.addEventListener('mousedown', (e) => {
            this.mouse.buttons[e.button] = true;
        });

        window.addEventListener('mouseup', (e) => {
            this.mouse.buttons[e.button] = false;
        });

        window.addEventListener('keydown', (e) => {
            this.keyboard.add(e.code);
        });

        window.addEventListener('keyup', (e) => {
            this.keyboard.delete(e.code);
        });
    }

    setupTouch() {
        window.addEventListener('touchstart', (e) => {
            for (const touch of e.changedTouches) {
                this.touches.set(touch.identifier, {
                    x: (touch.clientX / window.innerWidth) * 2 - 1,
                    y: -(touch.clientY / window.innerHeight) * 2 + 1,
                    startX: touch.clientX,
                    startY: touch.clientY
                });
            }
        });

        window.addEventListener('touchmove', (e) => {
            for (const touch of e.changedTouches) {
                const t = this.touches.get(touch.identifier);
                if (t) {
                    t.x = (touch.clientX / window.innerWidth) * 2 - 1;
                    t.y = -(touch.clientY / window.innerHeight) * 2 + 1;
                }
            }
        });

        window.addEventListener('touchend', (e) => {
            for (const touch of e.changedTouches) {
                this.touches.delete(touch.identifier);
            }
        });
    }

    update(delta) {
        // Update controller poses from XR frame
        const session = this.engine.session;
        if (!session) return;

        const frame = this.engine.xrFrame;
        if (!frame) return;

        const refSpace = this.engine.renderer.xr.getReferenceSpace();

        for (const input of session.inputSources) {
            const handedness = input.handedness;

            if (input.targetRayMode === 'tracked-pointer') {
                const pose = frame.getPose(input.targetRaySpace, refSpace);
                if (pose) {
                    const controller = this.controllers[handedness];
                    controller.position.fromArray(pose.transform.position);
                    controller.rotation.fromArray(pose.transform.orientation);

                    // Update button states
                    if (input.gamepad) {
                        input.gamepad.buttons.forEach((btn, i) => {
                            const wasPressed = controller.buttons[i];
                            controller.buttons[i] = btn.pressed;

                            if (btn.pressed && !wasPressed) {
                                this.onButtonDown(handedness, i);
                            } else if (!btn.pressed && wasPressed) {
                                this.onButtonUp(handedness, i);
                            }
                        });
                    }
                }
            } else if (input.hand) {
                // Update hand joints
                const hand = this.hands[handedness];
                const joints = input.hand.values();

                let i = 0;
                for (const joint of joints) {
                    const jointPose = frame.getJointPose(joint, refSpace);
                    if (jointPose) {
                        if (!hand.joints[i]) hand.joints[i] = {};
                        hand.joints[i].position = jointPose.transform.position;
                        hand.joints[i].radius = jointPose.radius;
                    }
                    i++;
                }

                // Detect gestures
                this.gestures.detect(hand);
            }
        }
    }

    onButtonDown(handedness, buttonIndex) {
        const buttonNames = ['trigger', 'grip', 'joystick', 'button1', 'button2'];
        const name = buttonNames[buttonIndex] || `button${buttonIndex}`;

        this.engine.events.emit('button-down', { handedness, button: name });

        // Haptic feedback
        this.triggerHaptic(handedness, 0.5, 50);
    }

    onButtonUp(handedness, buttonIndex) {
        const buttonNames = ['trigger', 'grip', 'joystick', 'button1', 'button2'];
        const name = buttonNames[buttonIndex] || `button${buttonIndex}`;

        this.engine.events.emit('button-up', { handedness, button: name });
    }

    triggerHaptic(handedness, intensity, duration) {
        const haptic = this.haptics[handedness];
        if (haptic) {
            haptic.pulse(intensity, duration);
        }
    }

    // Get current input state
    getController(handedness) {
        return this.controllers[handedness];
    }

    getHand(handedness) {
        return this.hands[handedness];
    }

    isButtonDown(handedness, button) {
        const controller = this.controllers[handedness];
        if (!controller) return false;

        const index = ['trigger', 'grip', 'joystick', 'button1', 'button2'].indexOf(button);
        return controller.buttons[index] || false;
    }

    isKeyDown(code) {
        return this.keyboard.has(code);
    }
}

// Gesture Recognition
class GestureRecognizer {
    constructor() {
        this.gestures = new Map();
        this.currentGesture = null;
    }

    detect(hand) {
        if (!hand.joints.length) return null;

        // Simple gesture detection based on finger curl
        const isFingerExtended = (tipIndex, baseIndex) => {
            const tip = hand.joints[tipIndex];
            const base = hand.joints[baseIndex];
            if (!tip || !base) return false;

            // Check if tip is above base (in hand space)
            return tip.position.y > base.position.y;
        };

        // Index finger only = pointing
        const indexExtended = isFingerExtended(8, 5);
        const middleExtended = isFingerExtended(12, 9);
        const ringExtended = isFingerExtended(16, 13);
        const pinkyExtended = isFingerExtended(20, 17);

        if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
            return 'pointing';
        }

        // All fingers extended = open hand
        if (indexExtended && middleExtended && ringExtended && pinkyExtended) {
            return 'open';
        }

        // No fingers extended = fist
        if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
            return 'fist';
        }

        return null;
    }
}

// Performance Monitor
class PerformanceMonitor {
    constructor(platform) {
        this.platform = platform;
        this.stats = {
            fps: 0,
            frameTime: 0,
            drawCalls: 0,
            triangles: 0,
            memory: 0
        };

        this.history = [];
        this.lastTime = performance.now();
    }

    initialize() {
        // Setup performance observer if available
        if (typeof PerformanceObserver !== 'undefined') {
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (entry.entryType === 'measure') {
                            this.stats.frameTime = entry.duration;
                        }
                    }
                });
                observer.observe({ entryTypes: ['measure'] });
            } catch (e) {
                // PerformanceObserver not supported
            }
        }
    }

    update(delta) {
        const now = performance.now();
        const frameTime = now - this.lastTime;
        this.lastTime = now;

        this.stats.fps = Math.round(1000 / frameTime);
        this.stats.frameTime = frameTime;

        // Get Three.js stats
        const info = this.platform.engine.renderer.info;
        this.stats.drawCalls = info.render.calls;
        this.stats.triangles = info.render.triangles;

        // Memory (Chrome only)
        if (performance.memory) {
            this.stats.memory = performance.memory.usedJSHeapSize / 1048576; // MB
        }

        // Track history
        this.history.push({ ...this.stats });
        if (this.history.length > 300) {
            this.history.shift();
        }
    }

    getAverageFPS() {
        if (this.history.length === 0) return 0;
        const sum = this.history.reduce((acc, h) => acc + h.fps, 0);
        return Math.round(sum / this.history.length);
    }

    report() {
        return {
            ...this.stats,
            averageFPS: this.getAverageFPS(),
            quality: this.platform.quality,
            device: this.platform.device
        };
    }
}

// Event Bus for decoupled communication
class QuantumEventBus {
    constructor() {
        this.events = new Map();
    }

    on(event, callback) {
        if (!this.events.has(event)) {
            this.events.set(event, new Set());
        }
        this.events.get(event).add(callback);

        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    off(event, callback) {
        const callbacks = this.events.get(event);
        if (callbacks) {
            callbacks.delete(callback);
        }
    }

    emit(event, data) {
        const callbacks = this.events.get(event);
        if (callbacks) {
            callbacks.forEach(cb => {
                try {
                    cb(data);
                } catch (e) {
                    console.error(`Error in event handler for ${event}:`, e);
                }
            });
        }
    }

    once(event, callback) {
        const onceCallback = (data) => {
            this.off(event, onceCallback);
            callback(data);
        };
        this.on(event, onceCallback);
    }
}

// Export
if (typeof module !== 'undefined') {
    module.exports = { QuantumPlatform, InputManager, QuantumEventBus };
}
