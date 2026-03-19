/**
 * QuantumWebXR - Main Entry Point
 * 
 * Usage:
 * import { QuantumEngine } from './quantum-webxr';
 * 
 * const engine = new QuantumEngine({
 *   rendering: { antialias: true },
 *   networking: { signalingServer: 'wss://example.com' }
 * });
 * 
 * await engine.initialize();
 * await engine.enterVR();
 * 
 * const world = await engine.worlds.createWorld({
 *   type: 'noise',
 *   seed: 12345
 * });
 * 
 * await engine.worlds.enterWorld(world.id);
 */

// Core Systems
export { QuantumEngine } from './core/QuantumEngine.js';
export { QuantumRenderer } from './core/QuantumRenderer.js';

// Networking
export { QuantumNetworking } from './networking/QuantumNetworking.js';
export { MVMPProtocol, MVMPMessages } from './protocol/MVMP.js';

// Avatar & Physics
export { QuantumAvatarSystem } from './avatar/QuantumAvatarSystem.js';
export { QuantumPhysics, SpatialAudioManager } from './physics/QuantumPhysics.js';

// World & Assets
export { QuantumWorldManager, World } from './world/QuantumWorldManager.js';
export { QuantumAssetManager } from './assets/QuantumAssetManager.js';

// UI & Platform
export { QuantumUI, UIPanel, Button, Text, Slider } from './ui/QuantumUI.js';
export { QuantumPlatform, InputManager, QuantumEventBus } from './platform/QuantumPlatform.js';

// Server-side (Node.js only)
export { QuantumServer, Zone } from '../server/distributed/QuantumServer.js';

// Version
export const VERSION = '1.0.0';

// Default export
import { QuantumEngine } from './core/QuantumEngine.js';
export default QuantumEngine;
