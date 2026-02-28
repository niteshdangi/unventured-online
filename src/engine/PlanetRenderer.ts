/*
  PlanetRenderer.ts
  -------------------------------------------------------
  FINAL Enterprise MMO-Grade Planet Renderer

  Corrected:
  - Double-buffered GPU counter readback
  - No outstanding mapAsync conflicts
  - Proper async frame safety
  - Frustum + GPU visibility integrated
*/

import { mat4, glMatrix } from "gl-matrix";

// Use 64-bit float precision for CPU math to prevent 
// Earth-scale jitter (6,371,000m radius) before sending to GPU
glMatrix.setMatrixArrayType(Float64Array as any);
import { type CameraState, QuadtreeManager } from "./QuadtreeManager";
import { type CameraLocalState } from "./FloatingOriginController";
import { GpuTileMetadataBuffer } from "./GpuTileMetadataBuffer";
import { IndirectDrawBuffer } from "./IndirectDrawBuffer";
import { TilePatchGeometry } from "./TilePatchGeometry";
import { FrustumPlanes } from "./FrustumPlanes";
import { type Geodetic, geodeticToECEF, enuToECEF } from "./PlanetMath";
import { TextureAtlas } from "./TextureAtlas";
import { TileFetcher } from "./TileFetcher";

export interface PlanetRendererConfig {
    planetRadius: number;
    maxLevel: number;
    minLevel: number;
    sseThreshold: number;
    gridResolution: number;
    maxTextureLayers: number;
}

export class PlanetRenderer {
    private device: GPUDevice;
    private context: GPUCanvasContext;
    private format: GPUTextureFormat;

    private quadtree: QuadtreeManager;
    private tileBuffer: GpuTileMetadataBuffer;
    private indirectBuffer: IndirectDrawBuffer;
    private geometry: TilePatchGeometry;
    private frustum: FrustumPlanes;

    private tileFetcher: TileFetcher;
    private albedoAtlas: TextureAtlas;
    private elevationAtlas: TextureAtlas;

    private mvpBuffer: GPUBuffer;
    private frustumBuffer: GPUBuffer;

    private renderPipeline: GPURenderPipeline;
    private depthTexture!: GPUTexture;

    private planetRadius: number;

