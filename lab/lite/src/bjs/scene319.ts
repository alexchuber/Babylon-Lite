// Scene 319 — BJS reference for the glTF export visualization test "GLTF Serializer Morph Target Animation Group".
// Mirrors playground #T087A8#29: a right-handed scene holding alien.glb is exported to GLB, the scene is disposed,
// the GLB is reloaded as a new scene, materials are cloned onto the sub-meshes, and the morph animation group is
// paused at 5 s. Reference image: gltfSerializerMorphTargetAnimationGroup.png.
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { FlyCamera } from "@babylonjs/core/Cameras/flyCamera";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/core/Loading/loadingScreen";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import "@babylonjs/loaders/glTF";
import { GLTF2Export } from "@babylonjs/serializers/glTF/2.0";

// The harness installs a seeded Math.random before running the snippet.
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
    engine.displayLoadingUI = function () {};
    SceneLoader.ShowLoadingScreen = false;

    const createScene = async function () {
        // This creates a basic Babylon Scene object (non-mesh)
        let scene = new Scene(engine);
        // (the snippet's `downloadFile = false` only gates a download of the exported files)
        scene.useRightHandedSystem = true;

        // This creates and positions a free camera (non-mesh)
        let camera = new FlyCamera("camera1", new Vector3(0, 1, 5), scene);
        camera.speed = 0.5;

        // This targets the camera to scene origin
        camera.setTarget(Vector3.Zero());

        // This attaches the camera to the canvas
        camera.attachControl(true); // FlyCamera.attachControl takes only noPreventDefault in this version

        // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
        let light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);

        // Default intensity is 1. Let's dim the light a small amount
        light.intensity = 0.7;

        const container = await SceneLoader.LoadAssetContainerAsync("https://models.babylonjs.com/", "alien.glb", scene);
        container.addAllToScene();

        const glTFFiles = (await GLTF2Export.GLBAsync(scene, "alien2")).glTFFiles;
        scene.dispose();
        const file = new File([glTFFiles["alien2.glb"]!], "alien2.glb");
        const outScene = await SceneLoader.LoadAsync("file:", file, engine);

        const outCamera = new ArcRotateCamera("camera1", Math.PI / 2, Math.PI / 2, 1.5, new Vector3(0, -0.2, 0), outScene);
        outCamera.attachControl(canvas, true);
        const outLight = new HemisphericLight("light", new Vector3(0, 1, 0), outScene);
        outLight.intensity = 0.7;

        const mat0 = outScene.materials[0]!;
        const mat1 = mat0.clone("mat1")!;
        const mat2 = mat0.clone("mat2")!;
        const mat3 = mat0.clone("mat3")!;
        const assign = (names: string[], mat: typeof mat0) => {
            for (const name of names) {
                outScene.getMeshByName(name)!.material = mat;
            }
        };
        assign(["AlienHead"], mat0);
        assign(["Collar", "CollarClasp", "Shirt", "ShirtPlate", "Teeth"], mat1);
        assign(["LeftEye"], mat2);
        assign(["RightEye"], mat3);

        const group = outScene.animationGroups[0]!;
        group.goToFrame(5 * group.targetedAnimations[0]!.animation.framePerSecond);
        group.pause();

        return outScene;
    };

    const scene = await createScene();
    scene.useConstantAnimationDeltaTime = true;
    await scene.whenReadyAsync();
    engine.runRenderLoop(() => scene.render());
    window.addEventListener("resize", () => engine.resize());
    await new Promise<void>((resolve) => scene.onAfterRenderObservable.addOnce(() => resolve()));
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
})().catch((error: unknown) => {
    console.error(error);
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    if (canvas) {
        canvas.dataset.error = error instanceof Error ? error.message : String(error);
    }
});
