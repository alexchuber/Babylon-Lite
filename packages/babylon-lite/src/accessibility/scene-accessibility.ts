import type { SceneContext } from "../scene/scene-core.js";
import type { SceneNode } from "../scene/scene-node.js";
import type { Camera } from "../camera/camera.js";
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
import { registerSceneDisposeOverride } from "../scene/scene-dispose-registration.js";

type SceneSource = SceneNode | Camera;
type MembershipKind = "automatic" | "explicit" | "camera";

interface SceneMembership {
    root: SceneSource | null;
    kind: MembershipKind;
}

/** Optional explicit roots for logical/empty nodes that the rendering scene does not retain. */
export interface SceneAccessibilityOptions {
    roots?: readonly (SceneNode | Camera)[];
}

interface NodeBinding {
    node: AccessibilityNode;
    unsubscribe: (() => void)[];
    memberships: Set<SceneMembership>;
    pendingState?: Pick<AccessibilityNode, "tag" | "hidden" | "disabled">;
}

/** Opt-in adapter. The scene owns its binding, never the component. */
export interface SceneAccessibility {
    readonly tree: AccessibilityTree;
    /** @internal */
    _scene: SceneContext;
    /** @internal */
    _bindings: Map<SceneSource, NodeBinding>;
    /** @internal */
    _unobserveCamera: () => void;
    /** @internal */
    _pending: boolean;
    /** @internal */
    _disposed: boolean;
    /** @internal */
    _dirty: Set<SceneSource>;
    /** @internal Natural parent changes that require localized automatic provenance normalization. */
    _membershipDirty: Set<SceneSource>;
    /** @internal Automatic claims already known to intersect the localized normalization batch. */
    _membershipDirtyTokens: Set<SceneMembership>;
    /** @internal */
    _parents: Map<SceneSource, SceneSource | null>;
    /** @internal Semantic children indexed by their explicit parent override. */
    _semanticChildren: Map<SceneSource, Set<SceneSource>>;
    /** @internal */
    _removed: WeakSet<SceneSource>;
    /** @internal */
    _explicitRoots: Set<SceneSource>;
    /** @internal Current natural-hierarchy roots for normalized automatic memberships. */
    _automaticRoots: Set<SceneSource>;
    /** @internal Exact canonical entries reported by addToScene or rebuilt from scene collections. */
    _automaticSources: Set<SceneSource>;
    /** @internal Stable provenance tokens keep explicit, automatic, and camera membership independent. */
    _membershipTokens: {
        explicit: Map<SceneSource, SceneMembership>;
        automatic: Map<SceneSource, SceneMembership>;
        camera: SceneMembership;
    };
    /** @internal */
    _memberships: Map<SceneMembership, Set<SceneSource>>;
}

interface SceneObservers {
    adapters: Set<SceneAccessibility>;
}

let sceneObservers: WeakMap<SceneContext, SceneObservers> | undefined;
let activeAdapters = 0;
let previousNodeChanged: typeof sceneNodeChanged = null;
let unregisterDispose: (() => void) | undefined;
let tags: WeakMap<object, AccessibilityTag> | undefined;
let tagObservers: WeakMap<object, Set<() => void>> | undefined;
let tagValidators: WeakMap<object, Set<(tag: AccessibilityTag | null) => void>> | undefined;

function isNode(value: unknown): value is SceneSource {
    return typeof value === "object" && value !== null && "children" in value && Array.isArray(value.children) && "worldMatrix" in value;
}

function parentOf(source: SceneSource): unknown {
    return "parent" in source ? source.parent : null;
}

function setSemanticParentOverride(adapter: SceneAccessibility, source: SceneSource, parent: SceneSource | null | undefined): void {
    const previous = adapter._parents.get(source);
    if (adapter._parents.has(source) && isNode(previous)) {
        const siblings = adapter._semanticChildren.get(previous);
        siblings?.delete(source);
        if (siblings?.size === 0) {
            adapter._semanticChildren.delete(previous);
        }
    }
    if (parent === undefined) {
        adapter._parents.delete(source);
        return;
    }
    adapter._parents.set(source, parent);
    if (parent) {
        let children = adapter._semanticChildren.get(parent);
        if (!children) {
            children = new Set();
            adapter._semanticChildren.set(parent, children);
        }
        children.add(source);
    }
}

