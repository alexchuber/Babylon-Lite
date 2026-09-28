import type { SceneContext } from "../scene/scene-core.js";
import type { SceneNode } from "../scene/scene-node.js";
import {
    addAccessibilityNode,
    createAccessibilityTree,
    disposeAccessibilityTree,
    removeAccessibilityNode,
    updateAccessibilityNode,
    _snapshotAccessibilityTag,
    batchAccessibilityUpdates,
} from "./accessibility-tree.js";
import type { AccessibilityNode, AccessibilityTag, AccessibilityTree } from "./accessibility-tree.js";
import { observeProperty } from "./observe-property.js";
import { sceneNodeChanged, setSceneNodeChanged } from "../scene/scene-lifecycle.js";

/** Optional explicit roots for logical/empty nodes that the rendering scene does not retain. */
export interface SceneAccessibilityOptions {
    roots?: readonly SceneNode[];
}

interface NodeBinding {
    node: AccessibilityNode;
    unsubscribe: (() => void)[];
}

/** Opt-in adapter. The scene owns its binding, never the component. */
export interface SceneAccessibility {
    readonly tree: AccessibilityTree;
    /** @internal */
    _scene: SceneContext;
    /** @internal */
    _bindings: Map<SceneNode, NodeBinding>;
    /** @internal */
    _dispose: () => void;
    /** @internal */
    _pending: boolean;
    /** @internal */
    _disposed: boolean;
    /** @internal */
    _dirty: Set<SceneNode>;
    /** @internal */
    _parents: Map<SceneNode, SceneNode | null>;
    /** @internal */
    _removed: WeakSet<SceneNode>;
    /** @internal */
    _roots: Set<SceneNode>;
}

interface SceneObservers {
    adapters: Set<SceneAccessibility>;
}

let sceneObservers: WeakMap<SceneContext, SceneObservers> | undefined;
let activeAdapters = 0;
let previousNodeChanged: typeof sceneNodeChanged = null;
let tags: WeakMap<object, AccessibilityTag> | undefined;
let tagObservers: WeakMap<object, Set<() => void>> | undefined;
let tagValidators: WeakMap<object, Set<(tag: AccessibilityTag | null) => void>> | undefined;

function isNode(value: unknown): value is SceneNode {
    return typeof value === "object" && value !== null && "children" in value && Array.isArray(value.children) && "parent" in value && "worldMatrix" in value;
}

function nodeChanged(scene: SceneContext, node: unknown, added: boolean): void {
    previousNodeChanged?.(scene, node, added);
    for (const target of sceneObservers?.get(scene)?.adapters ?? []) {
        if (isNode(node)) {
            if (added) {
                target._removed.delete(node);
                if (!scene.meshes.some((member) => member === node) && !scene.lights.some((member) => member === node) && !(isNode(scene.camera) && scene.camera === node)) {
                    target._roots.add(node);
                }
                bind(target, node);
                schedule(target, node);
            } else {
                unbind(target, node);
            }
        }
    }
}

function disposed(node: SceneNode): boolean {
    return "_disposed" in node && node._disposed === true;
}

function sourceState(source: SceneNode, tag = getAccessibilityTag(source)): Pick<AccessibilityNode, "tag" | "hidden" | "disabled"> {
    return {
        tag: tag && source.visible !== false ? _snapshotAccessibilityTag({ ...tag, name: tag.name ?? tag.description ?? source.name }) : null,
        hidden: disposed(source) || tag?.hidden === true,
        disabled: tag?.disabled === true,
    };
}

function schedule(adapter: SceneAccessibility, source: SceneNode): void {
    const binding = adapter._bindings.get(source);
    if (binding) {
        Object.assign(binding.node, sourceState(source));
    }
    adapter._dirty.add(source);
    if (adapter._pending || adapter._disposed) {
        return;
    }
    adapter._pending = true;
    queueMicrotask(() => {
        adapter._pending = false;
        if (!adapter._disposed) {
            batchAccessibilityUpdates(adapter.tree, () => {
                for (const node of adapter._dirty) {
                    updateSource(adapter, node);
                }
                adapter._dirty.clear();
            });
        }
    });
}

