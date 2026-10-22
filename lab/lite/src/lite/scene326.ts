// Scene 326: glTF export of a two-sub-mesh tiled plane with raw-texture PBR materials,
// reloaded and rendered through the imported camera — matches Babylon.js playground #KU72PX#0
// (visualization test "GLTF Serializer multimaterial with raw texture").
//
// Lite has no CreateTiledPlane, SubMesh or MultiMaterial. The tiled plane's exact vertex data
// (width 1, height 2, tileSize 1, DOUBLESIDE: 16 vertices, 24 indices) is written out below and each
// Babylon.js sub-mesh becomes a sibling mesh with its own draw range (setMeshDrawRange), all children of
// one "plane" transform node (scaling.x = 2). The snippet's three sub-meshes are kept as they are: the
// automatic whole-mesh sub-mesh (material 0), and `new SubMesh(0, …, 0, 6)` and `new SubMesh(1, …, 6, 10)`.

import {
    addToScene,
    createDefaultCamera,
    createDirectionalLight,
    createEngine,
    createMeshFromData,
    createPbrMaterial,
    createSceneContext,
    createTexture2DFromPixels,
    createTransformNode,
    disposeScene,
    enableGltfCameras,
    exportSceneAsGlb,
    loadGltf,
    registerScene,
    setMeshDrawRange,
    startEngine,
} from "babylon-lite";

const POSITIONS = new Float32Array([
    -0.5, -1, 0, 0.5, -1, 0, 0.5, 0, 0, -0.5, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0, -0.5, -1, 0, 0.5, -1, 0, 0.5, 0, 0, -0.5, 0, 0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0,
    -0.5, 1, 0,
]);
const NORMALS = new Float32Array([
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
]);
const UVS = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1]);
const INDICES = new Uint32Array([0, 1, 3, 1, 2, 3, 4, 5, 7, 5, 6, 7, 11, 9, 8, 11, 10, 9, 15, 13, 12, 15, 14, 13]);
const VERTEX_COUNT = 16;

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);
    enableGltfCameras();

    let scene = createSceneContext(engine);

    // verticesCount / 3 "faces", exactly as the snippet computes them (16 / 3 = 5.33…).
    const totalFaces = VERTEX_COUNT / 3;
    const halfFaces = Math.floor(totalFaces / 2);

    const plane = createTransformNode("plane");
    plane.scaling.x = 2;

    const pbr1 = createPbrMaterial({
        baseColorTexture: createTexture2DFromPixels(engine, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1, { srgb: true }),
        metallicFactor: 0,
        roughnessFactor: 1,
    });
    pbr1.name = "pbr1";
    const pbr2 = createPbrMaterial({
        baseColorTexture: createTexture2DFromPixels(engine, new Uint8Array([0, 0, 255, 255, 255, 255, 0, 255]), 2, 1, { srgb: true }),
        metallicFactor: 0,
        roughnessFactor: 1,
    });
    pbr2.name = "pbr2";

    // Sub-mesh 0 (created by Babylon.js with the mesh): all 24 indices, material 0.
    // `new SubMesh(0, 0, 16, 0, halfFaces * 3)` and `new SubMesh(1, 0, 16, halfFaces * 3, (totalFaces - halfFaces) * 3)`.
    const subMeshes = [
        { material: pbr1, firstIndex: 0, indexCount: INDICES.length },
        { material: pbr1, firstIndex: 0, indexCount: halfFaces * 3 },
        { material: pbr2, firstIndex: halfFaces * 3, indexCount: (totalFaces - halfFaces) * 3 },
    ];
    for (const sub of subMeshes) {
        const mesh = createMeshFromData(engine, "plane", POSITIONS, NORMALS, INDICES, UVS);
        mesh.material = sub.material;
        if (sub.indexCount !== INDICES.length) {
            setMeshDrawRange(engine, mesh, { vertices: { offset: 0, count: VERTEX_COUNT }, indices: { offset: sub.firstIndex, count: sub.indexCount } });
        }
        mesh.parent = plane;
        plane.children.push(mesh);
    }
    addToScene(scene, plane);

    createDefaultCamera(scene);

    // Directional light along +Z; Lite lights have no falloffType (FALLOFF_GLTF has no effect on a directional light).
    addToScene(scene, createDirectionalLight([0, 0, 1]));

    const glb = await exportSceneAsGlb(scene);
    disposeScene(scene);

    scene = createSceneContext(engine);
    scene.clearColor = { r: 0.2, g: 0.2, b: 0.3, a: 1 };
    const container = await loadGltf(engine, glb);
    addToScene(scene, container);
    scene.camera = container.cameras![0]!;

    await registerScene(scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
