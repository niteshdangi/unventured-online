import { WebGPURenderer } from 'three/webgpu';
import { World } from '../world/World';
import { InputManager } from './Input';
import { PhysicsManager } from './Physics';
import { NetworkManager } from './Network';

export class Engine {
    private canvas: HTMLCanvasElement;
    private renderer: WebGPURenderer;
    private isRunning: boolean = false;
    private lastTime: number = 0;

    // Modules
    private world: World;
    private input: InputManager;
    private physics: PhysicsManager;
    private network: NetworkManager;
    private spectator: any;
    private useSpectator = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;

        // Initialize WebGPU Renderer
        this.renderer = new WebGPURenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(0x87ceeb);

        // Initialize Modules
        this.physics = new PhysicsManager();
        this.world = new World();
        this.input = new InputManager();
        this.network = new NetworkManager(this.world.getScene());

        // Bind event handlers
        this.handleResize = this.handleResize.bind(this);
        this.animate = this.animate.bind(this);
    }

    public async start() {
        if (this.isRunning) return;
        this.isRunning = true;

        // Initialize CORE systems synchronously
        await this.physics.init();

        // --- SPECTATOR CAMERA ---
        const { SpectatorCamera } = await import('./SpectatorCamera');
        this.spectator = new SpectatorCamera(this.canvas);

        // --- PRODUCTION ASSET PRE-FETCHING ---
        const assetManager = (await import('../core/AssetManager')).AssetManager.getInstance();
        const { WORLD_CONFIG } = await import('../world/WorldConfig');
        await assetManager.prefetch([], [
            WORLD_CONFIG.foliage.modelPath
        ]);

        this.world.init(this.physics);

        const { MapzenProvider } = await import('../world/MapzenProvider');
        const mz = WORLD_CONFIG.mapzen;
        const startElev = await MapzenProvider.getElevationLatLonAsync(mz.originLat, mz.originLon, mz.zoom);

        this.world.getPlayer().setPosition(0, startElev + 2, 0);

        // Attach the world camera to the player using PointerLockControls
        this.world.getPlayer().attachCamera(this.world.getCamera(), this.canvas);

        this.input.init();

        // Connect to multiplayer server
        this.network.connect();

        // Toggle camera with 'V'
        window.addEventListener('keydown', (e) => {
            if (e.code === 'KeyV') {
                this.useSpectator = !this.useSpectator;
                this.spectator.setActive(this.useSpectator);
                if (this.useSpectator) {
                    this.spectator.sync(this.world.getCamera().position);
                }
            }
        });

        // Attach event listeners
        window.addEventListener('resize', this.handleResize);

        // Start render loop
        this.lastTime = performance.now();
        this.renderer.setAnimationLoop(this.animate);
    }

    public stop() {
        this.isRunning = false;
        this.renderer.setAnimationLoop(null);
        this.input.dispose();
        window.removeEventListener('resize', this.handleResize);
    }

    public cleanup() {
        this.stop();
        this.renderer.dispose();
    }

    private handleResize() {
        this.world.handleResize();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    private animate(time: number) {
        if (!this.isRunning) return;

        const delta = (time - this.lastTime) / 1000;
        this.lastTime = time;

        this.physics.step();

        if (this.useSpectator) {
            this.spectator.update(delta);
        }

        const activeCamera = this.useSpectator ? this.spectator.camera : this.world.getCamera();
        this.world.update(delta, this.input, this.network, activeCamera);

        this.renderer.render(this.world.getScene(), activeCamera);
    }
}
