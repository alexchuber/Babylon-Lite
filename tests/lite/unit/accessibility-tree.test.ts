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
    it("releases notification snapshots even when no listeners are mounted", () => {
        const tree = createAccessibilityTree();
        const node = addAccessibilityNode(tree, { tag: { name: "Original" } });
        expect(tree._changes).toBeUndefined();
        updateAccessibilityNode(tree, node, { tag: { name: "Renamed" } });
        expect(tree._changes).toBeUndefined();
        removeAccessibilityNode(tree, node);
        expect(tree._changes).toBeUndefined();
        disposeAccessibilityTree(tree);
    });

    it("exposes each nested snapshot to every listener and restores the enclosing dispatch", () => {
        const tree = createAccessibilityTree();
        const outer = addAccessibilityNode(tree, {});
        const inner = addAccessibilityNode(tree, {});
        const notifications: string[][] = [];
        onAccessibilityTreeChanged(tree, () => {
            notifications.push([...tree._changes!.nodes].map((node) => (node === outer ? "outer:first" : "inner:first")));
            if (tree._changes!.nodes.has(outer)) {
                const snapshot = tree._changes;
                updateAccessibilityNode(tree, inner, { tag: { name: "Inner" } });
                expect(tree._changes).toBe(snapshot);
            }
        });
        onAccessibilityTreeChanged(tree, () => {
            notifications.push([...tree._changes!.nodes].map((node) => (node === outer ? "outer:second" : "inner:second")));
        });
        updateAccessibilityNode(tree, outer, { tag: { name: "Outer" } });
        expect(notifications).toEqual([["outer:first"], ["inner:first"], ["inner:second"], ["outer:second"]]);
        expect(tree._changes).toBeUndefined();
    });

    it("restores nested snapshots after listener errors without skipping listeners or swallowing failures", () => {
        const tree = createAccessibilityTree();
        const outer = addAccessibilityNode(tree, {});
        const inner = addAccessibilityNode(tree, {});
        const innerError = new Error("Inner observer failed");
        const outerError = new Error("Outer observer failed");
        const laterError = new Error("Later observer failed");
        const seen: string[] = [];
        const unsubscribeFirst = onAccessibilityTreeChanged(tree, () => {
            if (tree._changes!.nodes.has(inner)) {
                throw innerError;
            }
            const snapshot = tree._changes;
            expect(() => updateAccessibilityNode(tree, inner, { tag: { name: "Nested update" } })).toThrow(innerError);
            expect(tree._changes).toBe(snapshot);
            throw outerError;
        });
        const unsubscribeSecond = onAccessibilityTreeChanged(tree, () => {
            seen.push(tree._changes!.nodes.has(inner) ? "inner" : "outer");
            if (tree._changes!.nodes.has(outer)) {
                throw laterError;
            }
        });
        let failure: unknown;
        try {
            updateAccessibilityNode(tree, outer, { tag: { name: "Outer update" } });
        } catch (error) {
            failure = error;
        }
        expect(failure).toBeInstanceOf(AggregateError);
        expect((failure as AggregateError).errors).toEqual([outerError, laterError]);
        expect(seen).toEqual(["inner", "outer"]);
        expect(tree._changes).toBeUndefined();
        unsubscribeFirst();
        unsubscribeSecond();
        onAccessibilityTreeChanged(tree, () => expect([...tree._changes!.nodes]).toEqual([outer]));
        updateAccessibilityNode(tree, outer, { tag: { name: "Recovered" } });
        expect(tree._changes).toBeUndefined();
    });

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
