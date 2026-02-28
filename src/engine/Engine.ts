/*
  Engine.ts
  -------------------------------------------------------
  High-level orchestration layer.

  Responsibilities:
  - WebGPU initialization
  - Floating origin control
  - Camera state
  - Resize handling
  - Frame loop
*/

import { PlanetRenderer } from "./PlanetRenderer";
import { FloatingOriginController, type CameraLocalState } from "./FloatingOriginController";
import { FlyCamera } from "./FlyCamera";


export class Engine {
    private canvas: HTMLCanvasElement;

    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private format!: GPUTextureFormat;

    private renderer!: PlanetRenderer;
    private floatingOrigin!: FloatingOriginController;
    private camera!: FlyCamera;

    private animationId = 0;
    private lastFrameTime = 0;
    private destroyed = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
    }

    async start() {
        await this.initWebGPU();
        if (this.destroyed) return;

        this.initSystems();
        this.resize();

        window.addEventListener("resize", this.resize);
        this.animationId = requestAnimationFrame(this.loop);
    }

    destroy() {
        this.destroyed = true;
        cancelAnimationFrame(this.animationId);
        window.removeEventListener("resize", this.resize);
    }

    // ------------------------------------------------------
    // WebGPU
    // ------------------------------------------------------

    private async initWebGPU() {
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported");
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error("No GPU adapter found");
        }

        const requiredLimits: Record<string, number> = {};
        if (adapter.limits.maxTextureArrayLayers) {
            requiredLimits.maxTextureArrayLayers = adapter.limits.maxTextureArrayLayers;
        }

        this.device = await adapter.requestDevice({ requiredLimits });

        this.device.addEventListener('uncapturederror', (event: any) => {
            console.error('A WebGPU error was not captured:', event.error);
            const errorDiv = document.createElement('div');
            errorDiv.style.position = 'absolute';
            errorDiv.style.top = '10px';
            errorDiv.style.left = '10px';
            errorDiv.style.background = 'red';
            errorDiv.style.color = 'white';
            errorDiv.style.padding = '10px';
            errorDiv.style.zIndex = '9999';
            errorDiv.innerText = 'WebGPU Error: ' + event.error.message;
            document.body.appendChild(errorDiv);
        });

        this.context = this.canvas.getContext("webgpu")!;
        this.format = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: "opaque"
        });
    }

    // ------------------------------------------------------
    // Systems
    // ------------------------------------------------------

    private initSystems() {
        this.floatingOrigin = new FloatingOriginController(
            0.0,
            0.0
        );
        this.camera = new FlyCamera(this.canvas, {
            moveSpeed: 5000.0,
            mouseSensitivity: 0.002
        });

        // Start 1000m up
        this.camera.position[2] = 1000.0;
        this.renderer = new PlanetRenderer(
            this.device,
            this.context,
            this.format,
            {
                planetRadius: 6378137.0,
                maxLevel: 14,
                minLevel: 1,
                sseThreshold: 8.0,
                gridResolution: 33,
                maxTextureLayers: this.device.limits.maxTextureArrayLayers || 256
            }
        );
    }

    // ------------------------------------------------------
    // Resize
    // ------------------------------------------------------

    private resize = () => {
        const dpr = window.devicePixelRatio || 1;

        const width = Math.floor(this.canvas.clientWidth * dpr);
        const height = Math.floor(this.canvas.clientHeight * dpr);

        this.canvas.width = width;
        this.canvas.height = height;

        this.renderer.resize(width, height);
    };

    // ------------------------------------------------------
    // Frame Loop
    // ------------------------------------------------------

    private loop = (time: number) => {
        const dt = (time - this.lastFrameTime) / 1000;
        this.lastFrameTime = time;

        this.update(Math.min(dt, 0.1)); // cap dt at 100ms
        this.animationId = requestAnimationFrame(this.loop);
    };

    private update(dt: number) {
        this.camera.update(dt);

        // Fetch camera vectors
        const forward = this.camera.getForward();
        const up = this.camera.getUp();

        const cameraState: CameraLocalState = {
            position: { x: this.camera.position[0], y: this.camera.position[1], z: this.camera.position[2] },
            forward: { x: forward[0], y: forward[1], z: forward[2] },
            up: { x: up[0], y: up[1], z: up[2] }
        };

        this.renderer.render(
            cameraState,
            this.canvas.width,
            this.canvas.height,
            this.floatingOrigin.getAnchor()
        );
    }
}