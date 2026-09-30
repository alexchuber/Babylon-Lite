import { describe, expect, it } from "vitest";
import { createNullEngine } from "../../../packages/babylon-lite/src/engine/null-engine";
import { createHemisphericLight } from "../../../packages/babylon-lite/src/light/hemispheric";
import { addToScene, createSceneContext, disposeScene } from "../../../packages/babylon-lite/src/scene/scene-core";
import { removeFromScene } from "../../../packages/babylon-lite/src/scene/scene-remove";
import { createTransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import { setParent } from "../../../packages/babylon-lite/src/scene/set-parent";
import {
    createSceneAccessibility,
    getAccessibilityNode,
    getAccessibilityTag,
    setAccessibilityParent,
    setAccessibilityTag,
} from "../../../packages/babylon-lite/src/accessibility/scene-accessibility";

describe("scene accessibility", () => {
    it("publishes immutable tags only after validation", () => {
        const source = {};
        const aria = { "aria-live": "polite" };
        setAccessibilityTag(source, { name: "Mars", aria });

        aria["aria-live"] = "assertive";
        expect(getAccessibilityTag(source)).toEqual({ name: "Mars", aria: { "aria-live": "polite" } });
        expect(Object.isFrozen(getAccessibilityTag(source))).toBe(true);
        expect(Object.isFrozen(getAccessibilityTag(source)?.aria)).toBe(true);

        expect(() => setAccessibilityTag(source, { aria: { label: "Invalid" } as never })).toThrow(/aria/i);
        expect(getAccessibilityTag(source)?.name).toBe("Mars");

        setAccessibilityTag(source, null);
        expect(getAccessibilityTag(source)).toBeNull();
    });

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
            aria: { "aria-hidden": false, "aria-pressed": false },
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
        expect(childNode.tag?.aria?.["aria-hidden"]).toBe(true);

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

    it("includes lights that were added before the binding", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const light = createHemisphericLight();
        setAccessibilityTag(light, { name: "Ambient light" });
        addToScene(scene, light);

        const accessibility = createSceneAccessibility(scene);

        expect(getAccessibilityNode(accessibility, light)?.tag?.name).toBe("Ambient light");
        disposeScene(scene);
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