function disposeOwned(scene: SceneContext, cleanup: () => void): void {
    const errors: unknown[] = [];
    for (const adapter of [...(sceneObservers?.get(scene)?.adapters ?? [])]) {
        try {
            disposeSceneAccessibility(adapter);
        } catch (error) {
            errors.push(error);
        }
    }
    try {
        cleanup();
    } catch (error) {
        errors.push(error);
    }
    if (errors.length) {
        throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Scene and accessibility cleanup failed.");
    }
}

function membership(adapter: SceneAccessibility, kind: "automatic" | "explicit", root: SceneSource): SceneMembership {
    const memberships = adapter._membershipTokens[kind];
    let token = memberships.get(root);
    if (!token) {
        token = { root, kind };
        memberships.set(root, token);
    }
    return token;
}

function automaticMembership(adapter: SceneAccessibility, source: SceneSource): SceneMembership {
    const existing = adapter._bindings.get(source);
    for (const sourceMembership of existing?.memberships ?? []) {
        if (sourceMembership.kind === "automatic") {
            return sourceMembership;
        }
    }
    const parent = parentOf(source);
    if (isNode(parent)) {
        for (const sourceMembership of adapter._bindings.get(parent)?.memberships ?? []) {
            if (sourceMembership.kind === "automatic") {
                return sourceMembership;
            }
        }
    }
    const root = hierarchyRoots([source]).get(source)!;
    adapter._automaticRoots.add(root);
    return membership(adapter, "automatic", root);
}

function nodeChanged(scene: SceneContext, node: unknown, added: boolean): void {
    previousNodeChanged?.(scene, node, added);
    for (const target of sceneObservers?.get(scene)?.adapters ?? []) {
        if (isNode(node)) {
            if (added) {
                batchAccessibilityUpdates(target.tree, () => {
                    target._automaticSources.add(node);
                    bind(target, node, automaticMembership(target, node), true, true);
                    schedule(target, node);
                });
            } else {
                batchAccessibilityUpdates(target.tree, () => {
                    target._automaticSources.delete(node);
                    const binding = target._bindings.get(node);
                    for (const sourceMembership of binding?.memberships ?? []) {
                        if (sourceMembership.kind === "automatic") {
                            target._membershipDirtyTokens.add(sourceMembership);
                        }
                    }
                    releaseAutomaticSource(target, node);
                    target._membershipDirty.add(node);
                    queueFlush(target);
                });
            }
        }
    }
}

function disposed(node: SceneSource): boolean {
    return "_disposed" in node && node._disposed === true;
}

function sourceState(source: SceneSource, tag = getAccessibilityTag(source)): Pick<AccessibilityNode, "tag" | "hidden" | "disabled"> & { _derivedState: true } {
    return {
        tag: tag && (!("visible" in source) || source.visible !== false) ? _snapshotAccessibilityTag({ ...tag, name: tag.name ?? tag.description ?? source.name }) : null,
        hidden: disposed(source) || tag?.hidden === true,
        disabled: tag?.disabled === true,
        _derivedState: true,
    };
}

function sourceAvailable(adapter: SceneAccessibility, source: SceneSource): boolean {
    if (adapter._disposed || adapter._scene._z) {
        return false;
    }
    for (let current: SceneSource | null = source; current;) {
        const tag = getAccessibilityTag(current);
        if (
            disposed(current) ||
            adapter._removed.has(current) ||
            tag?.hidden ||
            tag?.disabled ||
            String(tag?.aria?.["aria-hidden"]) === "true" ||
            String(tag?.aria?.["aria-disabled"]) === "true"
        ) {
            return false;
        }
        const parent: unknown = adapter._parents.has(current) ? adapter._parents.get(current) : parentOf(current);
        current = isNode(parent) ? parent : null;
    }
    return true;
}

function queueFlush(adapter: SceneAccessibility): void {
    if (adapter._pending || adapter._disposed) {
        return;
    }
    adapter._pending = true;
    queueMicrotask(() => {
        adapter._pending = false;
        if (!adapter._disposed) {
            batchAccessibilityUpdates(adapter.tree, () => {
                flushDirty(adapter);
            });
        }
    });
}

function schedule(adapter: SceneAccessibility, source: SceneSource, membershipChanged = false): void {
    const binding = adapter._bindings.get(source);
    if (binding) {
        binding.pendingState ??= { tag: binding.node.tag, hidden: binding.node.hidden, disabled: binding.node.disabled };
        const state = sourceState(source);
        Object.assign(binding.node, { tag: state.tag, hidden: state.hidden, disabled: state.disabled });
    }
    adapter._dirty.add(source);
    if (membershipChanged) {
        adapter._membershipDirty.add(source);
    }
    queueFlush(adapter);
}

