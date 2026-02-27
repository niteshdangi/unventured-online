import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';

export class SpectatorCamera {
    public camera: THREE.PerspectiveCamera;
    private controls: any;
    private moveForward = false;
    private moveBackward = false;
    private moveLeft = false;
    private moveRight = false;
    private moveUp = false;
    private moveDown = false;

    private speed = 500.0; // Increased base speed to traverse large map easier

    constructor(domElement: HTMLElement) {
        this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 12000);
        this.controls = new PointerLockControls(this.camera, domElement);

        this.initControls();
    }

    private initControls() {
        const onKeyDown = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'KeyW': this.moveForward = true; break;
                case 'KeyS': this.moveBackward = true; break;
                case 'KeyA': this.moveLeft = true; break;
                case 'KeyD': this.moveRight = true; break;
                case 'Space': this.moveUp = true; break;
                case 'ShiftLeft': this.moveDown = true; break;
            }
        };

        const onKeyUp = (event: KeyboardEvent) => {
            switch (event.code) {
                case 'KeyW': this.moveForward = false; break;
                case 'KeyS': this.moveBackward = false; break;
                case 'KeyA': this.moveLeft = false; break;
                case 'KeyD': this.moveRight = false; break;
                case 'Space': this.moveUp = false; break;
                case 'ShiftLeft': this.moveDown = false; break;
            }
        };

        document.addEventListener('keydown', onKeyDown);
        document.addEventListener('keyup', onKeyUp);
    }

    public update(delta: number) {
        if (!this.controls.isLocked) return;

        const moveSpeed = this.speed * delta;

        // 1. View-Direction (Look-to-Fly) Movement
        // Get forward and right vectors
        const forward = new THREE.Vector3();
        this.camera.getWorldDirection(forward);

        const right = new THREE.Vector3();
        right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        // Apply WASD based on view direction
        if (this.moveForward) this.camera.position.addScaledVector(forward, moveSpeed);
        if (this.moveBackward) this.camera.position.addScaledVector(forward, -moveSpeed);
        if (this.moveLeft) this.camera.position.addScaledVector(right, -moveSpeed);
        if (this.moveRight) this.camera.position.addScaledVector(right, moveSpeed);

        // 2. Global Vertical Movement (Elevator)
        if (this.moveUp) this.camera.position.y += moveSpeed;
        if (this.moveDown) this.camera.position.y -= moveSpeed;
    }

    public setActive(active: boolean) {
        if (active) {
            this.controls.lock();
        } else {
            this.controls.unlock();
        }
    }

    public sync(position: THREE.Vector3) {
        this.camera.position.copy(position);
        this.camera.position.y += 2; // Offset slightly
    }

    public get active(): boolean {
        return this.controls.isLocked;
    }
}
