import type { SceneContext } from "./scene-core.js";
import { sceneDisposeOverride, setSceneDisposeOverride } from "./scene-lifecycle.js";

type SceneDisposeOverride = (scene: SceneContext, cleanup: () => void) => void;

let handlers: SceneDisposeOverride[] | undefined;
let previous: SceneDisposeOverride | null = null;

function dispatch(scene: SceneContext, cleanup: () => void): void {
    const snapshot = [...(handlers ?? [])];
    let index = snapshot.length;
    const next = (): void => {
        const handler = snapshot[--index];
        if (handler) {
            handler(scene, next);
        } else if (previous) {
            previous(scene, cleanup);
        } else {
            cleanup();
        }
    };
    next();
}

/** @internal Compose one optional terminal boundary without overwriting other owners. */
export function registerSceneDisposeOverride(callback: SceneDisposeOverride): () => void {
    const registered = (handlers ??= []);
    if (!registered.length) {
        previous = sceneDisposeOverride;
        setSceneDisposeOverride(dispatch);
    }
    registered.push(callback);
    let active = true;
    return () => {
        if (!active) {
            return;
        }
        active = false;
        const index = registered.indexOf(callback);
        if (index !== -1) {
            registered.splice(index, 1);
        }
        if (!registered.length) {
            handlers = undefined;
            setSceneDisposeOverride(previous);
            previous = null;
        }
    };
}
