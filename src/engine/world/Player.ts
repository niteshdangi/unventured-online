import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { InputManager } from '../core/Input';
import { PhysicsManager } from '../core/Physics';

export class Player {
    private mesh: THREE.Mesh;
    private readonly moveSpeed = 100; // Increased for real-world scale
    private fallVelocity = 0;
    private readonly gravity = -150; // Scaled up to match the fast move speed
    private scene: THREE.Scene;

    // By placing the physics anchor exactly at the Surface Radius, 
    // local Y=0 becomes Sea Level. The player's local elevation is exactly their real-world altitude!
    public physicsAnchor = new THREE.Vector3(0, 6371000, 0);
    private readonly anchorShiftThreshold = 1000; // Shift anchor if 1km away

    // Physics
    private rigidBody!: RAPIER.RigidBody;
    private collider!: RAPIER.Collider;
    private characterController!: RAPIER.KinematicCharacterController;

    // Camera & Controls
    private controls!: PointerLockControls;
    private camera!: THREE.PerspectiveCamera;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        const playerGeo = new THREE.BoxGeometry(1, 2, 1);
        const playerMat = new THREE.MeshStandardMaterial({ color: 0xff4444 });
        this.mesh = new THREE.Mesh(playerGeo, playerMat);
        // Hide the mesh since we are in first/third person attached to it
        this.mesh.visible = false;

        // Position half height to stand perfectly on ground
        this.mesh.position.y = 1;
        this.mesh.castShadow = true;
    }

    public attachCamera(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
        this.camera = camera;
        this.controls = new PointerLockControls(this.camera, domElement);

        // Click to lock mouse
        domElement.addEventListener('click', () => {
            if (!this.controls.isLocked) {
                this.controls.lock();
            }
        });
    }

    public isActive(): boolean {
        return this.controls ? this.controls.isLocked : false;
    }

    public init(physics: PhysicsManager) {
        this.scene.add(this.mesh);

        // 1. Create Kinematic RigidBody relative to the physics anchor (which starts at 0,0,0)
        const rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
            .setTranslation(0, 0, 0); // Start at anchor
        this.rigidBody = physics.world.createRigidBody(rigidBodyDesc);

        // 2. Create Capsule Collider (1 unit radius, 2 units tall = roughly matching 1x2x1 box)
        const colliderDesc = RAPIER.ColliderDesc.capsule(1, 0.5);
        this.collider = physics.world.createCollider(colliderDesc, this.rigidBody);

        // 3. Create Kinematic Character Controller
        this.characterController = physics.world.createCharacterController(0.1);
        this.characterController.setApplyImpulsesToDynamicBodies(true);
        this.characterController.enableSnapToGround(0.5);
        this.characterController.setMaxSlopeClimbAngle(85 * Math.PI / 180); // Allow climbing very steep real-world mountains (85 degrees)
        this.characterController.setMinSlopeSlideAngle(85 * Math.PI / 180);
    }

    public update(delta: number, input: InputManager, camera: THREE.Camera) {
        if (this.controls && !this.controls.isLocked) {
            return; // Don't move if menu is open
        }

        // Handle input vector
        const movement = input.getMovementVector();

        // Rotate movement vector to align with camera's yaw (Y-axis rotation)
        const cameraEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        const yaw = cameraEuler.y;
        movement.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

        // Standard flat gravity calculation since Planet handles geographic curvature rotation mathematically
        const velocity = movement.multiplyScalar(this.moveSpeed * delta);
        this.fallVelocity += this.gravity * delta;

        // Jump
        if (this.characterController.computedGrounded() && input.isKeyDown(' ')) {
            this.fallVelocity = 80; // Jump force
        }

        // Terminal velocity check
        if (this.fallVelocity < -300) {
            this.fallVelocity = -300;
        }

        velocity.y = this.fallVelocity * delta;

        // Compute the physics movement including collisions
        this.characterController.computeColliderMovement(
            this.collider,
            velocity,
            RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
        );

        let movementData = this.characterController.computedMovement();

        // If we touched the ground this frame, reset vertical velocity so we don't accumulate massive gravity while standing still
        if (this.characterController.computedGrounded()) {
            this.fallVelocity = -2; // Keep a small downward force to stick to slopes
        }

        // Fallback: If computed movement is identical to regular velocity on X/Z (meaning NO collisions in that tick),
        // or if we are barely moving when we requested high speed (stuck on unloaded chunk edge),
        // we can force kinematic translation to prevent getting stuck in unloaded areas.
        const reqXZSpeed = Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
        const actXZSpeed = Math.sqrt(movementData.x * movementData.x + movementData.z * movementData.z);

        // If trying to move but physics blocked us entirely horizontally (like hitting the edge of an unloaded rigid body)
        if (reqXZSpeed > 0 && actXZSpeed < reqXZSpeed * 0.1) {
            // Force the movement
            movementData = velocity;
        }

        const currentPos = this.rigidBody.translation();

        // Safety Net to prevent falling through the procedurally generating terrain
        // Since Y=0 is exact sea level, we never let the physics body fall below sea level.
        const nextY = currentPos.y + movementData.y;

        if (nextY < 0) {
            this.fallVelocity = 0; // Hit the ground
            this.rigidBody.setNextKinematicTranslation({
                x: currentPos.x + movementData.x,
                y: 0,
                z: currentPos.z + movementData.z
            });
        } else {
            this.rigidBody.setNextKinematicTranslation({
                x: currentPos.x + movementData.x,
                y: nextY,
                z: currentPos.z + movementData.z
            });
        }

        // Sync Three.js Mesh to Rapier RigidBody
        const newPos = this.rigidBody.translation();
        this.mesh.position.set(newPos.x, newPos.y, newPos.z);
        // We no longer need Quaternions because the Planet Mesh rotates underneath the player natively!

        // Update 64-bit precise Global Position for the Planet Renderer
        // This is no longer needed as the player's local position is directly relative to the planet's center.

        // Shift anchor if drifting too far from (0,0,0) inside the 32-bit physics engine
        if (newPos.x * newPos.x + newPos.y * newPos.y + newPos.z * newPos.z > this.anchorShiftThreshold * this.anchorShiftThreshold) {
            this.physicsAnchor.copy(new THREE.Vector3(
                this.physicsAnchor.x + newPos.x,
                this.physicsAnchor.y + newPos.y,
                this.physicsAnchor.z + newPos.z
            ));
            this.rigidBody.setTranslation({ x: 0, y: 0, z: 0 }, true);
            this.mesh.position.set(0, 0, 0);
        }

        // Attach camera to player head (1st person)
        if (this.camera) {
            this.camera.position.set(this.mesh.position.x, this.mesh.position.y + 0.8, this.mesh.position.z);
        }
    }

    public getPosition(): THREE.Vector3 {
        return this.mesh.position.clone();
    }

    public setPosition(x: number, y: number, z: number) {
        if (this.rigidBody) {
            this.rigidBody.setTranslation({ x, y, z }, true);
        }
        this.mesh.position.set(x, y, z);
    }
}
