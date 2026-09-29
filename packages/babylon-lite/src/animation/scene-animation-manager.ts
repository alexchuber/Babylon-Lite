import type { SceneContext } from "../scene/scene-core.js";
import { registerSceneDisposeOverride } from "../scene/scene-dispose-registration.js";
import { updateAnimationManager } from "./animation-manager.js";
import type { AnimationManager } from "./animation-manager.js";
import { getSceneAnimationsEnabled } from "./scene-animation.js";

let bindings: WeakMap<AnimationManager, { scene: SceneContext; detach: () => void }> | undefined;
let sceneBindings: WeakMap<SceneContext, Set<() => void>> | undefined;
let activeBindings = 0;
let unregisterDispose: (() => void) | undefined;

function disposeBoundManagers(scene: SceneContext, cleanup: () => void): void {
    const errors: unknown[] = [];
    try {
        cleanup();
    } catch (error) {
        errors.push(error);
    }
    for (const detach of [...(sceneBindings?.get(scene) ?? [])]) {
        try {
            detach();
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length) {
        throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Scene and animation cleanup failed.");
    }
}

function registerSceneBinding(scene: SceneContext, detach: () => void): void {
    if (activeBindings++ === 0) {
        unregisterDispose = registerSceneDisposeOverride(disposeBoundManagers);
    }
    const registered = (sceneBindings ??= new WeakMap());
    let callbacks = registered.get(scene);
    if (!callbacks) {
        callbacks = new Set();
        registered.set(scene, callbacks);
    }
    callbacks.add(detach);
}

/** Drive a stopped manager from the scene clock, honoring `animationsEnabled`.
 * The returned disposer detaches it without changing tasks or playback intent.
 * A bound manager cannot simultaneously run its autonomous clock. */
export function bindAnimationManagerToScene(scene: SceneContext, manager: AnimationManager): () => void {
    if (scene._z || manager.running) {
        throw new Error("Scene animation binding requires a live scene and a stopped manager.");
    }
    const previousBinding = bindings?.get(manager);
    if (previousBinding) {
        if (previousBinding.scene !== scene) {
            throw new Error("Animation manager already belongs to another scene clock.");
        }
        return previousBinding.detach;
    }
    const tick = (delta: number): void => {
        if (getSceneAnimationsEnabled(scene)) {
            updateAnimationManager(manager, delta);
        }
    };
    const previousGuard = manager._startGuard;
    const guard = (): never => {
        throw new Error("Detach the animation manager from its scene before starting an autonomous clock.");
    };
    manager._startGuard = guard;
    let detached = false;
    const detach = (): void => {
        if (detached) {
            return;
        }
        detached = true;
        bindings?.delete(manager);
        if (manager._startGuard === guard) {
            manager._startGuard = previousGuard;
        }
        const tickIndex = scene._beforeRender.indexOf(tick);
        if (tickIndex !== -1) {
            scene._beforeRender.splice(tickIndex, 1);
        }
        const callbacks = sceneBindings?.get(scene);
        callbacks?.delete(detach);
        if (callbacks?.size === 0) {
            sceneBindings?.delete(scene);
        }
        if (--activeBindings === 0) {
            unregisterDispose?.();
            unregisterDispose = undefined;
        }
    };
    (bindings ??= new WeakMap()).set(manager, { scene, detach });
    scene._beforeRender.push(tick);
    registerSceneBinding(scene, detach);
    return detach;
}
