// Scene 321: glTF export of the Khronos ClearCoatTest plus a combined intensity/roughness clearcoat row, reloaded under a
// DDS skybox — matches Babylon.js playground #9N6CLU#23 (visualization test "GLTF Serializer KHR materials clearcoat").
//
// Deviations from the snippet (Lite has no public equivalent):
// - `combineRoughnessIntensityTextures` reads the pixels of two loaded textures. Lite has no public readback of a loaded
//   `Texture2D` (the GPU handle is the only access), so the two source images are decoded from the same GLB the scene was
//   loaded from (`createImageBitmap`) and the combined texture is built with `createTexture2DFromPixels`. Like the snippet,
//   the combined texture takes the intensity texture's size (256x256) and reads the roughness data by linear pixel index.
// - `material.clone(name)` has no Lite counterpart; materials are plain data, so a clone is a shallow copy with its own
//   clearcoat object.
// - `createDefaultSkybox(envTexture, true, 1000)` becomes a 1000-unit box with a PBR skybox material (`setPbrSkybox`) over
//   the DDS environment (`loadDdsEnvironment`), as scene 26 does. The pre-export box keeps the material the Babylon.js
//   skybox exports with (white, metallic 1, roughness 0, double sided) and sits at the origin, so the exported scene holds
//   the same mirror box; the box in the reloaded scene is centred on the (static) camera.
// - The pre-export scene skips the DDS environment: nothing is rendered before the export and the exporter ignores IBL.
// - Lite does not export the Babylon.js `useRoughnessFromMainTexture` flag; the combined texture is set as both the clearcoat
//   intensity and the clearcoat roughness texture, which is what the glTF file contains.

import {
    addToScene,
    cloneTransformNode,
    createBox,
    createEngine,
    createFreeCamera,
    createHemisphericLight,
    createPbrMaterial,
    createSceneContext,
    createTexture2DFromPixels,
    disposeScene,
    exportSceneAsGlb,
    getPbrClearCoat,
    loadDdsEnvironment,
    loadGltf,
    registerScene,
    setPbrClearCoat,
    setPbrSkybox,
    startEngine,
} from "babylon-lite";
import type { EngineContext, Mesh, PbrMaterialProps, SceneContext, SceneNode, Texture2D } from "babylon-lite";

const CLEARCOAT_TEST_URL = "https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/ClearCoatTest/glTF-Binary/ClearCoatTest.glb";
const ENVIRONMENT_URL = "https://playground.babylonjs.com/textures/environment.dds";
const CAMERA_LOCATION = { x: 2, y: -1, z: 20 };
const CAMERA_TARGET = { x: CAMERA_LOCATION.x, y: CAMERA_LOCATION.y, z: 0 };

function findNode(root: SceneNode, name: string): SceneNode | undefined {
    if (root.name === name) {
        return root;
    }
    for (const child of root.children) {
        const found = findNode(child, name);
        if (found) {
            return found;
        }
    }
    return undefined;
}

function collectMeshes(node: SceneNode, meshes: Mesh[] = []): Mesh[] {
    if ("material" in node) {
        meshes.push(node as Mesh);
    }
    for (const child of node.children) {
        collectMeshes(child, meshes);
    }
    return meshes;
}

function findMaterial(root: SceneNode, name: string): PbrMaterialProps {
    const mesh = collectMeshes(root).find((m) => m.material.name === name);
    if (!mesh) {
        throw new Error(`Material "${name}" not found`);
    }
    return mesh.material as PbrMaterialProps;
}

/** Babylon.js `material.clone(name)`: a copy that owns its clearcoat settings. */
function clonePbrMaterial(material: PbrMaterialProps, name: string): PbrMaterialProps {
    const clone: PbrMaterialProps = { ...material, name };
    const clearCoat = getPbrClearCoat(material);
    if (clearCoat) {
        setPbrClearCoat(clone, { ...clearCoat });
    }
    return clone;
}

/** Decodes the PNG/JPEG image a glTF material texture points at, straight from the GLB bytes. */
async function decodeGlbImage(glb: ArrayBuffer, materialName: string, slot: "clearcoatTexture" | "clearcoatRoughnessTexture"): Promise<ImageData> {
    const view = new DataView(glb);
    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength)));
    const binOffset = 20 + jsonLength + 8;
    const material = json.materials.find((m: { name?: string }) => m.name === materialName);
    const image = json.images[json.textures[material.extensions.KHR_materials_clearcoat[slot].index].source];
    const bufferView = json.bufferViews[image.bufferView];
    const bytes = new Uint8Array(glb, binOffset + (bufferView.byteOffset ?? 0), bufferView.byteLength);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: image.mimeType }), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height);
}