function bind(adapter: SceneAccessibility, source: SceneSource, sourceMembership: SceneMembership, descendants = true, revive = false): AccessibilityNode | undefined {
    if (revive) {
        adapter._removed.delete(source);
    }
    if (disposed(source) || adapter._removed.has(source)) {
        return undefined;
    }
    const existing = adapter._bindings.get(source);
    if (existing?.memberships.has(sourceMembership)) {
        return existing.node;
    }
    const node = existing?.node ?? addAccessibilityNode(adapter.tree, { target: source, ...sourceState(source) });
    const binding: NodeBinding = existing ?? { node, unsubscribe: [], memberships: new Set() };
    binding.memberships.add(sourceMembership);
    let members = adapter._memberships.get(sourceMembership);
    if (!members) {
        members = new Set();
        adapter._memberships.set(sourceMembership, members);
    }
    members.add(source);
    adapter._bindings.set(source, binding);
    if (!existing) {
        node._available = () => sourceAvailable(adapter, source);
        for (const property of ["name", "visible", "_disposed"]) {
            binding.unsubscribe.push(observeProperty(source, property, () => schedule(adapter, source)));
        }
        binding.unsubscribe.push(observeProperty(source, "parent", () => schedule(adapter, source, true)));
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
    }
    const sourceParent = parentOf(source);
    if (isNode(sourceParent)) {
        const parent = bind(adapter, sourceParent, sourceMembership, false, revive);
        if (!adapter._parents.has(source)) {
            updateAccessibilityNode(adapter.tree, node, { parent: parent ?? null });
        }
    }
    if (descendants) {
        for (const child of source.children) {
            bind(adapter, child, sourceMembership, true, revive);
        }
    }
    return node;
}

function releaseAutomaticSource(adapter: SceneAccessibility, source: SceneSource): void {
    const binding = adapter._bindings.get(source);
    if (!binding) {
        adapter._removed.add(source);
        return;
    }
    for (const sourceMembership of [...binding.memberships]) {
        if (sourceMembership.kind === "automatic") {
            binding.memberships.delete(sourceMembership);
            adapter._memberships.get(sourceMembership)?.delete(source);
        }
    }
    if (binding.memberships.size) {
        adapter._removed.delete(source);
        updateSource(adapter, source);
    } else {
        adapter._removed.add(source);
        unbind(adapter, source, false);
    }
}

function isAncestor(adapter: SceneAccessibility, ancestor: SceneSource, source: SceneSource): boolean {
    const pending = [source];
    const visited = new Set<SceneSource>();
    while (pending.length) {
        const current = pending.pop()!;
        if (current === ancestor) {
            return true;
        }
        if (!visited.has(current)) {
            visited.add(current);
            for (const parent of [parentOf(current), adapter._parents.get(current)]) {
                if (isNode(parent)) {
                    pending.push(parent);
                }
            }
        }
    }
    return false;
}

function updateCamera(adapter: SceneAccessibility): void {
    batchAccessibilityUpdates(adapter.tree, () => {
        // A same-task reparent may retain the old camera before its queued source update.
        flushDirty(adapter);
        const cameraMembership = adapter._membershipTokens.camera;
        const previous = adapter._memberships.get(cameraMembership);
        adapter._memberships.delete(cameraMembership);
        for (const source of previous ?? []) {
            adapter._bindings.get(source)?.memberships.delete(cameraMembership);
        }
        if (isNode(adapter._scene.camera)) {
            bind(adapter, adapter._scene.camera, cameraMembership, true, true);
        }
        for (const source of previous ?? []) {
            const binding = adapter._bindings.get(source);
            // Reparenting can retire an independent root's old ancestor relationship.
            for (const retained of binding?.memberships ?? []) {
                const root = retained.root;
                if (root && !isAncestor(adapter, source, root) && !isAncestor(adapter, root, source)) {
                    binding?.memberships.delete(retained);
                    adapter._memberships.get(retained)?.delete(source);
                }
            }
            if (binding?.memberships.size === 0) {
                unbind(adapter, source, false);
            }
        }
    });
}