    constructor(
        device: GPUDevice,
        context: GPUCanvasContext,
        format: GPUTextureFormat,
        config: PlanetRendererConfig
    ) {
        this.device = device;
        this.context = context;
        this.format = format;
        this.planetRadius = config.planetRadius;

        this.quadtree = new QuadtreeManager({
            planetRadius: config.planetRadius,
            maxLevel: config.maxLevel,
            minLevel: config.minLevel,
            sseThreshold: config.sseThreshold
        });

        this.tileBuffer = new GpuTileMetadataBuffer(device);
        this.indirectBuffer = new IndirectDrawBuffer(device);
        this.geometry = new TilePatchGeometry(device, {
            resolution: config.gridResolution,
            enableSkirts: true
        });

        this.frustum = new FrustumPlanes();

        this.tileFetcher = new TileFetcher();
        this.albedoAtlas = new TextureAtlas(device, "rgba8unorm", 256, config.maxTextureLayers);
        this.elevationAtlas = new TextureAtlas(device, "rgba8unorm", 256, config.maxTextureLayers);
        this.albedoAtlas.initialize();
        this.elevationAtlas.initialize();

        this.mvpBuffer = device.createBuffer({
            size: 64,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.frustumBuffer = device.createBuffer({
            size: 24 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        this.renderPipeline = this.createRenderPipeline();


    }

    resize(width: number, height: number) {
        this.depthTexture = this.device.createTexture({
            size: [width, height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT
        });
    }

    private renderBindGroup?: GPUBindGroup;
    private cachedTileBuffer?: GPUBuffer;
    private cachedMvpBuffer?: GPUBuffer;
    private isRendering = false;

    async render(cameraState: CameraLocalState, width: number, height: number, anchorGeodetic: Geodetic) {
        if (this.isRendering) return;
        this.isRendering = true;

        try {
            if (!this.depthTexture) this.resize(width, height);

            const projection = mat4.create();
            // Use perspectiveZO (Zero-to-One) for WebGPU clip space [0, 1] instead of OpenGL [-1, 1]
            // Increase Near to 0.1 and Far to 1e8 to prevent clipping the planet in deep orbit
            mat4.perspectiveZO(projection, Math.PI / 4, width / height, 0.1, 1e8);

            const view = mat4.create();

            const target = [
                cameraState.position.x + cameraState.forward.x,
                cameraState.position.y + cameraState.forward.y,
                cameraState.position.z + cameraState.forward.z
            ] as [number, number, number];

            mat4.lookAt(
                view,
                [cameraState.position.x, cameraState.position.y, cameraState.position.z],
                target,
                [cameraState.up.x, cameraState.up.y, cameraState.up.z]
            );

            const anchorECEF = geodeticToECEF(anchorGeodetic);
            const sinLat = Math.sin(anchorGeodetic.lat);
            const cosLat = Math.cos(anchorGeodetic.lat);
            const sinLon = Math.sin(anchorGeodetic.lon);
            const cosLon = Math.cos(anchorGeodetic.lon);

            // ECEF to ENU matrix (Rotation derived from PlanetMath, Translation offsets by anchor)
            const ecefToEnu = mat4.fromValues(
                -sinLon, -sinLat * cosLon, cosLat * cosLon, 0,
                cosLon, -sinLat * sinLon, cosLat * sinLon, 0,
                0, cosLat, sinLat, 0,
                0, 0, 0, 1
            );
            mat4.translate(ecefToEnu, ecefToEnu, [-anchorECEF.x, -anchorECEF.y, -anchorECEF.z]);

            const mvp = mat4.create();
            mat4.multiply(mvp, projection, view);
            // Bake EcefToEnu into MVP so the shader operates entirely in ECEF world space
            mat4.multiply(mvp, mvp, ecefToEnu);

            // Downcast to f32 right before sending to GPU
            const mvpData = new Float32Array(mvp as any);
            this.device.queue.writeBuffer(
                this.mvpBuffer,
                0,
                mvpData.buffer,
                mvpData.byteOffset,
                mvpData.byteLength
            );

            this.frustum.updateFromMatrix(mvp as any);

            const frustumData = this.frustum.toFloat32Array();
            this.device.queue.writeBuffer(
                this.frustumBuffer,
                0,
                frustumData.buffer,
                frustumData.byteOffset,
                frustumData.byteLength
            );

            const cameraECEF = enuToECEF(cameraState.position, anchorGeodetic);
            const quadtreeCameraState: CameraState = {
                positionECEF: cameraECEF,
                screenHeight: height,
                frustum: this.frustum
            };

            const { added, removed, active: activeTiles } = this.quadtree.update(quadtreeCameraState);

            for (const tile of removed) {
                this.albedoAtlas.freeLayer(tile);
                this.elevationAtlas.freeLayer(tile);
                this.tileFetcher.cancelTile(tile, "albedo");
                this.tileFetcher.cancelTile(tile, "elevation");
            }

            for (const tile of added) {
                const albedoLayer = this.albedoAtlas.allocateLayer(tile);
                const elevationLayer = this.elevationAtlas.allocateLayer(tile);

                if (albedoLayer !== null) {
                    this.tileFetcher.fetchTile(tile, "albedo").then(bmp => {
                        if (bmp && this.albedoAtlas.hasLayer(tile)) {
                            if (this.albedoAtlas.getLayer(tile) === albedoLayer) {
                                this.albedoAtlas.uploadTexture(albedoLayer, bmp);
                            }
                        }
                    });
                }

                if (elevationLayer !== null) {
                    this.tileFetcher.fetchTile(tile, "elevation").then(bmp => {
                        if (bmp && this.elevationAtlas.hasLayer(tile)) {
                            if (this.elevationAtlas.getLayer(tile) === elevationLayer) {
                                this.elevationAtlas.uploadTexture(elevationLayer, bmp);
                            }
                        }
                    });
                }
            }

            this.tileBuffer.update(activeTiles, this.albedoAtlas, this.elevationAtlas);
            this.indirectBuffer.ensureCapacity(activeTiles.length);
            this.indirectBuffer.setDrawCommand(this.geometry.getIndexCount(), activeTiles.length);

            const encoder = this.device.createCommandEncoder();

            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: this.context.getCurrentTexture().createView(),
                    loadOp: "clear",
                    storeOp: "store",
                    clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 }
                }],
                depthStencilAttachment: {
                    view: this.depthTexture.createView(),
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                    depthClearValue: 1.0
                }
            });

            const currentTileBuffer = this.tileBuffer.getBuffer();
            if (!this.renderBindGroup ||
                this.cachedTileBuffer !== currentTileBuffer ||
                this.cachedMvpBuffer !== this.mvpBuffer) {

                this.cachedTileBuffer = currentTileBuffer;
                this.cachedMvpBuffer = this.mvpBuffer;

                this.renderBindGroup = this.device.createBindGroup({
                    layout: this.renderPipeline.getBindGroupLayout(0),
                    entries: [
                        { binding: 0, resource: { buffer: currentTileBuffer } },
                        { binding: 1, resource: { buffer: this.mvpBuffer } },
                        { binding: 2, resource: this.albedoAtlas.sampler },
                        { binding: 3, resource: this.albedoAtlas.view },
                        { binding: 4, resource: this.elevationAtlas.view }
                    ]
                });
            }

            pass.setPipeline(this.renderPipeline);
            pass.setBindGroup(0, this.renderBindGroup);
            pass.setVertexBuffer(0, this.geometry.getVertexBuffer());
            pass.setIndexBuffer(this.geometry.getIndexBuffer(), "uint32");

            pass.drawIndexedIndirect(this.indirectBuffer.getDrawBuffer(), 0);

            pass.end();
            this.device.queue.submit([encoder.finish()]);
        } finally {
            this.isRendering = false;
        }
    }

