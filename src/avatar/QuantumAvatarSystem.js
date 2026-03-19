/**
 * QuantumAvatarSystem - Full-Body IK Avatar Management
 * 
 * Standards:
 * - VRM 1.0 (glTF2.0 extension) for interoperable avatars
 * - Humanoid bone mapping compatible with Mixamo/Unity/Unreal
 * - Expression system: Blend shapes + procedural animation
 * - Physics: Spring bones for hair/clothing
 */

class QuantumAvatarSystem {
    constructor(config = {}) {
        this.config = {
            maxAvatars: config.maxAvatars || 100,
            lodDistances: config.lodDistances || [5, 15, 30, 100],
            enableLipSync: config.enableLipSync !== false,
            enableEyeTracking: config.enableEyeTracking !== false,
            ikSolver: config.ikSolver || 'ccd', // 'ccd', 'fabrik', 'jacobian'
            ...config
        };

        // Avatar registry
        this.avatars = new Map(); // userId -> AvatarInstance
        this.localAvatar = null;

        // IK Solvers
        this.ikSolvers = {
            ccd: new CCDIKSolver(),
            fabrik: new FABRIKIKSolver(),
            jacobian: new JacobianIKSolver()
        };

        // Animation systems
        this.animator = new QuantumAnimator();
        this.expressionManager = new ExpressionManager();

        // Tracking data
        this.vrTracking = new VRTrackingAdapter();
        this.webcamTracking = new WebcamTrackingAdapter();

        // VRM loader
        this.vrmLoader = new VRMLoader();
    }

    async initialize() {
        await this.vrmLoader.initialize();
        await this.vrTracking.initialize();

        if (this.config.enableLipSync) {
            await this.initLipSync();
        }

        console.log('🎭 Avatar System initialized');
        return this;
    }

    async loadAvatar(userId, source, options = {}) {
        // source can be: URL (VRM/gLTF), File, or Procedural config
        let vrmData;

        if (typeof source === 'string') {
            vrmData = await this.vrmLoader.load(source);
        } else if (source instanceof File) {
            vrmData = await this.vrmLoader.loadFromFile(source);
        } else if (source.type === 'procedural') {
            vrmData = this.generateProceduralAvatar(source.config);
        }

        const avatar = new AvatarInstance(userId, vrmData, options);
        await avatar.initialize();

        this.avatars.set(userId, avatar);

        if (options.isLocal) {
            this.localAvatar = avatar;
            this.setupLocalTracking(avatar);
        }

        return avatar;
    }

    setupLocalTracking(avatar) {
        // VR headset tracking
        this.vrTracking.on('head', (pose) => {
            avatar.setHeadPose(pose);
        });

        // Hand tracking
        this.vrTracking.on('left-hand', (joints) => {
            avatar.setHandPose('left', joints);
            this.solveArmIK(avatar, 'left', joints);
        });

        this.vrTracking.on('right-hand', (joints) => {
            avatar.setHandPose('right', joints);
            this.solveArmIK(avatar, 'right', joints);
        });

        // Webcam-based body tracking fallback
        if (this.webcamTracking.available) {
            this.webcamTracking.on('pose', (pose) => {
                avatar.setBodyPose(pose);
            });
        }
    }

    solveArmIK(avatar, side, handJoints) {
        const solver = this.ikSolvers[this.config.ikSolver];

        // Get arm chain: shoulder -> elbow -> wrist
        const shoulder = avatar.getBone(`${side}Shoulder`);
        const elbow = avatar.getBone(`${side}Elbow`);
        const wrist = avatar.getBone(`${side}Wrist`);

        // Target from hand tracking
        const target = handJoints[0]; // Wrist joint

        // Solve IK
        const chain = [shoulder, elbow, wrist];
        solver.solve(chain, target.position, {
            iterations: 10,
            tolerance: 0.001,
            constraints: this.getArmConstraints(side)
        });
    }

