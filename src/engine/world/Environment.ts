import * as THREE from 'three';

export class Environment {
    private scene: THREE.Scene;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
    }

    public init() {
        // Setup Fog (color tweaked to match a bright sky)
        // DISABLED FOR NOW
        // this.scene.fog = new THREE.Fog(0x87ceeb, 20, 300);

        // Setup Lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        // Move light higher for large scale shadows
        dirLight.position.set(50, 100, 50);
        dirLight.castShadow = true;

        // Increase shadow map resolution and camera frustum for large terrain
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.left = -200;
        dirLight.shadow.camera.right = 200;
        dirLight.shadow.camera.top = 200;
        dirLight.shadow.camera.bottom = -200;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 500;

        this.scene.add(dirLight);
    }
}
