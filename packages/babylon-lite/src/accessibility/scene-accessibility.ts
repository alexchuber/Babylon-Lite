import type { Camera } from "../camera/camera.js";
import type { SceneContext } from "../scene/scene-core.js";
import type { SceneNode } from "../scene/scene-node.js";
import {
    addAccessibilityNode,
    batchAccessibilityUpdates,
    createAccessibilityTree,
    disposeAccessibilityTree,
    removeAccessibilityNode,
    updateAccessibilityNode,
} from "./accessibility-tree.js";
import type { AccessibilityNode, AccessibilityTag, AccessibilityTree } from "./accessibility-tree.js";
import { observeProperty } from "./observe-property.js";

type SceneSource = SceneNode | Camera;

/** Optional roots for transform-only objects that the rendering scene does not retain. */
export interface SceneAccessibilityOptions {
    roots?: readonly SceneSource[];
}

interface SourceBinding {
    node: AccessibilityNode;
    unsubscribe: (() => void)[];
}

/** Passive semantic projection owned by one scene. */
export interface SceneAccessibility {
    readonly tree: AccessibilityTree;
    /** @internal */
    _scene: SceneContext;
    /** @internal */
    _automatic: Set<SceneSource>;
    /** @internal */
    _explicit: Set<SceneSource>;
    /** @internal */
    _parents: Map<SceneSource, SceneSource | null>;
    /** @internal */
    _bindings: Map<SceneSource, SourceBinding>;
    /** @internal */
    _unobserveCamera: () => void;
    /** @internal */
    _pending: boolean;
    /** @internal */
    _disposed: boolean;
}

let tags: WeakMap<object, AccessibilityTag> | undefined;
let tagListeners: WeakMap<object, Set<() => void>> | undefined;

function isSceneSource(value: unknown): value is SceneSource {
    return typeof value === "object" && value !== null && "children" in value && Array.isArray(value.children) && "worldMatrix" in value;
}

function sourceParent(source: SceneSource): SceneSource | null {
    const parent = "parent" in source ? source.parent : null;
    return isSceneSource(parent) ? parent : null;
}

function projectRuntimeHidden(tag: AccessibilityTag | null, hidden: boolean): AccessibilityTag | null {
    if (!tag || !hidden) {
        return tag;
    }
    const hasAriaHidden = tag.aria ? "aria-hidden" in tag.aria : false;
    if (tag.hidden !== false && (!hasAriaHidden || String(tag.aria?.["aria-hidden"]) === "true")) {
        return tag;
    }
    return Object.freeze({
        ...tag,
        hidden: true,
        aria: hasAriaHidden ? Object.freeze({ ...tag.aria, "aria-hidden": true }) : tag.aria,
    });
}

function sourceState(source: SceneSource): Pick<AccessibilityNode, "tag" | "hidden" | "disabled"> {
    const authored = getAccessibilityTag(source);
    const runtimeHidden = ("_disposed" in source && source._disposed === true) || ("visible" in source && source.visible === false);
    const snapshot = authored
        ? Object.freeze({
              ...authored,
              name: authored.name ?? authored.description ?? source.name,
              aria: authored.aria ? Object.freeze({ ...authored.aria }) : undefined,
          })
        : null;
    const tag = projectRuntimeHidden(snapshot, runtimeHidden);
    return {
        tag,
        hidden: runtimeHidden || tag?.hidden === true || String(tag?.aria?.["aria-hidden"]) === "true",
        disabled: tag?.disabled === true || String(tag?.aria?.["aria-disabled"]) === "true",
    };
}

function schedule(adapter: SceneAccessibility): void {
    if (adapter._pending || adapter._disposed) {
        return;
    }
    adapter._pending = true;
    queueMicrotask(() => {
        adapter._pending = false;
        if (!adapter._disposed) {
            updateSceneAccessibility(adapter);
        }
    });
}

function observeSource(adapter: SceneAccessibility, source: SceneSource, binding: SourceBinding): void {
    for (const property of ["name", "visible", "_disposed", "parent"]) {
        binding.unsubscribe.push(observeProperty(source, property, () => schedule(adapter)));
    }
    const listeners = (tagListeners ??= new WeakMap()).get(source) ?? new Set<() => void>();
    tagListeners.set(source, listeners);
    const changed = (): void => schedule(adapter);
    listeners.add(changed);
    binding.unsubscribe.push(() => {
        listeners.delete(changed);
        if (!listeners.size) {
            tagListeners?.delete(source);
        }
    });
}

function collectAncestors(source: SceneSource, desired: Set<SceneSource>): void {
    for (let current: SceneSource | null = source; current && !desired.has(current); current = sourceParent(current)) {
        desired.add(current);
    }
}

function collectSubtree(source: SceneSource, desired: Set<SceneSource>): void {
    collectAncestors(source, desired);
    for (const child of source.children) {
        collectSubtree(child, desired);
    }
}

function desiredSources(adapter: SceneAccessibility): Set<SceneSource> {
    const desired = new Set<SceneSource>();
    for (const source of adapter._automatic) {
        collectAncestors(source, desired);
    }
    for (const source of adapter._explicit) {
        collectSubtree(source, desired);
    }
    if (adapter._scene.camera) {
        collectSubtree(adapter._scene.camera, desired);
    }
    return desired;
}

