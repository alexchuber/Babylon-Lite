/** Semantic metadata shared by scene objects and native HTML controls. */
export interface AccessibilityTag {
    /** Accessible name. When absent, the Babylon-compatible description is used as the name. */
    name?: string;
    description?: string;
    role?: string;
    /** Suppress the object and its descendants from the accessible representation. */
    hidden?: boolean;
    /** Expose the object but prevent interaction with it and its descendants. */
    disabled?: boolean;
    /** Native focus eligibility. Positive tab order is deliberately unsupported. */
    tabIndex?: 0 | -1;
    aria?: Readonly<Record<`aria-${string}`, string | number | boolean | null | undefined>>;
    eventHandler?: {
        click?: (event: MouseEvent) => void;
        contextmenu?: (event: MouseEvent | KeyboardEvent) => void;
        focus?: (event: FocusEvent) => void;
        blur?: (event: FocusEvent) => void;
    };
}

/** @internal Validate and snapshot metadata before changing any tree or target. */
export function _snapshotAccessibilityTag(tag: AccessibilityTag | null | undefined): AccessibilityTag | null {
    if (!tag) {
        return null;
    }
    if (tag.tabIndex !== undefined && tag.tabIndex !== 0 && tag.tabIndex !== -1) {
        throw new RangeError("Accessibility tabIndex must be 0 or -1.");
    }
    for (const [key, value] of Object.entries(tag.aria ?? {})) {
        if (!/^aria-[a-z-]+$/.test(key) || (value != null && !["string", "number", "boolean"].includes(typeof value)) || (typeof value === "number" && !Number.isFinite(value))) {
            throw new Error(`Invalid accessibility attribute: ${key}`);
        }
    }
    for (const key of Object.keys(tag.eventHandler ?? {})) {
        if (!["click", "contextmenu", "focus", "blur"].includes(key)) {
            throw new Error(`Unsupported accessibility event: ${key}. Use click, contextmenu, focus, or blur.`);
        }
    }
    for (const [state, aria] of [
        ["hidden", "aria-hidden"],
        ["disabled", "aria-disabled"],
    ] as const) {
        if (tag[state] !== undefined && tag.aria?.[aria] != null && String(tag[state]) !== String(tag.aria[aria])) {
            throw new Error(`Conflicting accessibility state: ${state} and ${aria}.`);
        }
    }
    return Object.freeze({
        ...tag,
        aria: tag.aria ? Object.freeze({ ...tag.aria }) : undefined,
        eventHandler: tag.eventHandler ? Object.freeze({ ...tag.eventHandler }) : undefined,
    });
}

/** Options used to register or update one logical object. */
export interface AccessibilityNodeOptions {
    tag?: AccessibilityTag | null;
    parent?: AccessibilityNode | null;
    /** Insert before a sibling; null appends. Omit to preserve the existing position. */
    before?: AccessibilityNode | null;
    hidden?: boolean;
    disabled?: boolean;
    /** Application object represented by this node. Never disposed by accessibility. */
    target?: object;
    /** A real native control to host instead of generating a button or description. */
    element?: HTMLElement;
}

/** Logical object. Change its state through {@link updateAccessibilityNode}. */
export interface AccessibilityNode {
    tag: AccessibilityTag | null;
    parent: AccessibilityNode | null;
    readonly children: readonly AccessibilityNode[];
    hidden: boolean;
    disabled: boolean;
    target?: object;
    element?: HTMLElement;
    /** @internal */
    _children: AccessibilityNode[];
}

/** Logical scene or UI hierarchy, independent of rendering backend. */
export interface AccessibilityTree {
    readonly roots: readonly AccessibilityNode[];
    readonly disposed: boolean;
    /** @internal */
    _roots: AccessibilityNode[];
    /** @internal */
    _nodes: Set<AccessibilityNode>;
    /** @internal */
    _listeners: Set<() => void>;
    /** @internal */
    _validators: Set<(options: AccessibilityNodeOptions, node?: AccessibilityNode) => void>;
    /** @internal */
    _disposed: boolean;
    /** @internal */
    _batchDepth?: number;
    /** @internal */
    _dirty?: boolean;
}

/** Create an empty semantic tree. No DOM or global state is accessed. */
export function createAccessibilityTree(): AccessibilityTree {
    const roots: AccessibilityNode[] = [];
    return {
        roots,
        _roots: roots,
        _nodes: new Set(),
        _listeners: new Set(),
        _validators: new Set(),
        _disposed: false,
        get disposed() {
            return this._disposed;
        },
    };
}

function requireTree(tree: AccessibilityTree, node?: AccessibilityNode): void {
    if (tree.disposed) {
        throw new Error("Accessibility tree is disposed.");
    }
    if (node && !tree._nodes.has(node)) {
        throw new Error("Accessibility node does not belong to this tree.");
    }
}

function notify(tree: AccessibilityTree): void {
    if (tree._batchDepth) {
        tree._dirty = true;
        return;
    }
    const errors: unknown[] = [];
    for (const listener of [...tree._listeners]) {
        try {
            listener();
        } catch (error) {
            errors.push(error);
        }
    }
    if (errors.length) {
        throw errors.length === 1 ? errors[0] : new AggregateError(errors, "Accessibility tree observers failed.");
    }
}