/** The snippet's `combineRoughnessIntensityTextures`: R from the intensity texture, G from the roughness texture. */
async function combineRoughnessIntensityTextures(engine: EngineContext, glb: ArrayBuffer): Promise<Texture2D> {
    const intensity = await decodeGlbImage(glb, "Partial_Coated", "clearcoatTexture");
    const roughness = await decodeGlbImage(glb, "RoughVariations_Coated", "clearcoatRoughnessTexture");
    const combined = new Uint8Array(intensity.data.length);
    for (let i = 0; i < combined.length; i += 4) {
        combined[i] = intensity.data[i]!;
        combined[i + 1] = roughness.data[i + 1]!;
        combined[i + 2] = 0;
        combined[i + 3] = 255;
    }
    return createTexture2DFromPixels(engine, combined, intensity.width, intensity.height, {
        addressModeU: "repeat",
        addressModeV: "repeat",
        minFilter: "linear",
        magFilter: "linear",
    });
}

/** The snippet's camera, light, DDS environment and skybox. */
async function addEnvironment(scene: SceneContext, engine: EngineContext, lightIntensity: number, skyboxPosition: { x: number; y: number; z: number }): Promise<void> {
    const camera = createFreeCamera(CAMERA_LOCATION, CAMERA_TARGET);
    camera.nearPlane = 1;
    camera.farPlane = 10000;
    scene.camera = camera;
    addToScene(scene, createHemisphericLight([0, 1, 0], lightIntensity));
    await loadDdsEnvironment(scene, ENVIRONMENT_URL, { brdfUrl: "/brdf-lut.png" });
    addToScene(scene, createSkybox(engine, skyboxPosition));
}

function createSkybox(engine: EngineContext, position: { x: number; y: number; z: number }): Mesh {
    const skybox = createBox(engine, 1000);
    skybox.name = "hdrSkyBox";
    skybox.position.set(position.x, position.y, position.z);
    const material = createPbrMaterial({ baseColorFactor: [1, 1, 1, 1], metallicFactor: 1, roughnessFactor: 0, directIntensity: 0, doubleSided: true });
    material.name = "skyBox";
    setPbrSkybox(material);
    skybox.material = material;
    return skybox;
}

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);

    let scene = createSceneContext(engine);
    const camera = createFreeCamera(CAMERA_LOCATION, CAMERA_TARGET);
    camera.nearPlane = 1;
    camera.farPlane = 10000;
    scene.camera = camera;
    addToScene(scene, createHemisphericLight([0, 1, 0]));
    addToScene(scene, createSkybox(engine, { x: 0, y: 0, z: 0 }));

    const glbBytes = await (await fetch(CLEARCOAT_TEST_URL)).arrayBuffer();
    const container = await loadGltf(engine, glbBytes);
    addToScene(scene, container);
    const root = container.entities[0] as SceneNode;

    // Clone "R2_RoughnessVariations" into the seventh row.
    const combinedRow = cloneTransformNode(findNode(root, "R2_RoughnessVariations")!);
    combinedRow.name = "R6_CombinedIntensityRoughnessTextures";
    combinedRow.position.y = -7.35;
    combinedRow.scaling.x = -1;
    addToScene(scene, combinedRow);

    const roughnessMat = findMaterial(root, "RoughVariations_Coated");
    const combined = await combineRoughnessIntensityTextures(engine, glbBytes);

    const newMat = clonePbrMaterial(roughnessMat, "SharedIntensityRoughness_Coated");
    setPbrClearCoat(newMat, { ...getPbrClearCoat(newMat), isEnabled: true, texture: combined, roughnessTexture: combined });

    // Each sample node holds its mesh as a child ("undefined.R2_…Sample" is the mesh itself in Babylon.js).
    const sampleMesh = (name: string): Mesh => collectMeshes(findNode(combinedRow, `${name}_clone`)!)[0]!;
    const baseLayer = sampleMesh("R2_BaseLayerSample");
    baseLayer.material = clonePbrMaterial(baseLayer.material as PbrMaterialProps, "SharedIntensityRoughness_Base");
    sampleMesh("R2_ClearCoatSample").material = newMat;
    const coatOnly = sampleMesh("R2_CoatOnlySample");
    const coatingMat = clonePbrMaterial(coatOnly.material as PbrMaterialProps, "SharedIntensityRoughness_Coating");
    coatingMat.baseColorTexture = findMaterial(root, "Partial_Coating").baseColorTexture;
    coatingMat.alphaBlend = true;
    coatOnly.material = coatingMat;

    const glb = await exportSceneAsGlb(scene);
    disposeScene(scene);

    scene = createSceneContext(engine);
    await addEnvironment(scene, engine, 0.7, CAMERA_LOCATION);
    addToScene(scene, await loadGltf(engine, glb));

    await registerScene(scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch(console.error);