function unbind(adapter: SceneAccessibility, source: SceneSource, removed = true): void {
    const binding = adapter._bindings.get(source);
    if (!binding) {
        return;
    }
    if (removed) {
        adapter._removed.add(source);
        adapter._explicitRoots.delete(source);
        adapter._automaticRoots.delete(source);
    }
    setSemanticParentOverride(adapter, source, undefined);
    binding.unsubscribe.forEach((unsubscribe) => unsubscribe());
    adapter._bindings.delete(source);
    for (const sourceMembership of binding.memberships) {
        adapter._memberships.get(sourceMembership)?.delete(source);
    }
    batchAccessibilityUpdates(adapter.tree, () => {
        for (const child of [...binding.node.children]) {
            updateAccessibilityNode(adapter.tree, child, { parent: binding.node.parent });
        }
        removeAccessibilityNode(adapter.tree, binding.node);
        const semanticChildren = adapter._semanticChildren.get(source);
        adapter._semanticChildren.delete(source);
        for (const child of semanticChildren ?? []) {
            adapter._parents.delete(child);
            updateSource(adapter, child);
        }
    });
}

/** Reconcile one source after an observed property write or immutable tag replacement. */
function updateSource(adapter: SceneAccessibility, source: SceneSource): void {
    const binding = adapter._bindings.get(source);
    if (!binding) {
        return;
    }
    if (disposed(source)) {
        unbind(adapter, source);
        return;
    }
    if (binding.pendingState) {
        Object.assign(binding.node, binding.pendingState);
        binding.pendingState = undefined;
    }
    const sourceParent = adapter._parents.has(source) ? adapter._parents.get(source) : parentOf(source);
    if (isNode(sourceParent)) {
        for (const sourceMembership of binding.memberships) {
            bind(adapter, sourceParent, sourceMembership, false);
        }
    }
    const parent = isNode(sourceParent) ? adapter._bindings.get(sourceParent)?.node : undefined;
    updateAccessibilityNode(adapter.tree, binding.node, {
        ...sourceState(source),
        parent: parent ?? null,
    });
}

function hierarchyRoots(sources: readonly SceneSource[]): Map<SceneSource, SceneSource> {
    const roots = new Map<SceneSource, SceneSource>();
    const path: SceneSource[] = [];
    const pending = new Set<SceneSource>();
    for (const source of sources) {
        if (roots.has(source)) {
            continue;
        }
        path.length = 0;
        pending.clear();
        let current = source;
        let root: SceneSource;
        for (;;) {
            const cached = roots.get(current);
            if (cached) {
                root = cached;
                break;
            }
            path.push(current);
            pending.add(current);
            const parent = parentOf(current);
            if (!isNode(parent) || pending.has(parent)) {
                root = current;
                break;
            }
            current = parent;
        }
        for (const member of path) {
            roots.set(member, root);
        }
    }
    return roots;
}

interface AutomaticComponent {
    root: SceneSource;
    covered: Set<SceneSource>;
}

