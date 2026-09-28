import { describe, expect, it } from "vitest";
import {
    addAccessibilityNode,
    createAccessibilityTree,
    disposeAccessibilityTree,
    onAccessibilityTreeChanged,
    removeAccessibilityNode,
    updateAccessibilityNode,
} from "../../../packages/babylon-lite/src/accessibility/accessibility-tree";

describe("accessibility tree", () => {
    it("maintains logical parentage and exposes updated semantics without changing identity", () => {
        const tree = createAccessibilityTree();
        const group = addAccessibilityNode(tree, { tag: { description: "Instruments", role: "group" } });
        const item = addAccessibilityNode(tree, { parent: group, tag: { description: "Piano", aria: { "aria-pressed": false } } });
        expect(tree.roots).toEqual([group]);
        expect(group.children).toEqual([item]);
        updateAccessibilityNode(tree, item, { tag: { description: "Piano", aria: { "aria-pressed": true } }, parent: null });
        expect(tree.roots).toEqual([group, item]);
        expect(group.children).toEqual([]);
        expect(item.tag?.aria?.["aria-pressed"]).toBe(true);
    });

    it("rejects cycles and foreign parents before changing the tree", () => {
        const tree = createAccessibilityTree();
        const parent = addAccessibilityNode(tree, {});
        const child = addAccessibilityNode(tree, { parent });
        expect(() => updateAccessibilityNode(tree, parent, { parent: child })).toThrow(/cycle/i);
        const foreign = addAccessibilityNode(createAccessibilityTree(), {});
        expect(() => updateAccessibilityNode(tree, child, { parent: foreign })).toThrow(/tree/i);
        expect(child.parent).toBe(parent);
        expect(tree.roots).toEqual([parent]);
    });

    it("rejects conflicting state before reparenting and snapshots mutable caller metadata", () => {
        const tree = createAccessibilityTree();
        const parent = addAccessibilityNode(tree, {});
        const tag = { description: "Piano", aria: { "aria-pressed": false } };
        const child = addAccessibilityNode(tree, { tag });
        tag.aria["aria-pressed"] = true;
        expect(child.tag?.aria?.["aria-pressed"]).toBe(false);
        expect(() => updateAccessibilityNode(tree, child, { parent, tag: { disabled: true, aria: { "aria-disabled": false } } })).toThrow(/conflicting/i);
        expect(child.parent).toBeNull();
    });

    it("notifies changes and removes descendants without retaining callbacks after disposal", () => {
        const tree = createAccessibilityTree();
        let changes = 0;
        onAccessibilityTreeChanged(tree, () => changes++);
        const parent = addAccessibilityNode(tree, {});
        const child = addAccessibilityNode(tree, { parent });
        updateAccessibilityNode(tree, child, { hidden: true, disabled: true });
        expect(changes).toBe(3);
        removeAccessibilityNode(tree, parent);
        expect(tree.roots).toEqual([]);
        expect(child.parent).toBe(null);
        disposeAccessibilityTree(tree);
        expect(changes).toBe(5);
        expect(() => addAccessibilityNode(tree, {})).toThrow(/disposed/i);
        disposeAccessibilityTree(tree);
        expect(changes).toBe(5);
    });
});
