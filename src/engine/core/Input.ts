import * as THREE from 'three';

export class InputManager {
    private keys: { [key: string]: boolean } = {};

    constructor() {
        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
    }

    public init() {
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
    }

    public dispose() {
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        this.keys = {};
    }

    private handleKeyDown(e: KeyboardEvent) {
        this.keys[e.key.toLowerCase()] = true;
    }

    private handleKeyUp(e: KeyboardEvent) {
        this.keys[e.key.toLowerCase()] = false;
    }

    public isKeyDown(key: string): boolean {
        return !!this.keys[key.toLowerCase()];
    }

    public getMovementVector(): THREE.Vector3 {
        const moveDir = new THREE.Vector3(0, 0, 0);

        if (this.isKeyDown('w')) moveDir.z -= 1;
        if (this.isKeyDown('s')) moveDir.z += 1;
        if (this.isKeyDown('a')) moveDir.x -= 1;
        if (this.isKeyDown('d')) moveDir.x += 1;

        if (moveDir.length() > 0) {
            moveDir.normalize();
        }

        return moveDir;
    }
}
