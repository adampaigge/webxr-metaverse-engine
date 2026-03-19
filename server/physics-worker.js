const { parentPort, workerData } = require('worker_threads');
const { World, Vec3 } = require('cannon-es');

class PhysicsWorker {
    constructor(id) {
        this.id = id;
        this.world = null;
        this.bodies = new Map();
        this.frame = 0;
    }

    initialize(config) {
        this.world = new World({
            gravity: new Vec3(...(config.gravity || [0, -9.82, 0]))
        });

        this.world.solver.iterations = 10;
        this.world.allowSleep = true;

        return { success: true };
    }

    createBody({ id, data }) {
        // Create physics body
        return { success: true, id };
    }

    removeBody({ id }) {
        const body = this.bodies.get(id);
        if (body) {
            this.world.removeBody(body);
            this.bodies.delete(id);
        }
        return { success: true };
    }

    step({ delta }) {
        this.world.step(delta);
        this.frame++;

        // Collect state
        const state = {};
        for (const [id, body] of this.bodies) {
            state[id] = {
                position: [body.position.x, body.position.y, body.position.z],
                rotation: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w]
            };
        }

        return { frame: this.frame, state };
    }

    getState() {
        const state = {};
        for (const [id, body] of this.bodies) {
            state[id] = {
                position: [body.position.x, body.position.y, body.position.z],
                rotation: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
                velocity: [body.velocity.x, body.velocity.y, body.velocity.z]
            };
        }
        return state;
    }
}

const worker = new PhysicsWorker(workerData.id);

parentPort.on('message', async (msg) => {
    const { id, type, data } = msg;
    let result;

    switch(type) {
        case 'init':
            result = worker.initialize(data);
            break;
        case 'createBody':
            result = worker.createBody(data);
            break;
        case 'removeBody':
            result = worker.removeBody(data);
            break;
        case 'step':
            result = worker.step(data);
            break;
        case 'getState':
            result = worker.getState();
            break;
        default:
            result = { error: 'Unknown type' };
    }

    parentPort.postMessage({ id, result });
});