function reconcileAutomaticMemberships(adapter: SceneAccessibility, dirtySources: readonly SceneSource[], dirtyMemberships: readonly SceneMembership[]): void {
    if (!dirtySources.length && !dirtyMemberships.length) {
        return;
    }
    const pending: SceneSource[] = [];
    const encountered = new Set<SceneSource>();
    const oldMemberships = new Set<SceneMembership>();
    const expandedMemberships = new Set<SceneMembership>();
    const enqueue = (source: SceneSource | null | undefined): void => {
        if (source && !encountered.has(source)) {
            pending.push(source);
        }
    };
    const expandMembership = (sourceMembership: SceneMembership): void => {
        if (sourceMembership.kind !== "automatic" || expandedMemberships.has(sourceMembership)) {
            return;
        }
        expandedMemberships.add(sourceMembership);
        oldMemberships.add(sourceMembership);
        enqueue(sourceMembership.root);
        for (const member of adapter._memberships.get(sourceMembership) ?? []) {
            enqueue(member);
        }
    };
    for (const source of dirtySources) {
        enqueue(source);
    }
    for (const sourceMembership of dirtyMemberships) {
        expandMembership(sourceMembership);
    }
    while (pending.length) {
        const source = pending.pop()!;
        if (encountered.has(source)) {
            continue;
        }
        encountered.add(source);
        const previousParent = adapter._bindings.get(source)?.node.parent?.target;
        if (isNode(previousParent)) {
            enqueue(previousParent);
        }
        const currentParent = parentOf(source);
        if (isNode(currentParent)) {
            enqueue(currentParent);
        }
        for (const sourceMembership of adapter._bindings.get(source)?.memberships ?? []) {
            expandMembership(sourceMembership);
        }
    }

    const children = new Map<SceneSource, SceneSource[]>();
    for (const source of encountered) {
        const parent = parentOf(source);
        if (isNode(parent) && encountered.has(parent)) {
            const siblings = children.get(parent);
            if (siblings) {
                siblings.push(source);
            } else {
                children.set(parent, [source]);
            }
        }
    }
    const components: AutomaticComponent[] = [];
    const ungrouped = new Set(encountered);
    for (const start of encountered) {
        if (!ungrouped.delete(start)) {
            continue;
        }
        const component = new Set<SceneSource>([start]);
        const componentPending = [start];
        while (componentPending.length) {
            const source = componentPending.pop()!;
            const parent = parentOf(source);
            if (isNode(parent) && ungrouped.delete(parent)) {
                component.add(parent);
                componentPending.push(parent);
            }
            for (const child of children.get(source) ?? []) {
                if (ungrouped.delete(child)) {
                    component.add(child);
                    componentPending.push(child);
                }
            }
        }
        const automaticSources = [...component].filter((source) => adapter._automaticSources.has(source));
        if (!automaticSources.length) {
            continue;
        }
        const covered = new Set<SceneSource>();
        for (const source of automaticSources) {
            const descendants = [source];
            while (descendants.length) {
                const descendant = descendants.pop()!;
                if (!component.has(descendant) || covered.has(descendant)) {
                    continue;
                }
                covered.add(descendant);
                descendants.push(...(children.get(descendant) ?? []));
            }
            const sourceParent = parentOf(source);
            for (let current: SceneSource | null = isNode(sourceParent) ? sourceParent : null; current && component.has(current) && !covered.has(current);) {
                covered.add(current);
                const parent = parentOf(current);
                current = isNode(parent) ? parent : null;
            }
        }
        let root = automaticSources[0]!;
        const visited = new Set<SceneSource>();
        for (;;) {
            const parent = parentOf(root);
            if (!isNode(parent) || !covered.has(parent) || visited.has(parent)) {
                break;
            }
            visited.add(root);
            root = parent;
        }
        components.push({ root, covered });
    }

    const affected = new Set(encountered);
    for (const sourceMembership of oldMemberships) {
        for (const source of adapter._memberships.get(sourceMembership) ?? []) {
            adapter._bindings.get(source)?.memberships.delete(sourceMembership);
            affected.add(source);
        }
        adapter._memberships.delete(sourceMembership);
        if (sourceMembership.root) {
            adapter._automaticRoots.delete(sourceMembership.root);
            if (adapter._membershipTokens.automatic.get(sourceMembership.root) === sourceMembership) {
                adapter._membershipTokens.automatic.delete(sourceMembership.root);
            }
        }
    }
    for (const component of components) {
        adapter._automaticRoots.add(component.root);
        const sourceMembership = membership(adapter, "automatic", component.root);
        for (const source of component.covered) {
            bind(adapter, source, sourceMembership, false, true);
        }
    }
    for (const source of affected) {
        const binding = adapter._bindings.get(source);
        if (binding && binding.memberships.size === 0) {
            unbind(adapter, source, false);
        }
    }
}

function flushDirty(adapter: SceneAccessibility): void {
    const dirty = [...adapter._dirty];
    const membershipDirty = [...adapter._membershipDirty];
    const membershipDirtyTokens = [...adapter._membershipDirtyTokens];
    adapter._dirty.clear();
    adapter._membershipDirty.clear();
    adapter._membershipDirtyTokens.clear();
    reconcileAutomaticMemberships(adapter, membershipDirty, membershipDirtyTokens);
    for (const source of dirty) {
        updateSource(adapter, source);
    }
}

