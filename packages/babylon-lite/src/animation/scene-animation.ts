import type { SceneContext } from "../scene/scene-core.js";
import { setSceneAnimationOverride } from "../scene/scene-lifecycle.js";

// The stable clock collection identifies its scene without escaping the scene object through the optional feed.
let states: WeakMap<SceneContext["_beforeRender"], boolean> | undefined;

/** Whether scene-owned animation clocks advance. Scenes are enabled by default. */
export function getSceneAnimationsEnabled(scene: SceneContext): boolean {
    return states?.get(scene._beforeRender) !== false;
}

function skipAutomaticAnimation(callbacks: SceneContext["_beforeRender"]): boolean {
    return states?.get(callbacks) === false;
}

/** Freeze automatic scene animation without changing individual playback intent or elapsed time. */
export function setSceneAnimationsEnabled(scene: SceneContext, enabled: boolean): void {
    if (scene._z) {
        throw new Error("Cannot change animation state on a disposed scene.");
    }
    (states ??= new WeakMap()).set(scene._beforeRender, enabled);
    setSceneAnimationOverride(skipAutomaticAnimation);
}
