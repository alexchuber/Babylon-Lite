import { describe, expect, it } from "vitest";
import { createNullEngine } from "../../../packages/babylon-lite/src/engine/null-engine";
import { addToScene, createSceneContext, disposeScene } from "../../../packages/babylon-lite/src/scene/scene-core";
import { createFreeCamera } from "../../../packages/babylon-lite/src/camera/free-camera";
import { createTransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import { setParent } from "../../../packages/babylon-lite/src/scene/set-parent";
import { createSceneAccessibility, getAccessibilityNode, setAccessibilityParent } from "../../../packages/babylon-lite/src/accessibility/scene-accessibility";

describe("camera membership boundaries", () => {
    it("preserves a shared ancestor but releases the replaced camera without traversing unrelated roots", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const parent = createTransformNode("Parent");
        const first = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
        const second = createFreeCamera({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 });
        first.parent = second.parent = parent;
        const unrelated = createTransformNode("Unrelated");
        scene.camera = first;
        const adapter = createSceneAccessibility(scene, { roots: [unrelated] });
        const parentNode = getAccessibilityNode(adapter, parent);
        let reads = 0;
        const children = unrelated.children;
        Object.defineProperty(unrelated, "children", {
            configurable: true,
            get: () => {
                reads++;
                return children;
            },
        });
        scene.camera = second;
        expect(getAccessibilityNode(adapter, first)).toBeUndefined();
        expect(getAccessibilityNode(adapter, second)).toBeDefined();
        expect(getAccessibilityNode(adapter, parent)).toBe(parentNode);
        expect(reads).toBe(0);
        disposeScene(scene);
    });

    it("preserves semantic overrides when the same source gains or loses camera-derived membership", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const camera = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
        const natural = createTransformNode("Natural");
        const semantic = createTransformNode("Semantic");
        const child = createTransformNode("Child");
        setParent(child, camera);
        camera.parent = natural;
        const adapter = createSceneAccessibility(scene, { roots: [camera, semantic] });
        setAccessibilityParent(adapter, child, semantic);
        const node = getAccessibilityNode(adapter, child)!;
        scene.camera = camera;
        expect(node.parent).toBe(getAccessibilityNode(adapter, semantic));
        addToScene(scene, camera);
        scene.camera = null;
        expect(node.parent).toBe(getAccessibilityNode(adapter, semantic));
        expect(child.parent).toBe(camera);
        disposeScene(scene);
    });
});
