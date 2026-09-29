import { expect, it, vi } from "vitest";
import { createNullEngine, stepScene } from "../../../packages/babylon-lite/src/engine/null-engine";
import { createSceneContext, disposeScene } from "../../../packages/babylon-lite/src/scene/scene-core";
import {
    addAnimationTask,
    createAnimationManager,
    createAnimationTask,
    startAnimationManager,
    stopAnimationManager,
    updateAnimationManager,
} from "../../../packages/babylon-lite/src/animation/animation-manager";
import { bindAnimationManagerToScene } from "../../../packages/babylon-lite/src/animation/scene-animation-manager";
import { setSceneAnimationsEnabled } from "../../../packages/babylon-lite/src/animation/scene-animation";

it("detaches after an earlier scene disposer throws and preserves that error", () => {
    const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
    const manager = createAnimationManager();
    const cleanupError = new Error("Application cleanup failed");
    scene._disposables.push(() => {
        expect(manager._startGuard).toBeDefined();
        throw cleanupError;
    });
    const detach = bindAnimationManagerToScene(scene, manager);

    let failure: unknown;
    try {
        disposeScene(scene);
    } catch (error) {
        failure = error;
    }

    expect(failure).toBe(cleanupError);
    expect(manager._startGuard).toBeUndefined();

    vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn(() => 1)
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    try {
        startAnimationManager(manager);
        expect(manager.running).toBe(true);
        stopAnimationManager(manager);
    } finally {
        vi.unstubAllGlobals();
        detach();
    }
});

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