    solveLegIK(avatar, footTarget) {
        // Similar setup for legs if using foot trackers
        const solver = this.ikSolvers[this.config.ikSolver];
        const hip = avatar.getBone('hips');
        const knee = avatar.getBone('leftKnee');
        const ankle = avatar.getBone('leftAnkle');

        solver.solve([hip, knee, ankle], footTarget, {
            iterations: 15,
            constraints: this.getLegConstraints()
        });
    }

    update(delta) {
        // Update all avatars
        this.avatars.forEach((avatar, userId) => {
            if (avatar !== this.localAvatar) {
                // Interpolate networked avatar updates
                avatar.interpolate(delta);
            }

            // Update animations
            avatar.update(delta);

            // Update spring bones (physics)
            avatar.updateSpringBones(delta);

            // LOD management
            this.updateLOD(avatar);
        });
    }

    updateLOD(avatar) {
        const distance = this.getDistanceToCamera(avatar);
        const lodLevel = this.getLODLevel(distance);
        avatar.setLOD(lodLevel);
    }

    getLODLevel(distance) {
        for (let i = 0; i < this.config.lodDistances.length; i++) {
            if (distance < this.config.lodDistances[i]) return i;
        }
        return this.config.lodDistances.length;
    }

    // Network synchronization
    serializeAvatarUpdate(avatar) {
        // Compact binary format for network efficiency
        const data = {
            h: avatar.getHeadPose(), // 6 floats (pos + rot)
            l: avatar.getLeftHandPose(), // 25 joints * 7 floats
            r: avatar.getRightHandPose(),
            f: avatar.getFacialExpression(), // Blend shape weights
            b: avatar.getBoneRotationsCompressed() // Key bones only
        };
        return this.compressAvatarData(data);
    }

    compressAvatarData(data) {
        // Use quantized floats for network efficiency
        // Head: 6 bytes (3 pos + 3 rot, quantized)
        // Hands: 50 bytes (25 joints * 2 bytes per component)
        // Face: 20 bytes (10 blend shapes * 2 bytes)
        return new Float32Array([
            ...data.h.position,
            ...data.h.rotation,
            // ... compressed hand data
        ]).buffer;
    }
}

// VRM Loader with glTF2.0 extension support
class VRMLoader {
    async initialize() {
        // Initialize Three.js GLTFLoader with VRM extension
        this.loader = new THREE.GLTFLoader();
        this.loader.register(parser => new VRMScriptExtension(parser));
    }

    async load(url) {
        const gltf = await this.loader.loadAsync(url);
        const vrm = gltf.userData.vrm;

        // Process VRM specific data
        return {
            scene: gltf.scene,
            vrm: vrm,
            bones: this.extractBones(vrm),
            blendShapes: vrm.blendShapeProxy,
            springBones: vrm.springBoneManager,
            materials: this.processMaterials(vrm),
            meta: vrm.meta
        };
    }

    extractBones(vrm) {
        const humanoid = vrm.humanoid;
        const bones = {};

        // Standard VRM humanoid bone mapping
        const boneMap = {
            hips: 'hips',
            leftUpperLeg: 'leftUpperLeg',
            leftLowerLeg: 'leftLowerLeg',
            leftFoot: 'leftFoot',
            rightUpperLeg: 'rightUpperLeg',
            rightLowerLeg: 'rightLowerLeg',
            rightFoot: 'rightFoot',
            spine: 'spine',
            chest: 'chest',
            neck: 'neck',
            head: 'head',
            leftUpperArm: 'leftUpperArm',
            leftLowerArm: 'leftLowerArm',
            leftHand: 'leftHand',
            rightUpperArm: 'rightUpperArm',
            rightLowerArm: 'rightLowerArm',
            rightHand: 'rightHand'
        };

        for (const [name, node] of Object.entries(humanoid.humanBones)) {
            bones[boneMap[name] || name] = node.node;
        }

        return bones;
    }

    processMaterials(vrm) {
        // Handle VRM MToon materials
        return vrm.materials.map(mat => {
            if (mat.name === 'VRM/MToon') {
                return this.convertMToon(mat);
            }
            return mat;
        });
    }

    convertMToon(mtoonMaterial) {
        // Convert VRM MToon to Three.js shader
        return new MToonMaterial(mtoonMaterial);
    }
}

