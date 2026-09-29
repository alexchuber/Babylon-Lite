import { describe, expect, it } from "vitest";
import { createNullEngine } from "../../../packages/babylon-lite/src/engine/null-engine";
import { addToScene, createSceneContext, disposeScene } from "../../../packages/babylon-lite/src/scene/scene-core";
import { createFreeCamera } from "../../../packages/babylon-lite/src/camera/free-camera";
import { createTransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import { setParent } from "../../../packages/babylon-lite/src/scene/set-parent";
import { createSceneAccessibility, getAccessibilityNode, setAccessibilityParent } from "../../../packages/babylon-lite/src/accessibility/scene-accessibility";
import { updateSceneAccessibility } from "../../../packages/babylon-lite/src/accessibility/scene-accessibility";
import type { Mesh } from "../../../packages/babylon-lite/src/mesh/mesh";
import { removeFromScene } from "../../../packages/babylon-lite/src/scene/scene-remove";

describe("camera membership boundaries", () => {
    it.each(["deep", "wide"] as const)("records one canonical hierarchy membership for a %s addition", (shape) => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const adapter = createSceneAccessibility(scene);
        const root = createTransformNode("Root");
        const sources = [root];
        if (shape === "deep") {
            for (let index = 0; index < 31; index++) {
                const child = createTransformNode(`Depth ${index}`);
                setParent(child, sources.at(-1)!);
                sources.push(child);
            }
        } else {
            for (let index = 0; index < 64; index++) {
                const child = createTransformNode(`Width ${index}`);
                setParent(child, root);
                sources.push(child);
            }
        }
        let childReads = 0;
        for (const source of sources) {
            const children = source.children;
            Object.defineProperty(source, "children", {
                configurable: true,
                get: () => {
                    childReads++;
                    return children;
                },
            });
        }

        addToScene(scene, root);

        expect(Math.max(...[...adapter._bindings.values()].map((binding) => binding.memberships.size))).toBe(1);
        expect(childReads).toBeLessThanOrEqual(sources.length * 6);
        disposeScene(scene);
    });

    it("full refresh retires missing automatic roots but keeps explicit roots and canonical ancestors", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const explicit = createTransformNode("Explicit");
        const automatic = createTransformNode("Automatic");
        const canonicalChild = createTransformNode("Canonical child");
        setParent(canonicalChild, automatic);
        const adapter = createSceneAccessibility(scene, { roots: [explicit] });
        addToScene(scene, automatic);
        scene.meshes.push(canonicalChild as unknown as Mesh);

        updateSceneAccessibility(adapter);
        expect(getAccessibilityNode(adapter, explicit)).toBeDefined();
        expect(getAccessibilityNode(adapter, automatic)).toBeDefined();
        expect(getAccessibilityNode(adapter, canonicalChild)?.parent).toBe(getAccessibilityNode(adapter, automatic));

        scene.meshes.length = 0;
        updateSceneAccessibility(adapter);
        expect(getAccessibilityNode(adapter, explicit)).toBeDefined();
        expect(getAccessibilityNode(adapter, automatic)).toBeUndefined();
        expect(getAccessibilityNode(adapter, canonicalChild)).toBeUndefined();
        disposeScene(scene);
    });

    it("canonical removal preserves an independent explicit root", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const source = createTransformNode("Explicit and automatic");
        const adapter = createSceneAccessibility(scene, { roots: [source] });
        addToScene(scene, source);
        const node = getAccessibilityNode(adapter, source);

        removeFromScene(scene, source);

        expect(getAccessibilityNode(adapter, source)).toBe(node);
        expect(node?._available?.()).toBe(true);
        disposeScene(scene);
    });

    it("refresh retains dependency ancestors without importing their unretained siblings", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const parent = createTransformNode("Dependency parent");
        const canonical = createTransformNode("Canonical child");
        const sibling = createTransformNode("Unretained sibling");
        setParent(canonical, parent);
        setParent(sibling, parent);
        scene.meshes.push(canonical as unknown as Mesh);

        const adapter = createSceneAccessibility(scene);

        expect(getAccessibilityNode(adapter, parent)).toBeDefined();
        expect(getAccessibilityNode(adapter, canonical)?.parent).toBe(getAccessibilityNode(adapter, parent));
        expect(getAccessibilityNode(adapter, sibling)).toBeUndefined();
        scene.meshes.length = 0;
        disposeScene(scene);
    });

    it.each(["clear", "replace"])("retains pending natural camera dependencies on same-task %s without scanning unrelated roots", async (operation) => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const camera = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
        const replacement = createFreeCamera({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 });
        const child = createTransformNode("Independent");
        const group = createTransformNode("Semantic group");
        const unrelated = createTransformNode("Unrelated");
        scene.camera = camera;
        const adapter = createSceneAccessibility(scene, { roots: [child, group, unrelated] });
        setAccessibilityParent(adapter, camera, group);
        const cameraNode = getAccessibilityNode(adapter, camera)!;
        const childNode = getAccessibilityNode(adapter, child)!;
        const groupNode = getAccessibilityNode(adapter, group)!;
        let reads = 0;
        const children = unrelated.children;
        Object.defineProperty(unrelated, "children", {
            configurable: true,
            get: () => {
                reads++;
                return children;
            },
        });
        try {
            setParent(child, camera);
            scene.camera = operation === "clear" ? null : replacement;
            expect(getAccessibilityNode(adapter, camera)).toBe(cameraNode);
            expect(cameraNode.parent).toBe(groupNode);
            await Promise.resolve();
            expect(getAccessibilityNode(adapter, camera)).toBe(cameraNode);
            expect(getAccessibilityNode(adapter, child)).toBe(childNode);
            expect(childNode.parent).toBe(cameraNode);
            expect(cameraNode.parent).toBe(groupNode);
            expect(child.parent).toBe(camera);
            expect(reads).toBe(0);
            if (operation === "replace") {
                expect(getAccessibilityNode(adapter, replacement)).toBeDefined();
            }
        } finally {
            disposeScene(scene);
        }
    });

    it("retains a cleared camera that is still the explicit semantic parent of an independent node", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const camera = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
        const child = createTransformNode("Independent");
        scene.camera = camera;
        const adapter = createSceneAccessibility(scene, { roots: [child] });
        setAccessibilityParent(adapter, child, camera);
        const parent = getAccessibilityNode(adapter, camera);
        scene.camera = null;
        expect(getAccessibilityNode(adapter, camera)).toBe(parent);
        expect(getAccessibilityNode(adapter, child)?.parent).toBe(parent);
        expect(child.parent).toBeNull();
        disposeScene(scene);
    });

    it("releases a former camera ancestor when its independently retained child has moved away", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const camera = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
        const child = createTransformNode("Retained");
        const otherParent = createTransformNode("New parent");
        setParent(child, camera);
        scene.camera = camera;
        const adapter = createSceneAccessibility(scene);
        addToScene(scene, child);
        setParent(child, otherParent);
        await Promise.resolve();
        const retained = getAccessibilityNode(adapter, child);
        scene.camera = null;
        expect(getAccessibilityNode(adapter, camera)).toBeUndefined();
        expect(getAccessibilityNode(adapter, child)).toBe(retained);
        expect(retained?.parent).toBe(getAccessibilityNode(adapter, otherParent));
        disposeScene(scene);
    });

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
