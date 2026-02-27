export const WORLD_CONFIG = {
    // Spatial Partitioning
    chunk: {
        size: 100, // Size of each chunk in world units (1 unit = 1 meter)
        segments: 32, // Reduced from 64 to 32 to improve performance on large grids
        loadDistance: 1200, // Distance to keep chunks loaded in memory (approx 450 chunks)
        unloadDistance: 1500, // Hysteresis threshold: Chunks beyond this distance are completely destroyed
    },

    // Mapzen Real-World Data Configuration
    mapzen: {
        zoom: 14, // Zoom 14: ~9.55m per pixel. Zoom 13: ~19m, Zoom 15: ~4.7m
        // Lat: 46.0, Lon: 7.749 (Zermatt, Matterhorn)
        originLat: 46.0,
        originLon: 7.749,
        seaLevel: 0.0,
    },

    // Foliage Placement and Visuals
    foliage: {
        modelPath: '/low_poly_trees_flowers_and_grass_gltf/scene.gltf',
        modelTargetName: 'tree-stylized-01_tree-branch-stylized-diffuse_0',

        forest: {
            densityThreshold: 0.2, // Lower = more trees
            minScale: 1.0,
            maxScale: 2.0,
        },
        plains: {
            densityThreshold: 0.85, // Higher = fewer trees
            minScale: 0.8,
            maxScale: 1.2,
        },

        uniformScaleModifier: 2.0,
        matrixStep: 4, // Calculate trees for every 4th vertex
    }
};
