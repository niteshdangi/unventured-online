import { vec3, quat } from "gl-matrix";

export interface FlyCameraConfig {
    moveSpeed: number;
    mouseSensitivity: number;
}

export class FlyCamera {
    public position: vec3;
    private rotation: quat;

    private config: FlyCameraConfig;

    private isLocked = false;
    private keys: Record<string, boolean> = {};

    private pitch = 0;
    private yaw = 0;

    constructor(canvas: HTMLCanvasElement, config: FlyCameraConfig) {
        this.config = config;

        this.position = vec3.create();
        this.rotation = quat.create();

        // Bind events
        canvas.addEventListener("click", () => {
            canvas.requestPointerLock();
        });

        document.addEventListener("pointerlockchange", () => {
            this.isLocked = document.pointerLockElement === canvas;
        });

        document.addEventListener("mousemove", (e) => {
            if (!this.isLocked) return;

            this.yaw -= e.movementX * this.config.mouseSensitivity;
            this.pitch -= e.movementY * this.config.mouseSensitivity;

            // Clamp pitch to prevent flipping
            const maxPitch = Math.PI / 2 - 0.01;
            this.pitch = Math.max(-maxPitch, Math.min(maxPitch, this.pitch));

            quat.fromEuler(this.rotation, this.pitch * (180 / Math.PI), this.yaw * (180 / Math.PI), 0);
        });

        document.addEventListener("keydown", (e) => {
            this.keys[e.code] = true;
        });

        document.addEventListener("keyup", (e) => {
            this.keys[e.code] = false;
        });

        document.addEventListener("wheel", (e) => {
            if (!this.isLocked) return;

            const forward = this.getForward();
            let zoomSpeed = this.config.moveSpeed;
            if (this.keys["ShiftLeft"]) zoomSpeed *= 10;

            // Scroll up (negative deltaY) = zoom in (move forward)
            // Scroll down (positive deltaY) = zoom out (move backward)
            const zoomAmount = -Math.sign(e.deltaY) * zoomSpeed * 10.0;
            vec3.scaleAndAdd(this.position, this.position, forward, zoomAmount);
        }, { passive: true });
    }

    public update(dt: number) {
        if (!this.isLocked) return;

        const forward = vec3.create();
        vec3.transformQuat(forward, [0, 0, -1], this.rotation);

        const right = vec3.create();
        vec3.transformQuat(right, [1, 0, 0], this.rotation);

        const up = vec3.create();
        vec3.transformQuat(up, [0, 1, 0], this.rotation);

        const velocity = vec3.create();

        let moveSpeed = this.config.moveSpeed;
        if (this.keys["ShiftLeft"]) moveSpeed *= 10;

        if (this.keys["KeyW"]) vec3.scaleAndAdd(velocity, velocity, forward, moveSpeed);
        if (this.keys["KeyS"]) vec3.scaleAndAdd(velocity, velocity, forward, -moveSpeed);
        if (this.keys["KeyA"]) vec3.scaleAndAdd(velocity, velocity, right, -moveSpeed);
        if (this.keys["KeyD"]) vec3.scaleAndAdd(velocity, velocity, right, moveSpeed);
        if (this.keys["Space"]) vec3.scaleAndAdd(velocity, velocity, up, moveSpeed);
        if (this.keys["ControlLeft"]) vec3.scaleAndAdd(velocity, velocity, up, -moveSpeed);

        vec3.scaleAndAdd(this.position, this.position, velocity, dt);
    }

    public getForward(): vec3 {
        const forward = vec3.create();
        vec3.transformQuat(forward, [0, 0, -1], this.rotation);
        return forward;
    }

    public getUp(): vec3 {
        const up = vec3.create();
        vec3.transformQuat(up, [0, 1, 0], this.rotation);
        return up;
    }
}