/** Refresh after direct scene-array edits. Canonical mutations update only changed source nodes. */
export function updateSceneAccessibility(adapter: SceneAccessibility): void {
    if (adapter._disposed) {
        throw new Error("Scene accessibility is disposed.");
    }
    batchAccessibilityUpdates(adapter.tree, () => {
        const canonicalSources = [...adapter._scene.meshes, ...adapter._scene.lights];
        adapter._dirty.clear();
        adapter._membershipDirty.clear();
        adapter._membershipDirtyTokens.clear();
        adapter._automaticSources.clear();
        for (const source of canonicalSources) {
            adapter._automaticSources.add(source);
        }
        const roots = hierarchyRoots(canonicalSources);
        const canonicalRoots = new Set<SceneSource>();
        for (const source of canonicalSources) {
            canonicalRoots.add(roots.get(source)!);
        }
        adapter._automaticRoots.clear();
        for (const root of canonicalRoots) {
            adapter._automaticRoots.add(root);
        }
        for (const [root] of adapter._membershipTokens.automatic) {
            if (!canonicalRoots.has(root)) {
                adapter._membershipTokens.automatic.delete(root);
            }
        }
        adapter._memberships.clear();
        for (const binding of adapter._bindings.values()) {
            binding.memberships.clear();
        }
        for (const source of canonicalSources) {
            const root = roots.get(source)!;
            bind(adapter, source, membership(adapter, "automatic", root), true, true);
        }
        for (const root of adapter._explicitRoots) {
            bind(adapter, root, membership(adapter, "explicit", root), true, true);
        }
        if (isNode(adapter._scene.camera)) {
            bind(adapter, adapter._scene.camera, adapter._membershipTokens.camera, true, true);
        }
        for (const [source, binding] of adapter._bindings) {
            if (binding.memberships.size) {
                updateSource(adapter, source);
            }
        }
        for (const [source, binding] of adapter._bindings) {
            if (!binding.memberships.size) {
                unbind(adapter, source, false);
            }
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
export function getAccessibilityNode(adapter: SceneAccessibility, node: SceneNode | Camera): AccessibilityNode | undefined {
    return adapter._bindings.get(node)?.node;
}

/** Override logical grouping without changing transforms. Pass undefined to restore transform parentage. */
export function setAccessibilityParent(adapter: SceneAccessibility, source: SceneNode | Camera, parent: SceneNode | Camera | null | undefined): void {
    const node = getAccessibilityNode(adapter, source);
    const parentNode = parent ? getAccessibilityNode(adapter, parent) : null;
    if (!node || (parent && !parentNode)) {
        throw new Error("Semantic parent and child must belong to the scene accessibility binding.");
    }
    const naturalParent = parentOf(source);
    const actualParent = parent === undefined && isNode(naturalParent) ? getAccessibilityNode(adapter, naturalParent) : parentNode;
    batchAccessibilityUpdates(adapter.tree, () => {
        updateAccessibilityNode(adapter.tree, node, { parent: actualParent ?? null });
        setSemanticParentOverride(adapter, source, parent);
        updateSource(adapter, source);
    });
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
        _unobserveCamera: () => {},
        _pending: false,
        _disposed: false,
        _dirty: new Set(),
        _membershipDirty: new Set(),
        _membershipDirtyTokens: new Set(),
        _parents: new Map(),
        _semanticChildren: new Map(),
        _removed: new WeakSet(),
        _explicitRoots: new Set(options.roots ?? []),
        _automaticRoots: new Set(),
        _automaticSources: new Set(),
        _membershipTokens: {
            explicit: new Map(),
            automatic: new Map(),
            camera: { root: null, kind: "camera" },
        },
        _memberships: new Map(),
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
        unregisterDispose = registerSceneDisposeOverride(disposeOwned);
    }
    observers.adapters.add(adapter);
    try {
        adapter._unobserveCamera = observeProperty(scene, "camera", () => updateCamera(adapter));
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
    adapter._unobserveCamera();
    for (const binding of adapter._bindings.values()) {
        binding.unsubscribe.forEach((unsubscribe) => unsubscribe());
    }
    adapter._bindings.clear();
    adapter._explicitRoots.clear();
    adapter._automaticRoots.clear();
    adapter._automaticSources.clear();
    adapter._membershipTokens.explicit.clear();
    adapter._membershipTokens.automatic.clear();
    adapter._dirty.clear();
    adapter._membershipDirty.clear();
    adapter._membershipDirtyTokens.clear();
    adapter._parents.clear();
    adapter._semanticChildren.clear();
    adapter._memberships.clear();
    const scene = adapter._scene;
    const observers = sceneObservers?.get(scene);
    observers?.adapters.delete(adapter);
    if (observers?.adapters.size === 0) {
        sceneObservers?.delete(scene);
    }
    if (--activeAdapters === 0) {
        setSceneNodeChanged(previousNodeChanged);
        previousNodeChanged = null;
        unregisterDispose?.();
        unregisterDispose = undefined;
    }
    disposeAccessibilityTree(adapter.tree);
}
