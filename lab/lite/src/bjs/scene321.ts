// Scene 321 — BJS reference for the glTF export "KHR_materials_clearcoat" test.
// Mirrors playground #9N6CLU#23 (Babylon.js visualization test "GLTF Serializer KHR materials clearcoat"):
// Khronos ClearCoatTest plus a seventh row with a combined intensity/roughness clearcoat texture, exported with
// GLTF2Export, reloaded with SceneLoader and rendered under a DDS skybox.
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { Constants } from "@babylonjs/core/Engines/constants";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { LoadAssetContainerAsync, SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/core/Loading/loadingScreen";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { CubeTexture } from "@babylonjs/core/Materials/Textures/cubeTexture";
import "@babylonjs/core/Materials/Textures/Loaders/ddsTextureLoader";
import "@babylonjs/core/Materials/Textures/baseTexture.polynomial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ApplyPostProcess } from "@babylonjs/core/Misc/textureTools";
import { DumpDataAsync } from "@babylonjs/core/Misc/dumpTools";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/core/ShadersWGSL/pass.fragment";
import "@babylonjs/core/ShadersWGSL/postprocess.vertex";
// The serializer encodes textures with a WebGL "pass" effect (DumpTools) that needs the default post-process vertex shader registered.
import "@babylonjs/core/Shaders/postprocess.vertex";
import "@babylonjs/core/Shaders/pass.fragment";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0";
import "@babylonjs/loaders/glTF";
import type { Nullable } from "@babylonjs/core/types";

// Babylon.js visualization harness: seeded Math.random (installed after the engine exists, right before the snippet runs).
let seed = 1;
const installSeededRandom = () => {
    seed = 1;
    Math.random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    };
};

(async function () {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const params = new URLSearchParams(location.search);
    const antialias = params.get("antialias") !== "0";
    const engine = new WebGPUEngine(canvas, { antialias, adaptToDeviceRatio: true });
    await engine.initAsync();
    SceneLoader.ShowLoadingScreen = false;
    engine.displayLoadingUI = () => {};

    installSeededRandom();

    async function createBase64FromCanvasAsync(buffer: Uint8Array, width: number, height: number, mimeType: string, scene: Scene): Promise<string> {
        const tempTexture = engine.createRawTexture(
            buffer,
            width,
            height,
            Constants.TEXTUREFORMAT_RGBA,
            false,
            true,
            Texture.NEAREST_SAMPLINGMODE,
            null,
            Constants.TEXTURETYPE_UNSIGNED_BYTE
        );
        const tex = await ApplyPostProcess("pass", tempTexture, scene, Constants.TEXTURETYPE_UNSIGNED_BYTE, Texture.NEAREST_SAMPLINGMODE, Constants.TEXTUREFORMAT_RGBA);
        const data = await engine._readTexturePixels(tex, width, height);
        return (await DumpDataAsync(width, height, data as Uint8Array, mimeType, undefined, true, false)) as string;
    }

    async function combineRoughnessIntensityTextures(intensityTexture: Texture, roughnessTexture: Texture, scene: Scene): Promise<Texture> {
        const size = intensityTexture.getSize();
        const intensityPixels = (await intensityTexture.readPixels()) as Uint8Array;
        const roughnessPixels = (await roughnessTexture.readPixels()) as Uint8Array;
        const combined = new Uint8Array(intensityPixels.length);
        for (let i = 0; i < combined.length; i += 4) {
            combined[i] = intensityPixels[i]!;
            combined[i + 1] = roughnessPixels[i + 1]!;
            combined[i + 2] = 0;
            combined[i + 3] = 255;
        }
        const base64 = await createBase64FromCanvasAsync(combined, size.width, size.height, "image/png", scene);
        return new Texture(base64, scene);
    }

    let scene = new Scene(engine);
    const cameraLocation = new Vector3(2, -1, 20);
    const cameraTarget = new Vector3(cameraLocation.x, cameraLocation.y, 0);
    const camera = new UniversalCamera("camera1", cameraLocation.clone(), scene);
    camera.speed = 0.5;
    camera.setTarget(cameraTarget.clone());
    camera.attachControl(canvas, true);

    new HemisphericLight("light", new Vector3(0, 1, 0), scene);

    const envTexture = new CubeTexture("https://playground.babylonjs.com/textures/environment.dds", scene);
    scene.createDefaultSkybox(envTexture, true, 1000);

    const container = await LoadAssetContainerAsync("https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Models@master/2.0/ClearCoatTest/glTF-Binary/ClearCoatTest.glb", scene);
    container.addAllToScene();

    const roughnessNode = scene.getNodeByName("R2_RoughnessVariations") as TransformNode;
    const combinedNode = roughnessNode.clone(undefined as unknown as string, null) as TransformNode;
    combinedNode.name = "R6_CombinedIntensityRoughnessTextures";
    combinedNode.position.y = -7.35;
    combinedNode.scaling.x = -1;

    const roughnessMat = scene.getMaterialByName("RoughVariations_Coated") as PBRMaterial;
    const intensityMat = scene.getMaterialByName("Partial_Coated") as PBRMaterial;
    const roughnessTexture = roughnessMat.clearCoat.textureRoughness as Texture;
    const intensityTexture = intensityMat.clearCoat.texture as Texture;
    const combined = await combineRoughnessIntensityTextures(intensityTexture, roughnessTexture, scene);
    combined.name = "CombinedRoughnessIntensity_Coated";

    const newMat = roughnessMat.clone("SharedIntensityRoughness_Coated");
    newMat.clearCoat.isEnabled = true;
    newMat.clearCoat.texture = combined;
    newMat.clearCoat.textureRoughness = null as Nullable<Texture> as never;
    newMat.clearCoat.useRoughnessFromMainTexture = true;

    const baseLayer = scene.getMeshByName("undefined.R2_BaseLayerSample") as Mesh;
    baseLayer.material = baseLayer.material!.clone("SharedIntensityRoughness_Base");
    const clearCoatSample = scene.getMeshByName("undefined.R2_ClearCoatSample") as Mesh;
    clearCoatSample.material = newMat;
    const coatOnly = scene.getMeshByName("undefined.R2_CoatOnlySample") as Mesh;
    const coatingMat = coatOnly.material!.clone("SharedIntensityRoughness_Coating") as PBRMaterial;
    coatingMat.albedoTexture = (scene.getMaterialByName("Partial_Coating") as PBRMaterial).albedoTexture;
    coatingMat.useAlphaFromAlbedoTexture = true;
    coatingMat.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
    coatOnly.material = coatingMat;

    const glbData = await GLTF2Export.GLBAsync(scene, "KHR_materials_clearcoat_test2");
    scene.dispose();
    const file = new File([glbData.glTFFiles["KHR_materials_clearcoat_test2.glb"]!], "KHR_materials_clearcoat_test2.glb");

    scene = await SceneLoader.LoadAsync("file:", file, engine);
    const outCamera = new UniversalCamera("camera1", cameraLocation.clone(), scene);
    outCamera.speed = 0.5;
    outCamera.setTarget(cameraTarget.clone());
    outCamera.attachControl(canvas, true);
    const outLight = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
    outLight.intensity = 0.7;
    const outEnvTexture = new CubeTexture("https://playground.babylonjs.com/textures/environment.dds", scene);
    scene.createDefaultSkybox(outEnvTexture, true, 1000);
    scene.useConstantAnimationDeltaTime = true;

    await scene.whenReadyAsync();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(() => resolve()));
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
})().catch((err) => {
    console.error(err);
});
