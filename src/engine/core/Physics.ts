import RAPIER from '@dimforge/rapier3d-compat';

export class PhysicsManager {
    public readonly RAPIER = RAPIER;
    public world!: RAPIER.World;

    constructor() {
        // Postpone instantiation until WebAssembly loads
    }

    public async init() {
        await RAPIER.init();
        const gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.world = new RAPIER.World(gravity);
    }

    public step() {
        this.world.step();
    }
}
