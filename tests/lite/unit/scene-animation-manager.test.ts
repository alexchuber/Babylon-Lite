import { expect, it } from "vitest";
import { createNullEngine, stepScene } from "../../../packages/babylon-lite/src/engine/null-engine";
import { createSceneContext, disposeScene } from "../../../packages/babylon-lite/src/scene/scene-core";
import { addAnimationTask, createAnimationManager, createAnimationTask, updateAnimationManager } from "../../../packages/babylon-lite/src/animation/animation-manager";
import { bindAnimationManagerToScene } from "../../../packages/babylon-lite/src/animation/scene-animation-manager";
import { setSceneAnimationsEnabled } from "../../../packages/babylon-lite/src/animation/scene-animation";

it("gates only an explicitly scene-bound animation manager and releases ownership on disposal", () => {
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const manager = createAnimationManager();
    let elapsed = 0;
    addAnimationTask(
        manager,
        createAnimationTask((_manager, delta) => {
            elapsed += delta;
        })
    );
    const detach = bindAnimationManagerToScene(scene, manager);
    stepScene(engine, scene, 10);
    setSceneAnimationsEnabled(scene, false);
    stepScene(engine, scene, 1000);
    expect(elapsed).toBe(10);
    setSceneAnimationsEnabled(scene, true);
    stepScene(engine, scene, 10);
    expect(elapsed).toBe(20);
    disposeScene(scene);
    detach();
    updateAnimationManager(manager, 10);
    expect(elapsed).toBe(30);
});