function bind(adapter: SceneAccessibility, source: SceneNode): AccessibilityNode | undefined {
    if (disposed(source) || adapter._removed.has(source)) {
        return undefined;
    }
    const existing = adapter._bindings.get(source);
    if (existing) {
        return existing.node;
    }
    const node = addAccessibilityNode(adapter.tree, { target: source, ...sourceState(source) });
    const binding: NodeBinding = { node, unsubscribe: [] };
    adapter._bindings.set(source, binding);
    for (const property of ["name", "visible", "parent", "_disposed"]) {
        binding.unsubscribe.push(observeProperty(source, property, () => schedule(adapter, source)));
    }
    const observers = (tagObservers ??= new WeakMap());
    let listeners = observers.get(source);
    if (!listeners) {
        listeners = new Set();
        observers.set(source, listeners);
    }
    const changed = (): void => schedule(adapter, source);
    listeners.add(changed);
    binding.unsubscribe.push(() => {
        listeners.delete(changed);
        if (listeners.size === 0) {
            observers.delete(source);
        }
    });
    const validations = (tagValidators ??= new WeakMap());
    let validators = validations.get(source);
    if (!validators) {
        validators = new Set();
        validations.set(source, validators);
    }
    const validate = (tag: AccessibilityTag | null): void => {
        for (const check of adapter.tree._validators) {
            check({ ...node, ...sourceState(source, tag) }, node);
        }
    };
    validators.add(validate);
    binding.unsubscribe.push(() => {
        validators.delete(validate);
        if (!validators.size) {
            validations.delete(source);
        }
    });
    if (isNode(source.parent)) {
        const parent = bind(adapter, source.parent);
        updateAccessibilityNode(adapter.tree, node, { parent: parent ?? null });
    }
    for (const child of source.children) {
        bind(adapter, child);
    }
    return node;
}

function unbind(adapter: SceneAccessibility, source: SceneNode): void {
    const binding = adapter._bindings.get(source);
    if (!binding) {
        return;
    }
    adapter._removed.add(source);
    adapter._roots.delete(source);
    adapter._parents.delete(source);
    binding.unsubscribe.forEach((unsubscribe) => unsubscribe());
    adapter._bindings.delete(source);
    batchAccessibilityUpdates(adapter.tree, () => {
        for (const child of [...binding.node.children]) {
            updateAccessibilityNode(adapter.tree, child, { parent: binding.node.parent });
        }
        removeAccessibilityNode(adapter.tree, binding.node);
        for (const [child, parent] of adapter._parents) {
            if (parent === source) {
                adapter._parents.delete(child);
                updateSource(adapter, child);
            }
        }
    });
}

/** Refresh after in-place ARIA edits or a batch of raw property writes. No per-frame scan is installed. */
function updateSource(adapter: SceneAccessibility, source: SceneNode): void {
    const binding = adapter._bindings.get(source);
    if (!binding) {
        return;
    }
    if (disposed(source)) {
        unbind(adapter, source);
        return;
    }
    const sourceParent = adapter._parents.has(source) ? adapter._parents.get(source) : source.parent;
    const parent = isNode(sourceParent) ? bind(adapter, sourceParent) : undefined;
    updateAccessibilityNode(adapter.tree, binding.node, {
        ...sourceState(source),
        parent: parent ?? null,
    });
}

/** Refresh after direct child-array edits. Canonical mutations update only changed source nodes. */
export function updateSceneAccessibility(adapter: SceneAccessibility): void {
    if (adapter._disposed) {
        throw new Error("Scene accessibility is disposed.");
    }
    batchAccessibilityUpdates(adapter.tree, () => {
        const retained = new Set<SceneNode>();
        const visit = (source: SceneNode): void => {
            if (retained.has(source) || disposed(source)) {
                return;
            }
            retained.add(source);
            for (const child of source.children) {
                visit(child);
            }
            if (isNode(source.parent)) {
                visit(source.parent);
            }
        };
        for (const source of [...adapter._scene.meshes, ...adapter._scene.lights, ...adapter._roots]) {
            visit(source);
        }
        if (isNode(adapter._scene.camera)) {
            visit(adapter._scene.camera);
        }
        for (const source of adapter._bindings.keys()) {
            if (!retained.has(source)) {
                unbind(adapter, source);
            }
        }
        for (const source of retained) {
            adapter._removed.delete(source);
            bind(adapter, source);
            updateSource(adapter, source);
        }
    });
}

