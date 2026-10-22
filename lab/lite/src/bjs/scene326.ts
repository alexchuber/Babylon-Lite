// Scene 326 — BJS reference for the glTF export "multimaterial with raw texture" test.
// Mirrors playground #KU72PX#0 (Babylon.js visualization test "GLTF Serializer multimaterial with raw texture"):
// a double-sided tiled plane split into two sub-meshes with two raw-texture PBR materials, exported with GLTF2Export,
// reloaded with LoadSceneAsync and rendered through the imported camera.
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Light } from "@babylonjs/core/Lights/light";
import { LoadSceneAsync, SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/core/Loading/loadingScreen";
// WebGPU engine extensions used by RawTexture and by the serializer's texture read-back.
import "@babylonjs/core/Engines/WebGPU/Extensions";
// Vertex shader of the serializer's texture-encoding effect (DumpTools / EncodeImageAsync).
import "@babylonjs/core/Shaders/postprocess.vertex";
import { MultiMaterial } from "@babylonjs/core/Materials/multiMaterial";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import "@babylonjs/core/Meshes/Builders/tiledPlaneBuilder";
import { SubMesh } from "@babylonjs/core/Meshes/subMesh";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/core/Helpers/sceneHelpers";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0";
import "@babylonjs/loaders/glTF";

// Babylon.js visualization harness: seeded Math.random.
let seed = 1;
Math.random = () => {
    const x = Math.sin(seed++) * 10000;
    return x - Math.floor(x);
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

    let scene = new Scene(engine);

    const plane = MeshBuilder.CreateTiledPlane("plane", { tileSize: 1, width: 1, height: 2, sideOrientation: Mesh.DOUBLESIDE }, scene);
    plane.scaling.x = 2;

    const verticesCount = plane.getTotalVertices();
    const totalFaces = verticesCount / 3;
    const halfFaces = Math.floor(totalFaces / 2);
    new SubMesh(0, 0, verticesCount, 0, halfFaces * 3, plane);
    new SubMesh(1, 0, verticesCount, halfFaces * 3, (totalFaces - halfFaces) * 3, plane);

    const multiMat = new MultiMaterial("multi", scene);

    const pbr1 = new PBRMaterial("pbr1", scene);
    const rawTexture1 = new RawTexture(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]), 2, 1, Engine.TEXTUREFORMAT_RGBA, scene, false, false, Texture.NEAREST_NEAREST_MIPNEAREST);
    pbr1.albedoTexture = rawTexture1;
    pbr1.metallic = 0.0;
    pbr1.roughness = 1.0;

    const pbr2 = new PBRMaterial("pbr2", scene);
    const rawTexture2 = new RawTexture(
        new Uint8Array([0, 0, 255, 255, 255, 255, 0, 255]),
        2,
        1,
        Engine.TEXTUREFORMAT_RGBA,
        scene,
        false,
        false,
        Texture.NEAREST_NEAREST_MIPNEAREST
    );
    pbr2.albedoTexture = rawTexture2;
    pbr2.metallic = 0.0;
    pbr2.roughness = 1.0;

    multiMat.subMaterials.push(pbr1, pbr2);
    plane.material = multiMat;

    scene.createDefaultCamera(true, true, true);

    const light = new DirectionalLight("light", Vector3.Forward(), scene);
    light.falloffType = Light.FALLOFF_GLTF;

    const glbData = await GLTF2Export.GLBAsync(scene, "scene");
    const arrayBuffer = await (glbData.files["scene.glb"] as Blob).arrayBuffer();
    scene.dispose();
    scene = await LoadSceneAsync(new Uint8Array(arrayBuffer), engine, { pluginExtension: ".glb" });
    scene.activeCamera = scene.cameras[0]!;
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