function semanticParent(adapter: SceneAccessibility, source: SceneSource, desired: Set<SceneSource>): SceneSource | null {
    const parent = adapter._parents.has(source) ? adapter._parents.get(source)! : sourceParent(source);
    return parent && desired.has(parent) ? parent : null;
}

function ensureBinding(adapter: SceneAccessibility, source: SceneSource): SourceBinding {
    let binding = adapter._bindings.get(source);
    if (!binding) {
        binding = { node: addAccessibilityNode(adapter.tree, { target: source, ...sourceState(source) }), unsubscribe: [] };
        adapter._bindings.set(source, binding);
        observeSource(adapter, source, binding);
    }
    return binding;
}

/** Synchronize the semantic tree immediately. Normal property writes are coalesced to a microtask. */
export function updateSceneAccessibility(adapter: SceneAccessibility): void {
    if (adapter._disposed) {
        return;
    }
    const desired = desiredSources(adapter);
    batchAccessibilityUpdates(adapter.tree, () => {
        for (const source of desired) {
            ensureBinding(adapter, source);
        }
        for (const source of desired) {
            const binding = adapter._bindings.get(source)!;
            const parent = semanticParent(adapter, source, desired);
            updateAccessibilityNode(adapter.tree, binding.node, {
                ...sourceState(source),
                parent: parent ? adapter._bindings.get(parent)!.node : null,
                target: source,
            });
        }
        for (const [source, binding] of [...adapter._bindings]) {
            if (desired.has(source)) {
                continue;
            }
            for (const unsubscribe of binding.unsubscribe) {
                unsubscribe();
            }
            adapter._bindings.delete(source);
            if (adapter.tree._nodes.has(binding.node)) {
                removeAccessibilityNode(adapter.tree, binding.node);
            }
        }
    });
}

/** Replace or remove one object's accessibility metadata. */
export function setAccessibilityTag(source: object, tag: AccessibilityTag | null): void {
    const tree = createAccessibilityTree();
    const probe = addAccessibilityNode(tree, { tag });
    const snapshot = probe.tag;
    disposeAccessibilityTree(tree);
    if (snapshot) {
        (tags ??= new WeakMap()).set(source, snapshot);
    } else {
        tags?.delete(source);
    }
    for (const listener of [...(tagListeners?.get(source) ?? [])]) {
        listener();
    }
}

/** Return the immutable metadata currently attached to an object. */
export function getAccessibilityTag(source: object): AccessibilityTag | null {
    return tags?.get(source) ?? null;
}

/** Return the stable logical node for a scene object. */
export function getAccessibilityNode(adapter: SceneAccessibility, source: SceneSource): AccessibilityNode | undefined {
    return adapter._bindings.get(source)?.node;
}

/** Override semantic grouping without changing the render transform. Pass undefined to restore natural parentage. */
export function setAccessibilityParent(adapter: SceneAccessibility, source: SceneSource, parent: SceneSource | null | undefined): void {
    if (adapter._disposed) {
        throw new Error("Scene accessibility is disposed.");
    }
    if (parent === undefined) {
        adapter._parents.delete(source);
    } else {
        adapter._parents.set(source, parent);
    }
    schedule(adapter);
}

/** Bind a scene to a headless accessibility tree. A scene can own one projection at a time. */
export function createSceneAccessibility(scene: SceneContext, options: SceneAccessibilityOptions = {}): SceneAccessibility {
    if (scene._accessibility) {
        throw new Error("The scene already has an accessibility projection.");
    }
    const adapter: SceneAccessibility = {
        tree: createAccessibilityTree(),
        _scene: scene,
        _automatic: new Set([...scene.meshes, ...scene.lights].filter(isSceneSource)),
        _explicit: new Set(options.roots ?? []),
        _parents: new Map(),
        _bindings: new Map(),
        _unobserveCamera: () => {},
        _pending: false,
        _disposed: false,
    };
    scene._accessibility = {
        nodeChanged: (source, added) => {
            if (!isSceneSource(source)) {
                return;
            }
            if (added) {
                adapter._automatic.add(source);
            } else {
                adapter._automatic.delete(source);
            }
            schedule(adapter);
        },
        dispose: () => disposeSceneAccessibility(adapter),
    };
    adapter._unobserveCamera = observeProperty(scene, "camera", () => schedule(adapter));
    try {
        updateSceneAccessibility(adapter);
        return adapter;
    } catch (error) {
        disposeSceneAccessibility(adapter);
        throw error;
    }
}

/** Dispose the scene binding and its tree. */
export function disposeSceneAccessibility(adapter: SceneAccessibility): void {
    if (adapter._disposed) {
        return;
    }
    adapter._disposed = true;
    adapter._unobserveCamera();
    for (const binding of adapter._bindings.values()) {
        for (const unsubscribe of binding.unsubscribe) {
            unsubscribe();
        }
    }
    adapter._bindings.clear();
    adapter._automatic.clear();
    adapter._explicit.clear();
    adapter._parents.clear();
    if (adapter._scene._accessibility?.dispose) {
        adapter._scene._accessibility = undefined;
    }
    disposeAccessibilityTree(adapter.tree);
}