// CCD IK Solver
class CCDIKSolver {
    solve(chain, target, options = {}) {
        const { iterations = 10, tolerance = 0.001 } = options;

        for (let i = 0; i < iterations; i++) {
            // Iterate from end effector to root
            for (let j = chain.length - 2; j >= 0; j--) {
                const joint = chain[j];
                const endEffector = chain[chain.length - 1];

                // Get world positions
                const jointPos = new THREE.Vector3();
                joint.getWorldPosition(jointPos);

                const endPos = new THREE.Vector3();
                endEffector.getWorldPosition(endPos);

                // Calculate rotation to align with target
                const toTarget = new THREE.Vector3().subVectors(target, jointPos).normalize();
                const toEnd = new THREE.Vector3().subVectors(endPos, jointPos).normalize();

                const rotation = new THREE.Quaternion().setFromUnitVectors(toEnd, toTarget);
                joint.quaternion.multiply(rotation);

                // Apply constraints
                if (options.constraints && options.constraints[j]) {
                    this.applyConstraints(joint, options.constraints[j]);
                }

                joint.updateMatrixWorld();

                // Check convergence
                const endPosNew = new THREE.Vector3();
                endEffector.getWorldPosition(endPosNew);
                if (endPosNew.distanceTo(target) < tolerance) {
                    return;
                }
            }
        }
    }

    applyConstraints(joint, constraint) {
        // Euler angle limits
        if (constraint.min && constraint.max) {
            const euler = new THREE.Euler().setFromQuaternion(joint.quaternion);
            euler.x = Math.max(constraint.min.x, Math.min(constraint.max.x, euler.x));
            euler.y = Math.max(constraint.min.y, Math.min(constraint.max.y, euler.y));
            euler.z = Math.max(constraint.min.z, Math.min(constraint.max.z, euler.z));
            joint.quaternion.setFromEuler(euler);
        }
    }
}

// Avatar Instance
class AvatarInstance {
    constructor(userId, vrmData, options) {
        this.userId = userId;
        this.vrm = vrmData;
        this.options = options;

        this.root = new THREE.Group();
        this.root.add(vrmData.scene);

        // Animation state
        this.pose = {
            head: { position: new THREE.Vector3(), rotation: new THREE.Quaternion() },
            leftHand: [],
            rightHand: [],
            facial: new Float32Array(10)
        };

        this.targetPose = { ...this.pose }; // For interpolation
        this.interpolationSpeed = 15;
    }

    setHeadPose(pose) {
        this.targetPose.head = pose;
    }

    setHandPose(side, joints) {
        this.targetPose[`${side}Hand`] = joints;
    }

    interpolate(delta) {
        // Lerp towards target poses
        const alpha = 1 - Math.exp(-this.interpolationSpeed * delta);

        this.pose.head.position.lerp(this.targetPose.head.position, alpha);
        this.pose.head.rotation.slerp(this.targetPose.head.rotation, alpha);

        // Apply to bones
        const headBone = this.vrm.bones.head;
        if (headBone) {
            headBone.position.copy(this.pose.head.position);
            headBone.quaternion.copy(this.pose.head.rotation);
        }
    }

    update(delta) {
        // Update VRM spring bones
        if (this.vrm.springBones) {
            this.vrm.springBones.update(delta);
        }

        // Update blend shapes
        if (this.vrm.blendShapes) {
            for (let i = 0; i < this.pose.facial.length; i++) {
                this.vrm.blendShapes.setValue(i, this.pose.facial[i]);
            }
        }
    }

    setLOD(level) {
        // Adjust mesh quality, disable spring bones, etc.
        const meshes = [];
        this.vrm.scene.traverse(child => {
            if (child.isMesh) meshes.push(child);
        });

        meshes.forEach(mesh => {
            if (level >= 3) {
                mesh.visible = false;
            } else {
                mesh.visible = true;
                // Reduce geometry detail based on LOD
            }
        });
    }

    getBone(name) {
        return this.vrm.bones[name];
    }
}
