import * as THREE from 'three';
import { Environment } from './Environment';
import { Player } from './Player';
import { Planet } from './planet/Planet';
import { InputManager } from '../core/Input';
import { PhysicsManager } from '../core/Physics';
import { NetworkManager } from '../core/Network';
import { WORLD_CONFIG } from './WorldConfig';

export class World {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;

    private environment: Environment;
    private player: Player;
    private planet: Planet;

    constructor() {
        this.scene = new THREE.Scene();

        // Initialize Camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.1,
            20000000 // Huge far plane for planetary scale
        );
        this.camera.position.set(0, 5000, 10);
        this.camera.lookAt(0, 0, 0);

        // Initialize Entities
        this.environment = new Environment(this.scene);
        this.player = new Player(this.scene);
        this.planet = new Planet(this.scene);
    }

    public init(physics: PhysicsManager) {
        this.environment.init();
        this.player.init(physics);
        this.planet.init();

        // Rotational Floating Origin: Orient the planet so the geographic origin is exactly at Local (0, R, 0)
        const mz = WORLD_CONFIG.mapzen;
        const radius = 6371000;

        const latRad = THREE.MathUtils.degToRad(mz.originLat);
        const lonRad = THREE.MathUtils.degToRad(mz.originLon);

        const originPoint = new THREE.Vector3(
            radius * Math.cos(latRad) * Math.sin(lonRad),
            radius * Math.sin(latRad),
            radius * Math.cos(latRad) * Math.cos(lonRad)
        ).normalize();

        const targetUp = new THREE.Vector3(0, 1, 0);
        const q = new THREE.Quaternion().setFromUnitVectors(originPoint, targetUp);

        this.planet.getRootGroup().quaternion.copy(q);
    }

    public update(delta: number, input: InputManager, network: NetworkManager, activeCamera: THREE.PerspectiveCamera) {
        // Update all dynamic entities
        this.player.update(delta, input, this.camera);

        // Render-space Floating Origin shift
        // The Planet is drawn relative to the physics anchor to prevent 32-bit floating point precision loss
        this.planet.getRootGroup().position.copy(this.player.physicsAnchor).negate();

        // Update planet quadtree using the inverted scene matrix via local camera coordinates
        this.planet.update(activeCamera, window.innerHeight);

        // Broadcast our position to the server
        network.broadcastLocalState(this.player);

        // Smoothly move other players
        network.updateInterpolation(delta);
    }

    public getScene(): THREE.Scene {
        return this.scene;
    }

    public getCamera(): THREE.PerspectiveCamera {
        return this.camera;
    }

    public getPlayer(): Player {
        return this.player;
    }

    public handleResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
    }
}