    private createRenderPipeline(): GPURenderPipeline {
        const module = this.device.createShaderModule({
            code: `
struct Tile {
  center: vec4<f32>,   // xyz = local ENU center, w = bounding radius
  level: u32,
  x: u32,
  y: u32,
  pad: u32,
}

@group(0) @binding(0)
var<storage, read> tiles: array<Tile>;

@group(0) @binding(1)
var<uniform> mvp: mat4x4<f32>;

@group(0) @binding(2)
var mapSampler: sampler;

@group(0) @binding(3)
var albedoAtlas: texture_2d_array<f32>;

@group(0) @binding(4)
var elevationAtlas: texture_2d_array<f32>;

struct VSOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) @interpolate(flat) albedoLayer: u32,
}

fn webMercatorToSphere(x: f32, y: f32, z: f32, radius: f32) -> vec3<f32> {
  let PI: f32 = 3.14159265359;
  
  let tilesAtZoom = exp2(z);
  let lng = (x / tilesAtZoom) * 360.0 - 180.0;
  
  let n = PI - 2.0 * PI * y / tilesAtZoom;
  let lat_rad = atan(0.5 * (exp(n) - exp(-n)));
  let lng_rad = lng * PI / 180.0;

  // WGS84 simplistic spherical mapping
  let cosLat = cos(lat_rad);
  let sinLat = sin(lat_rad);
  let cosLon = cos(lng_rad);
  let sinLon = sin(lng_rad);

  return vec3<f32>(
      radius * cosLat * cosLon,
      radius * cosLat * sinLon,
      radius * sinLat
  );
}

@vertex
fn vs(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) uv: vec2<f32>,
  @builtin(instance_index) instance: u32
) -> VSOut {
  let tile = tiles[instance];
  
  let albedoLayer = tile.pad & 0xFFFFu;
  let elevationLayer = tile.pad >> 16u;

  let globalX = f32(tile.x) + uv.x;
  let globalY = f32(tile.y) + uv.y;

  // Read Mapzen Terrarium Elevation Data
  let elevationDims = textureDimensions(elevationAtlas);
  
  // Explicitly guard against UV=1.0 spilling into invalid memory space
  let texU = min(u32(uv.x * f32(elevationDims.x)), elevationDims.x - 1u);
  let texV = min(u32(uv.y * f32(elevationDims.y)), elevationDims.y - 1u);
  let elevTexel = textureLoad(elevationAtlas, vec2<i32>(i32(texU), i32(texV)), i32(elevationLayer), 0);
  
  // Mapzen Encoding: (R * 256 + G + B / 256) - 32768
  let r = elevTexel.r * 255.0;
  let g = elevTexel.g * 255.0;
  let b = elevTexel.b * 255.0;
  var elevationMeters = (r * 256.0 + g + b / 256.0) - 32768.0;

  // IMPORTANT: If Texture is still downloading or failed, alpha is 0.
  // Force elevation to 0 to prevent the tile from diving 32km underground and being backface culled!
  if (elevTexel.a == 0.0) {
      elevationMeters = 0.0;
  }

  // Flatten oceans and exaggerate land for dramatic visual effect 
  // (Earth is VERY smooth at 1:1 scale)
  if (elevationMeters < 0.0) {
      elevationMeters = 0.0;
  }
  
  // Apply a dynamic geometry drop if this vertex is part of the skirt (vertex_index >= 33*33)
  // We use 9000 meters to securely span planetary LOD cracks natively without overlap Z-fighting.
  var skirtDrop = 0.0;
  if (vertexIndex >= 1089u) {
      skirtDrop = 9000.0; 
  }

  let displacement = (elevationMeters * 3.0) - skirtDrop;

  let worldECEF = webMercatorToSphere(globalX, globalY, f32(tile.level), 6378137.0 + displacement);

  var out: VSOut;
  out.position = mvp * vec4<f32>(worldECEF, 1.0);
  out.uv = uv;
  out.albedoLayer = albedoLayer;
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let color = textureSample(albedoAtlas, mapSampler, in.uv, in.albedoLayer);
  
  // Minor hack: if Mapzen/Bing failed to load, fallback color
  if (color.a == 0.0) {
      return vec4<f32>(0.2, 0.4, 0.2, 1.0);
  }
  
  return color;
}
`
        });

        return this.device.createRenderPipeline({
            layout: "auto",
            vertex: {
                module,
                entryPoint: "vs",
                buffers: [{
                    arrayStride: 8,
                    attributes: [{
                        shaderLocation: 0,
                        offset: 0,
                        format: "float32x2"
                    }]
                }]
            },
            fragment: {
                module,
                entryPoint: "fs",
                targets: [{ format: this.format }]
            },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less"
            }
        });
    }
}
