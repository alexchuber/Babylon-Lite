import type { SceneContext } from "./scene-core.js";

/** @internal Opaque optional feeds. Unused installers let bundlers erase every call. */
export let sceneNodeChanged: ((scene: SceneContext, node: unknown, added: boolean) => void) | null = null;
/** @internal Return true when an installed consumer handles automatic advancement. */
export let sceneAnimationOverride: ((callbacks: SceneContext["_beforeRender"]) => boolean) | null = null;
/** @internal Optional terminal boundary; the installed owner must invoke the canonical cleanup. */
export let sceneDisposeOverride: ((scene: SceneContext, cleanup: () => void) => void) | null = null;

/** @internal */
export function setSceneDisposeOverride(callback: typeof sceneDisposeOverride): void {
    sceneDisposeOverride = callback;
}

/** @internal */
export function setSceneNodeChanged(callback: typeof sceneNodeChanged): void {
    sceneNodeChanged = callback;
}

/** @internal */
export function setSceneAnimationOverride(callback: typeof sceneAnimationOverride): void {
    sceneAnimationOverride = callback;
}
