import type { SceneContext } from "../scene/scene-core.js";
import { updateAnimationManager } from "./animation-manager.js";
import type { AnimationManager } from "./animation-manager.js";
import { getSceneAnimationsEnabled } from "./scene-animation.js";

let bindings: WeakMap<AnimationManager, { scene: SceneContext; detach: () => void }> | undefined;

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
        const disposeIndex = scene._disposables.indexOf(detach);
        if (disposeIndex !== -1) {
            scene._disposables.splice(disposeIndex, 1);
        }
    };
    (bindings ??= new WeakMap()).set(manager, { scene, detach });
    scene._beforeRender.push(tick);
    scene._disposables.push(detach);
    return detach;
}
