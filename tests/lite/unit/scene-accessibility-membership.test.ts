import { describe, expect, it } from "vitest";
import { createNullEngine } from "../../../packages/babylon-lite/src/engine/null-engine";
import { addToScene, createSceneContext, disposeScene } from "../../../packages/babylon-lite/src/scene/scene-core";
import { createFreeCamera } from "../../../packages/babylon-lite/src/camera/free-camera";
import { createTransformNode } from "../../../packages/babylon-lite/src/scene/transform-node";
import { setParent } from "../../../packages/babylon-lite/src/scene/set-parent";
import { createSceneAccessibility, getAccessibilityNode, setAccessibilityParent, setAccessibilityTag } from "../../../packages/babylon-lite/src/accessibility/scene-accessibility";
import { updateSceneAccessibility } from "../../../packages/babylon-lite/src/accessibility/scene-accessibility";
import type { Mesh } from "../../../packages/babylon-lite/src/mesh/mesh";
import { removeFromScene } from "../../../packages/babylon-lite/src/scene/scene-remove";

describe("camera membership boundaries", () => {
    it("caches hierarchy roots during a deep canonical initial refresh", () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const sources = [createTransformNode("Root")];
        for (let index = 0; index < 63; index++) {
            const child = createTransformNode(`Depth ${index}`);
            setParent(child, sources.at(-1)!);
            sources.push(child);
        }
        let parentReads = 0;
        for (const source of sources) {
            let parent = source.parent;
            Object.defineProperty(source, "parent", {
                configurable: true,
                enumerable: true,
                get: () => {
                    parentReads++;
                    return parent;
                },
                set: (next) => {
                    parent = next;
                },
            });
            scene.meshes.push(source as unknown as Mesh);
        }

        const adapter = createSceneAccessibility(scene);

        expect(parentReads).toBeLessThanOrEqual(sources.length * 6);
        expect(adapter._membershipTokens.automatic.size).toBe(1);
        scene.meshes.length = 0;
        disposeScene(scene);
    });

    it("normalizes automatic provenance after post-add chain assembly and splitting", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const sources = Array.from({ length: 32 }, (_, index) => createTransformNode(`Independent ${index}`));
        const camera = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
        const replacement = createFreeCamera({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 });
        const adapter = createSceneAccessibility(scene, { roots: [sources[0]!] });
        for (const source of sources) {
            addToScene(scene, source);
        }
        addToScene(scene, camera);
        for (let index = 1; index < sources.length; index++) {
            setParent(sources[index]!, sources[index - 1]!);
        }
        camera.parent = sources.at(-1)!;
        scene.camera = camera;
        const focusedNode = getAccessibilityNode(adapter, sources.at(-1)!)!;
        const cameraNode = getAccessibilityNode(adapter, camera)!;

        await Promise.resolve();

        const automaticMemberships = (): number =>
            [...adapter._bindings.values()].reduce(
                (count, binding) => count + [...binding.memberships].filter((sourceMembership) => sourceMembership.kind === "automatic").length,
                0
            );
        expect(automaticMemberships()).toBe(sources.length + 1);
        expect(adapter._membershipTokens.automatic.size).toBe(1);
        expect(getAccessibilityNode(adapter, sources.at(-1)!)).toBe(focusedNode);
        expect(focusedNode.parent).toBe(getAccessibilityNode(adapter, sources.at(-2)!));
        expect([...adapter._bindings.get(sources[0]!)!.memberships].map((sourceMembership) => sourceMembership.kind).sort()).toEqual(["automatic", "camera", "explicit"]);
        expect([...adapter._bindings.get(camera)!.memberships].map((sourceMembership) => sourceMembership.kind).sort()).toEqual(["automatic", "camera"]);

        setParent(sources[16]!, null);
        await Promise.resolve();
        expect(automaticMemberships()).toBe(sources.length + 1);
        expect(adapter._membershipTokens.automatic.size).toBe(2);
        expect(getAccessibilityNode(adapter, sources[16]!)?.parent).toBeNull();
        expect(getAccessibilityNode(adapter, sources.at(-1)!)).toBe(focusedNode);

        scene.camera = replacement;
        expect(getAccessibilityNode(adapter, camera)).toBe(cameraNode);
        expect([...adapter._bindings.get(camera)!.memberships].map((sourceMembership) => sourceMembership.kind)).toEqual(["automatic"]);
        expect([...adapter._bindings.get(replacement)!.memberships].map((sourceMembership) => sourceMembership.kind)).toEqual(["camera"]);

        removeFromScene(scene, sources.at(-1)!);
        expect(getAccessibilityNode(adapter, sources.at(-1)!)).toBeUndefined();
        expect(automaticMemberships()).toBe(sources.length);
        expect(getAccessibilityNode(adapter, sources.at(-2)!)).toBeDefined();
        disposeScene(scene);
    });

    it("does not retain retired tokens when a direct parent assignment joins an existing hierarchy", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const adapter = createSceneAccessibility(scene);
        const root = createTransformNode("Root");
        const middle = createTransformNode("Middle");
        const leaf = createTransformNode("Leaf");
        const added = createTransformNode("Added");
        for (const source of [root, middle, leaf]) {
            addToScene(scene, source);
        }
        middle.parent = root;
        leaf.parent = middle;
        await Promise.resolve();
        addToScene(scene, added);
        added.parent = leaf;

        await Promise.resolve();

        const automaticMemberships = [...adapter._bindings.values()].reduce(
            (count, binding) => count + [...binding.memberships].filter((sourceMembership) => sourceMembership.kind === "automatic").length,
            0
        );
        expect(automaticMemberships).toBe(4);
        expect(adapter._membershipTokens.automatic.size).toBe(1);
        disposeScene(scene);
    });

    it("H01 closes direct-parent joins over shared tokens without dropping unaffected siblings", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const adapter = createSceneAccessibility(scene);
        const root = createTransformNode("Root");
        const stable = createTransformNode("Stable sibling");
        const joinPoint = createTransformNode("Join point");
        const branch = createTransformNode("Joining branch");
        const branchLeaf = createTransformNode("Joining leaf");
        for (const source of [root, stable, joinPoint, branch, branchLeaf]) {
            addToScene(scene, source);
        }
        stable.parent = root;
        joinPoint.parent = root;
        branchLeaf.parent = branch;
        await Promise.resolve();

        setAccessibilityTag(stable, { name: "Stable override" });
        setAccessibilityParent(adapter, stable, null);
        const stableNode = getAccessibilityNode(adapter, stable)!;
        const branchLeafNode = getAccessibilityNode(adapter, branchLeaf)!;
        branch.parent = joinPoint;
        await Promise.resolve();

        expect(getAccessibilityNode(adapter, stable)).toBe(stableNode);
        expect(stableNode).toMatchObject({ parent: null, tag: { name: "Stable override" } });
        expect(getAccessibilityNode(adapter, branchLeaf)).toBe(branchLeafNode);
        expect([root, stable, joinPoint, branch, branchLeaf].every((source) => getAccessibilityNode(adapter, source))).toBe(true);
        expect(adapter._membershipTokens.automatic.size).toBe(1);
        expect(
            [...adapter._bindings.values()].reduce(
                (count, binding) => count + [...binding.memberships].filter((sourceMembership) => sourceMembership.kind === "automatic").length,
                0
            )
        ).toBe(5);
        disposeScene(scene);
    });

    it("H02 retires a parent-rooted automatic claim after its last source is removed and its camera claim clears", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const adapter = createSceneAccessibility(scene);
        const camera = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
        const child = createTransformNode("Automatic child");

        for (let cycle = 0; cycle < 5; cycle++) {
            scene.camera = camera;
            addToScene(scene, child);
            setParent(child, camera);
            await Promise.resolve();
            expect(adapter._membershipTokens.automatic.size).toBe(1);

            removeFromScene(scene, child);
            scene.camera = null;
            expect(getAccessibilityNode(adapter, child)).toBeUndefined();
            expect(getAccessibilityNode(adapter, camera)).toBeUndefined();
            await Promise.resolve();

            expect(getAccessibilityNode(adapter, child)).toBeUndefined();
            expect(getAccessibilityNode(adapter, camera)).toBeUndefined();
            expect(adapter._bindings.size).toBe(0);
            expect(adapter._automaticSources.size).toBe(0);
            expect(adapter._automaticRoots.size).toBe(0);
            expect(adapter._membershipTokens.automatic.size).toBe(0);
            expect(adapter._memberships.size).toBe(0);
            expect([...adapter._bindings.values()].reduce((count, binding) => count + binding.unsubscribe.length, 0)).toBe(0);
        }
        disposeScene(scene);
    });

    it("H02 preserves an explicit root while retiring its final automatic and camera claims", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const camera = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
        const child = createTransformNode("Automatic child");
        const adapter = createSceneAccessibility(scene, { roots: [camera] });
        scene.camera = camera;
        addToScene(scene, child);
        setParent(child, camera);
        await Promise.resolve();
        const cameraNode = getAccessibilityNode(adapter, camera);

        removeFromScene(scene, child);
        scene.camera = null;
        await Promise.resolve();

        expect(getAccessibilityNode(adapter, child)).toBeUndefined();
        expect(getAccessibilityNode(adapter, camera)).toBe(cameraNode);
        expect([...adapter._bindings.get(camera)!.memberships].map((sourceMembership) => sourceMembership.kind)).toEqual(["explicit"]);
        expect(adapter._automaticRoots.size).toBe(0);
        expect(adapter._membershipTokens.automatic.size).toBe(0);
        disposeScene(scene);
    });

    it("H02 batches recursive removals without repeatedly expanding the shared automatic claim", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const adapter = createSceneAccessibility(scene);
        const root = createTransformNode("Recursive root");
        const children = Array.from({ length: 64 }, (_, index) => createTransformNode(`Recursive child ${index}`));
        for (const child of children) {
            setParent(child, root);
        }
        addToScene(scene, root);
        const token = [...adapter._membershipTokens.automatic.values()][0]!;
        const members = adapter._memberships.get(token)!;
        let memberVisits = 0;
        const countedMembers = new Set(members);
        countedMembers[Symbol.iterator] = function* (): Generator<Parameters<typeof members.add>[0], undefined, unknown> {
            for (const member of members) {
                memberVisits++;
                yield member;
            }
            return undefined;
        };
        adapter._memberships.set(token, countedMembers);

        removeFromScene(scene, root);
        await Promise.resolve();

        expect(memberVisits).toBeLessThanOrEqual((children.length + 1) * 2);
        expect(adapter._bindings.size).toBe(0);
        expect(adapter._automaticSources.size).toBe(0);
        expect(adapter._automaticRoots.size).toBe(0);
        expect(adapter._membershipTokens.automatic.size).toBe(0);
        expect(adapter._memberships.size).toBe(0);
        disposeScene(scene);
    });

    it("H02 removes a recursive hierarchy without scanning unrelated semantic overrides per source", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const root = createTransformNode("Recursive root");
        const children = Array.from({ length: 32 }, (_, index) => createTransformNode(`Recursive child ${index}`));
        for (const child of children) {
            setParent(child, root);
        }
        const semanticParent = createTransformNode("Semantic parent");
        const semanticChildren = Array.from({ length: 32 }, (_, index) => createTransformNode(`Semantic child ${index}`));
        const adapter = createSceneAccessibility(scene, { roots: [semanticParent, ...semanticChildren] });
        for (const child of semanticChildren) {
            setAccessibilityParent(adapter, child, semanticParent);
        }
        addToScene(scene, root);
        const parents = adapter._parents;
        const iterateParents = parents[Symbol.iterator].bind(parents);
        let parentVisits = 0;
        parents[Symbol.iterator] = function* (): Generator<Parameters<typeof parents.set>, undefined, unknown> {
            for (const entry of { [Symbol.iterator]: iterateParents }) {
                parentVisits++;
                yield entry;
            }
            return undefined;
        };

        removeFromScene(scene, root);
        await Promise.resolve();

        expect(parentVisits).toBeLessThanOrEqual(semanticChildren.length);
        expect([root, ...children].every((source) => getAccessibilityNode(adapter, source) === undefined)).toBe(true);
        expect(semanticChildren.every((source) => getAccessibilityNode(adapter, source)?.parent === getAccessibilityNode(adapter, semanticParent))).toBe(true);
        disposeScene(scene);
    });

    it("H05 expands one shared automatic token once for a batch of parent writes", async () => {
        const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
        const adapter = createSceneAccessibility(scene);
        const sources = Array.from({ length: 32 }, (_, index) => createTransformNode(`Shared ${index}`));
        for (const source of sources) {
            addToScene(scene, source);
        }
        for (let index = 1; index < sources.length; index++) {
            sources[index]!.parent = sources[index - 1]!;
        }
        await Promise.resolve();

        const token = [...adapter._membershipTokens.automatic.values()][0]!;
        const members = adapter._memberships.get(token)!;
        let memberVisits = 0;
        const countedMembers = new Set(members);
        countedMembers[Symbol.iterator] = function* (): Generator<Parameters<typeof members.add>[0], undefined, unknown> {
            for (const member of members) {
                memberVisits++;
                yield member;
            }
            return undefined;
        };
        adapter._memberships.set(token, countedMembers);
        for (let index = 2; index < sources.length; index++) {
            sources[index]!.parent = sources[0]!;
        }

        await Promise.resolve();

        expect(memberVisits).toBeLessThanOrEqual(sources.length * 4);
        expect(adapter._membershipTokens.automatic.size).toBe(1);
        expect(sources.every((source) => getAccessibilityNode(adapter, source))).toBe(true);
        disposeScene(scene);
    });

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