/** Coalesce a synchronous group of semantic mutations into one completed change notification. */
export function batchAccessibilityUpdates(tree: AccessibilityTree, update: () => void): void {
    requireTree(tree);
    tree._batchDepth = (tree._batchDepth ?? 0) + 1;
    try {
        update();
    } finally {
        tree._batchDepth--;
        if (!tree._batchDepth && tree._dirty) {
            tree._dirty = false;
            notify(tree);
        }
    }
}

/** Observe completed tree changes. The returned function removes the observer. */
export function onAccessibilityTreeChanged(tree: AccessibilityTree, listener: () => void): () => void {
    requireTree(tree);
    tree._listeners.add(listener);
    return () => tree._listeners.delete(listener);
}

function validateElement(tree: AccessibilityTree, element: HTMLElement | undefined, owner?: AccessibilityNode): void {
    if (!element) {
        return;
    }
    for (const node of tree._nodes) {
        if (node !== owner && node.element && (node.element.contains(element) || element.contains(node.element))) {
            throw new Error("A native control cannot have overlapping accessibility owners.");
        }
    }
}

/** Register one semantic object or native control. */
export function addAccessibilityNode(tree: AccessibilityTree, options: AccessibilityNodeOptions): AccessibilityNode {
    requireTree(tree, options.parent ?? undefined);
    const tag = _snapshotAccessibilityTag(options.tag);
    if (options.before && (!tree._nodes.has(options.before) || options.before.parent !== (options.parent ?? null))) {
        throw new Error("Accessibility ordering requires a sibling in the same tree.");
    }
    validateElement(tree, options.element);
    for (const validate of tree._validators) {
        validate({ ...options, tag });
    }
    const children: AccessibilityNode[] = [];
    const node: AccessibilityNode = {
        tag,
        parent: options.parent ?? null,
        hidden: options.hidden ?? false,
        disabled: options.disabled ?? false,
        target: options.target,
        element: options.element,
        children,
        _children: children,
    };
    tree._nodes.add(node);
    const siblings = node.parent?._children ?? tree._roots;
    siblings.splice(options.before ? siblings.indexOf(options.before) : siblings.length, 0, node);
    notify(tree);
    return node;
}

function detach(tree: AccessibilityTree, node: AccessibilityNode): void {
    const siblings = node.parent?._children ?? tree._roots;
    const index = siblings.indexOf(node);
    if (index !== -1) {
        siblings.splice(index, 1);
    }
}

/** Apply a partial update, preserving node identity and sibling order unless reparented. */
export function updateAccessibilityNode(tree: AccessibilityTree, node: AccessibilityNode, patch: AccessibilityNodeOptions): void {
    requireTree(tree, node);
    const tag = "tag" in patch ? _snapshotAccessibilityTag(patch.tag) : node.tag;
    if (patch.before && (!tree._nodes.has(patch.before) || patch.before.parent !== (patch.parent === undefined ? node.parent : patch.parent))) {
        throw new Error("Accessibility ordering requires a sibling in the same tree.");
    }
    if ("element" in patch) {
        validateElement(tree, patch.element, node);
    }
    for (const validate of tree._validators) {
        validate({ ...node, ...patch, tag }, node);
    }
    if (patch.parent !== undefined && patch.parent !== node.parent) {
        requireTree(tree, patch.parent ?? undefined);
        for (let parent = patch.parent; parent; parent = parent.parent) {
            if (parent === node) {
                throw new Error("Accessibility parent would create a cycle.");
            }
        }
        detach(tree, node);
        node.parent = patch.parent;
        (node.parent?._children ?? tree._roots).push(node);
    }
    if ("tag" in patch) {
        node.tag = tag;
    }
    if (patch.before !== undefined && patch.before !== node) {
        detach(tree, node);
        const siblings = node.parent?._children ?? tree._roots;
        siblings.splice(patch.before ? siblings.indexOf(patch.before) : siblings.length, 0, node);
    }
    if (patch.hidden !== undefined) {
        node.hidden = patch.hidden;
    }
    if (patch.disabled !== undefined) {
        node.disabled = patch.disabled;
    }
    if ("target" in patch) {
        node.target = patch.target;
    }
    if ("element" in patch) {
        node.element = patch.element;
    }
    notify(tree);
}

function release(tree: AccessibilityTree, node: AccessibilityNode): void {
    for (const child of node.children) {
        release(tree, child);
    }
    node._children.length = 0;
    node.parent = null;
    node.target = undefined;
    node.element = undefined;
    node.tag = null;
    tree._nodes.delete(node);
}

/** Remove a node and all of its descendants. */
export function removeAccessibilityNode(tree: AccessibilityTree, node: AccessibilityNode): void {
    requireTree(tree, node);
    detach(tree, node);
    release(tree, node);
    notify(tree);
}

/** Dispose a tree and notify its consumers once before clearing every subscription. */
export function disposeAccessibilityTree(tree: AccessibilityTree): void {
    if (tree.disposed) {
        return;
    }
    for (const root of tree.roots) {
        release(tree, root);
    }
    tree._roots.length = 0;
    tree._disposed = true;
    try {
        notify(tree);
    } finally {
        tree._listeners.clear();
        tree._validators.clear();
    }
}
