import { describe, expect, it } from "vitest";
import { createNullEngine } from "../../../packages/babylon-lite/src/engine/null-engine";
import { addToScene, createSceneContext, disposeScene } from "../../../packages/babylon-lite/src/scene/scene-core";
import { removeFromScene } from "../../../packages/babylon-lite/src/scene/scene-remove";
import { createTransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import { setParent } from "../../../packages/babylon-lite/src/scene/set-parent";
import { createSceneAccessibility, getAccessibilityNode, setAccessibilityParent, setAccessibilityTag } from "../../../packages/babylon-lite/src/accessibility/scene-accessibility";

describe("scene accessibility", () => {
    it("tracks passive metadata, hierarchy, visibility, and scene membership", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const accessibility = createSceneAccessibility(scene);
        const group = createTransformNode("Group");
        const child = createTransformNode("Child");

        setAccessibilityTag(group, { name: "Objects", role: "group" });
        setAccessibilityTag(child, {
            name: "Cube",
            description: "A red cube",
            role: "button",
            aria: { "aria-pressed": false },
        });
        setParent(child, group);
        addToScene(scene, group);
        await Promise.resolve();

        const childNode = getAccessibilityNode(accessibility, child)!;
        expect(childNode.parent).toBe(getAccessibilityNode(accessibility, group));
        expect(childNode.tag?.aria?.["aria-pressed"]).toBe(false);

        child.visible = false;
        await Promise.resolve();
        expect(childNode.hidden).toBe(true);

        child.visible = true;
        child.name = "Renamed";
        setAccessibilityTag(child, { description: "Updated description", role: "img" });
        await Promise.resolve();
        expect(childNode).toMatchObject({
            hidden: false,
            tag: { name: "Updated description", description: "Updated description", role: "img" },
        });

        removeFromScene(scene, child);
        await Promise.resolve();
        expect(getAccessibilityNode(accessibility, child)).toBeUndefined();

        disposeScene(scene);
        expect(accessibility.tree.disposed).toBe(true);
    });

    it("supports semantic grouping without changing transforms", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const group = createTransformNode("Semantic group");
        const child = createTransformNode("Child");
        const accessibility = createSceneAccessibility(scene);
        addToScene(scene, group);
        addToScene(scene, child);

        setAccessibilityParent(accessibility, child, group);
        await Promise.resolve();
        expect(getAccessibilityNode(accessibility, child)?.parent).toBe(getAccessibilityNode(accessibility, group));
        expect(child.parent).toBeNull();

        setAccessibilityParent(accessibility, child, undefined);
        await Promise.resolve();
        expect(getAccessibilityNode(accessibility, child)?.parent).toBeNull();

        setAccessibilityParent(accessibility, child, group);
        removeFromScene(scene, group);
        await Promise.resolve();
        expect(getAccessibilityNode(accessibility, group)).toBeUndefined();
        expect(getAccessibilityNode(accessibility, child)?.parent).toBeNull();
        disposeScene(scene);
    });
});