/** Assign metadata. Replacing a tag schedules all mounted scene bindings, including shared nodes. */
export function setAccessibilityTag(node: object, tag: AccessibilityTag | null): void {
    const snapshot = _snapshotAccessibilityTag(tag);
    for (const validate of tagValidators?.get(node) ?? []) {
        validate(snapshot);
    }
    if (snapshot) {
        (tags ??= new WeakMap()).set(node, snapshot);
    } else {
        tags?.delete(node);
    }
    for (const listener of tagObservers?.get(node) ?? []) {
        listener();
    }
}

/** Read a frozen metadata snapshot. Clones have no tag unless explicitly assigned one. */
export function getAccessibilityTag(node: object): AccessibilityTag | null {
    return tags?.get(node) ?? null;
}

/** Retrieve the stable semantic representation of a registered native node. */
export function getAccessibilityNode(adapter: SceneAccessibility, node: SceneNode): AccessibilityNode | undefined {
    return adapter._bindings.get(node)?.node;
}

/** Override logical grouping without changing transforms. Pass undefined to restore transform parentage. */
export function setAccessibilityParent(adapter: SceneAccessibility, source: SceneNode, parent: SceneNode | null | undefined): void {
    const node = getAccessibilityNode(adapter, source);
    const parentNode = parent ? getAccessibilityNode(adapter, parent) : null;
    if (!node || (parent && !parentNode)) {
        throw new Error("Semantic parent and child must belong to the scene accessibility binding.");
    }
    const actualParent = parent === undefined && isNode(source.parent) ? getAccessibilityNode(adapter, source.parent) : parentNode;
    updateAccessibilityNode(adapter.tree, node, { parent: actualParent ?? null });
    if (parent === undefined) {
        adapter._parents.delete(source);
    } else {
        adapter._parents.set(source, parent);
    }
}

/** Bind before scene population to include empty transform nodes automatically, or supply explicit roots. */
export function createSceneAccessibility(scene: SceneContext, options: SceneAccessibilityOptions = {}): SceneAccessibility {
    if (scene._z) {
        throw new Error("Cannot bind accessibility to a disposed scene.");
    }
    const adapter: SceneAccessibility = {
        tree: createAccessibilityTree(),
        _scene: scene,
        _bindings: new Map(),
        _dispose: () => disposeSceneAccessibility(adapter),
        _pending: false,
        _disposed: false,
        _dirty: new Set(),
        _parents: new Map(),
        _removed: new WeakSet(),
        _roots: new Set(options.roots ?? []),
    };
    const registry = (sceneObservers ??= new WeakMap());
    let observers = registry.get(scene);
    if (!observers) {
        observers = { adapters: new Set() };
        registry.set(scene, observers);
    }
    if (activeAdapters++ === 0) {
        previousNodeChanged = sceneNodeChanged;
        setSceneNodeChanged(nodeChanged);
    }
    observers.adapters.add(adapter);
    scene._disposables.push(adapter._dispose);
    try {
        for (const root of [...scene.meshes, ...scene.lights, ...(options.roots ?? [])]) {
            bind(adapter, root);
        }
        if (isNode(scene.camera)) {
            bind(adapter, scene.camera);
        }
        updateSceneAccessibility(adapter);
    } catch (error) {
        disposeSceneAccessibility(adapter);
        throw error;
    }
    return adapter;
}

/** Release observers, semantic objects, and any HTML twins listening to this adapter's tree. */
export function disposeSceneAccessibility(adapter: SceneAccessibility): void {
    if (adapter._disposed) {
        return;
    }
    adapter._disposed = true;
    for (const binding of adapter._bindings.values()) {
        binding.unsubscribe.forEach((unsubscribe) => unsubscribe());
    }
    adapter._bindings.clear();
    adapter._roots.clear();
    adapter._dirty.clear();
    adapter._parents.clear();
    const scene = adapter._scene;
    const observers = sceneObservers?.get(scene);
    observers?.adapters.delete(adapter);
    if (observers?.adapters.size === 0) {
        sceneObservers?.delete(scene);
    }
    if (--activeAdapters === 0) {
        setSceneNodeChanged(previousNodeChanged);
        previousNodeChanged = null;
    }
    const index = scene._disposables.indexOf(adapter._dispose);
    if (index !== -1) {
        scene._disposables.splice(index, 1);
    }
    disposeAccessibilityTree(adapter.tree);
}
