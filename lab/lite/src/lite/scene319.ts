// Scene 319 — Babylon.js visualization test "GLTF Serializer Morph Target Animation Group" (playground #T087A8#29).
// alien.glb is loaded into a scene with a free camera and a hemispheric light, exported to GLB, the scene is disposed,
// and the GLB is loaded into a new scene (the one rendered) that gets an arc-rotate camera and a hemispheric light.
// The reloaded materials are made identical copies of the first one and the morph animation group is paused at 5 s.
//
// Babylon Lite scenes are always left-handed (the glTF loader adds a conversion root), so the source scene is not right-handed
// as in the snippet; that only changes what the first export reads, the reloaded content is the same.
// FlyCamera has no Lite equivalent; a free camera at the same position and target is used (it only exists in the exported source scene).

import {
    addToScene,
    attachControl,
    attachFreeControl,
    createArcRotateCamera,
    createEngine,
    createFreeCamera,
    createHemisphericLight,
    createSceneContext,
    disposeScene,
    exportSceneAsGlb,
    goToFrame,
    loadGltf,
    pauseAnimation,
    registerScene,
    startEngine,
} from "babylon-lite";

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const engine = await createEngine(canvas);

    const source = createSceneContext(engine);
    const flyCamera = createFreeCamera({ x: 0, y: 1, z: 5 }, { x: 0, y: 0, z: 0 });
    flyCamera.speed = 0.5;
    source.camera = flyCamera;
    attachFreeControl(flyCamera, canvas, source);
    addToScene(source, createHemisphericLight([0, 1, 0], 0.7));
    addToScene(source, await loadGltf(engine, "https://models.babylonjs.com/alien.glb"));

    const glb = await exportSceneAsGlb(source);
    disposeScene(source);

    const scene = createSceneContext(engine);
    const container = await loadGltf(engine, glb);
    addToScene(scene, container);

    const camera = createArcRotateCamera(Math.PI / 2, Math.PI / 2, 1.5, { x: 0, y: -0.2, z: 0 });
    scene.camera = camera;
    attachControl(camera, canvas, scene);
    addToScene(scene, createHemisphericLight([0, 1, 0], 0.7));

    // mat0 = materials[0]; mat1..mat3 = mat0.clone(...), assigned by mesh name. The clones are identical copies, so the
    // Lite page shares mat0 across the named meshes instead of cloning it (every named mesh ends up with mat0's appearance).
    const meshByName = new Map(scene.meshes.map((m) => [m.name, m]));
    const mat0 = meshByName.get("AlienHead")!.material;
    for (const name of ["AlienHead", "Collar", "CollarClasp", "Shirt", "ShirtPlate", "Teeth", "LeftEye", "RightEye"]) {
        meshByName.get(name)!.material = mat0;
    }

    // goToFrame(5 * framePerSecond), then pause: seek the morph animation group to 5 s.
    const group = scene.animationGroups[0]!;
    goToFrame(group, 5 * (group.frameRate ?? 60), engine);
    pauseAnimation(group);

    // Fixed timestep matching Babylon.js useConstantAnimationDeltaTime (16.0ms)
    scene.fixedDeltaMs = 16.0;

    await registerScene(scene);
    await startEngine(engine);
    canvas.dataset.drawCalls = String(engine.drawCallCount);
    canvas.dataset.initMs = String(performance.now() - __initStart);
    canvas.dataset.ready = "true";
}

main().catch((error: unknown) => {
    console.error(error);
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    if (canvas) {
        canvas.dataset.error = error instanceof Error ? error.message : String(error);
    }
});
