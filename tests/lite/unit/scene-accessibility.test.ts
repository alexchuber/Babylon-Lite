import { describe, expect, it } from "vitest";
import { createNullEngine } from "../../../packages/babylon-lite/src/engine/null-engine";
import { addToScene, createSceneContext, disposeScene } from "../../../packages/babylon-lite/src/scene/scene-core";
import { removeFromScene } from "../../../packages/babylon-lite/src/scene/scene-remove";
import { createTransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import {
    createSceneAccessibility,
    disposeSceneAccessibility,
    getAccessibilityNode,
    getAccessibilityTag,
    setAccessibilityTag,
    setAccessibilityParent,
    updateSceneAccessibility,
} from "../../../packages/babylon-lite/src/accessibility/scene-accessibility";
import { setParent } from "../../../packages/babylon-lite/src/scene/set-parent";
import { sceneNodeChanged } from "../../../packages/babylon-lite/src/scene/scene-lifecycle";

describe("scene accessibility lifecycle", () => {
    it("tracks late additions, direct metadata/visibility writes, parent changes, removal, and scene disposal", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const adapter = createSceneAccessibility(scene);
        const group = createTransformNode("Group");
        const child = createTransformNode("Child");
        addToScene(scene, group);
        addToScene(scene, child);
        setAccessibilityTag(group, { description: "Group", role: "group" });
        setAccessibilityTag(child, { description: "Child", eventHandler: { click: () => {} } });
        child.parent = group;
        await Promise.resolve();
        const semantic = getAccessibilityNode(adapter, child)!;
        expect(semantic.parent).toBe(getAccessibilityNode(adapter, group));
        expect(semantic.tag?.description).toBe("Child");
        child.visible = false;
        await Promise.resolve();
        expect(semantic.tag).toBeNull();
        removeFromScene(scene, child);
        expect(getAccessibilityNode(adapter, child)).toBeUndefined();
        disposeScene(scene);
        expect(adapter.tree.disposed).toBe(true);
        expect(Object.getOwnPropertyDescriptor(group, "visible")?.get).toBeUndefined();
    });

    it("shares reversible observation across scenes without copying observers to clones", async () => {
        const first = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const second = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const node = createTransformNode("Shared");
        const originalParent = Object.getOwnPropertyDescriptor(node, "parent");
        const a = createSceneAccessibility(first, { roots: [node] });
        const b = createSceneAccessibility(second, { roots: [node] });
        disposeSceneAccessibility(a);
        setAccessibilityTag(node, { description: "Updated" });
        await Promise.resolve();
        expect(getAccessibilityNode(b, node)?.tag?.description).toBe("Updated");
        disposeSceneAccessibility(b);
        expect(Object.getOwnPropertyDescriptor(node, "parent")).toEqual(originalParent);
        expect(getAccessibilityTag(node)?.description).toBe("Updated");
        expect(sceneNodeChanged).toBeNull();
    });

    it("keeps independent objects when their logical group is removed", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const adapter = createSceneAccessibility(scene);
        const group = createTransformNode("Group");
        const independent = createTransformNode("Independent");
        addToScene(scene, group);
        addToScene(scene, independent);
        setAccessibilityParent(adapter, independent, group);
        removeFromScene(scene, group);
        expect(getAccessibilityNode(adapter, group)).toBeUndefined();
        expect(getAccessibilityNode(adapter, independent)?.parent).toBeNull();
        expect(independent.parent).toBeNull();
        updateSceneAccessibility(adapter);
        expect(getAccessibilityNode(adapter, group)).toBeUndefined();
        disposeScene(scene);
    });

    it("preserves visible children of an invisible native parent and invalidates stale actions synchronously", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const group = createTransformNode("Group");
        const child = createTransformNode("Child");
        setParent(child, group);
        setAccessibilityTag(group, { description: "Group" });
        setAccessibilityTag(child, { eventHandler: { click: () => {} } });
        const adapter = createSceneAccessibility(scene, { roots: [group] });
        group.visible = false;
        expect(getAccessibilityNode(adapter, group)?.tag).toBeNull();
        await Promise.resolve();
        expect(getAccessibilityNode(adapter, child)?.tag?.name).toBe("Child");
        child.name = "Renamed";
        await Promise.resolve();
        expect(getAccessibilityNode(adapter, child)?.tag?.name).toBe("Renamed");
        setAccessibilityTag(child, { disabled: true, description: "Disabled" });
        expect(getAccessibilityNode(adapter, child)?.disabled).toBe(true);
        disposeScene(scene);
    });
});
