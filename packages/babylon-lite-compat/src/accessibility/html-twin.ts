import {
    addAccessibilityNode,
    batchAccessibilityUpdates,
    createAccessibilityTree,
    createHtmlTwin,
    disposeAccessibilityTree,
    focusHtmlTwinNode,
    removeAccessibilityNode,
    showSceneFocusIndicator,
    updateAccessibilityNode,
} from "babylon-lite";
import type { AccessibilityNode, AccessibilityNodeOptions, AccessibilityTag, AccessibilityTree, HtmlTwin } from "babylon-lite";
import type { Scene } from "../scene/scene.js";
import type { IAccessibilityTag, Node } from "../node/node.js";
import type { AccessibilityNodeMutation } from "../scene/abstract-scene.js";
import { AbstractMesh, TransformNode } from "../meshes/meshes.js";
import { Light } from "../lights/lights.js";
import { ActionManager } from "../actions/actions.js";
import { unsupported } from "../error.js";

/** BJS's public renderer option plus explicit Lite DOM hosting options. No Babylon GUI controls are imported. */
export interface IHTMLTwinRendererOptions {
    addAllControls?: boolean;
    parentElement?: HTMLElement;
    canvas?: HTMLCanvasElement;
    label?: string;
    roots?: readonly Node[];
    focusBorder?: string;
}

let renderers: WeakMap<Scene, HTMLTwinRenderer> | undefined;

function findActionManager(source: Node, trigger: number): ActionManager | undefined {
    for (let current: Node | null = source; current; current = current.parent) {
        const manager = current.actionManager;
        if (manager && (current === source || manager.isRecursive) && manager.hasSpecificTrigger(trigger)) {
            return manager;
        }
    }
    return undefined;
}

/** Babylon-compatible public HTML twin facade over Lite's native DOM layer. */
export class HTMLTwinRenderer {
    public readonly tree: AccessibilityTree;
    public readonly view: HtmlTwin;
    private readonly _nodes = new Map<Node, AccessibilityNode>();
    private readonly _sources = new Map<AccessibilityNode, Node>();
    private readonly _dirty = new Set<Node>();
    private readonly _dirtySubtrees = new Set<Node>();
    private readonly _sortParents = new Set<AccessibilityNode | null>();
    private readonly _orders = new Map<AccessibilityNode, number>();
    private readonly _managers = new Map<Node, { manager: ActionManager; unsubscribe: () => void }>();
    private readonly _previous: Scene["_accessibilityNodeChanged"];
    private readonly _changed: (node: Node, mutation?: AccessibilityNodeMutation) => void;
    private readonly _previousValidation: Scene["_accessibilityTagChanging"];
    private readonly _validateTag: (node: Node, tag: IAccessibilityTag | null) => void;
    private readonly _onDispose: (scene: Scene) => void;
    private _pending = false;
    private _disposed = false;

    /** Render one view for the scene. Dispose it before mounting another view of the same compat scene. */
    public static Render(scene: Scene, options: IHTMLTwinRendererOptions = {}): HTMLTwinRenderer {
        if (options.addAllControls) {
            unsupported(
                "HTMLTwinRenderer.addAllControls",
                "Babylon GUI controls are not implemented. Use Lite createNativeControl and createHtmlOverlay for real native controls."
            );
        }
        if (renderers?.has(scene)) {
            throw new Error("The compat scene already has an HTML twin; dispose it before remounting.");
        }
        return new HTMLTwinRenderer(scene, options);
    }

    private constructor(
        private readonly _scene: Scene,
        private readonly _options: IHTMLTwinRendererOptions
    ) {
        const canvas = _options.canvas ?? _scene.getEngine().getRenderingCanvas();
        if (!canvas || !("ownerDocument" in canvas) || _scene._lite._z) {
            throw new Error("HTMLTwinRenderer requires a live scene and a DOM canvas.");
        }
        this.tree = createAccessibilityTree();
        this.view = createHtmlTwin(this.tree, {
            parent: _options.parentElement ?? canvas.parentElement ?? canvas.ownerDocument.body,
            canvas,
            label: _options.label ?? "Scene",
            focusVisual: (node) => {
                for (const [source, semantic] of this._nodes) {
                    if (semantic === node) {
                        const target = source instanceof TransformNode ? source._node : source instanceof Light ? source._lite : undefined;
                        return target ? showSceneFocusIndicator(_scene._lite, target, canvas, _options.focusBorder) : undefined;
                    }
                }
            },
        });
        this._previous = _scene._accessibilityNodeChanged;
        this._previousValidation = _scene._accessibilityTagChanging;
        this._validateTag = (source, tag): void => {
            this._previousValidation?.(source, tag);
            const node = this._nodes.get(source);
            if (node) {
                for (const validate of this.tree._validators) {
                    validate({ ...node, ...this._state(source, tag) }, node);
                }
            }
        };
        _scene._accessibilityTagChanging = this._validateTag;
        this._changed = (node, mutation = "local"): void => {
            this._previous?.(node, mutation);
            const semantic = this._nodes.get(node);
            if (semantic) {
                Object.assign(semantic, this._state(node));
            }
            if (mutation === "subtree") {
                this._dirtySubtrees.add(node);
            } else {
                this._dirty.add(node);
            }
            if (!this._pending) {
                this._pending = true;
                queueMicrotask(() => {
                    this._pending = false;
                    if (!this._disposed) {
                        batchAccessibilityUpdates(this.tree, () => {
                            const pending = [...this._dirtySubtrees];
                            const visited = new Set<Node>();
                            for (let index = 0; index < pending.length; index++) {
                                const source = pending[index]!;
                                if (visited.has(source)) {
                                    continue;
                                }
                                visited.add(source);
                                this._dirty.add(source);
                                pending.push(...source.getChildren());
                            }
                            this._dirtySubtrees.clear();
                            for (const source of this._dirty) {
                                this._update(source);
                            }
                            this._dirty.clear();
                            this._sortChanged();
                        });
                    }
                });
            }
        };
        _scene._accessibilityNodeChanged = this._changed;
        this._onDispose = _scene.onDisposeObservable.add(() => this.dispose());
        (renderers ??= new WeakMap()).set(_scene, this);
        try {
            this.refresh();
        } catch (error) {
            this.dispose();
            throw error;
        }
    }

    private _ensure(source: Node): AccessibilityNode | undefined {
        if (source.isDisposed()) {
            return undefined;
        }
        let node = this._nodes.get(source);
        if (!node) {
            node = addAccessibilityNode(this.tree, { target: source });
            node._available = () => {
                if (this._disposed || this._scene._lite._z) {
                    return false;
                }
                for (let current: Node | null = source; current; current = current.parent) {
                    const tag = current.accessibilityTag;
                    if (
                        current.isDisposed() ||
                        !current.isEnabled() ||
                        tag?.disabled ||
                        tag?.hidden ||
                        String(tag?.aria?.["aria-disabled"]) === "true" ||
                        String(tag?.aria?.["aria-hidden"]) === "true" ||
                        (current instanceof AbstractMesh && !current.isVisible)
                    ) {
                        return false;
                    }
                }
                return true;
            };
            this._nodes.set(source, node);
            this._sources.set(node, source);
            if (source.parent) {
                this._update(source.parent);
                updateAccessibilityNode(this.tree, node, { parent: this._nodes.get(source.parent) ?? null });
            }
        }
        return node;
    }

    private _state(source: Node, tag = source.accessibilityTag): Pick<AccessibilityNodeOptions, "tag" | "hidden" | "disabled"> {
        const primary = findActionManager(source, ActionManager.OnPickTrigger) || findActionManager(source, ActionManager.OnLeftPickTrigger);
        const secondary = findActionManager(source, ActionManager.OnPickTrigger) || findActionManager(source, ActionManager.OnRightPickTrigger);
        const metadata: AccessibilityTag | null =
            tag || primary || secondary
                ? {
                      ...tag,
                      tabIndex: tag?.tabIndex === undefined ? undefined : tag.tabIndex < 0 ? -1 : 0,
                      description: tag?.description ?? source.name,
                      eventHandler: {
                          ...tag?.eventHandler,
                          click: tag?.eventHandler?.click ?? (primary ? (event) => this._dispatch(source, event, false) : undefined),
                          contextmenu: tag?.eventHandler?.contextmenu ?? (secondary ? (event) => this._dispatch(source, event, true) : undefined),
                      },
                  }
                : null;
        return {
            tag: metadata,
            hidden: source.isDisposed() || !source.isEnabled() || (source instanceof AbstractMesh && !source.isVisible) || tag?.hidden === true,
            disabled: tag?.disabled === true,
        };
    }

    private _sortParent(parent: AccessibilityNode | null): void {
        const siblings = parent?.children ?? this.tree.roots;
        const ordered = [...siblings].sort((a, b) => (this._orders.get(a) ?? Infinity) - (this._orders.get(b) ?? Infinity));
        for (let index = 0; index < ordered.length; index++) {
            const node = ordered[index]!;
            if (siblings[index] !== node) {
                updateAccessibilityNode(this.tree, node, { before: siblings[index] ?? null });
            }
        }
    }

    private _sortChanged(): void {
        for (const parent of this._sortParents) {
            this._sortParent(parent);
        }
        this._sortParents.clear();
    }

    private _remove(source: Node): void {
        this._managers.get(source)?.unsubscribe();
        this._managers.delete(source);
        const removed = this._nodes.get(source);
        if (!removed) {
            return;
        }
        this._sortParents.add(removed.parent);
        const pending = [removed];
        for (let index = 0; index < pending.length; index++) {
            const node = pending[index]!;
            pending.push(...node.children);
            const owner = this._sources.get(node);
            if (owner) {
                this._managers.get(owner)?.unsubscribe();
                this._managers.delete(owner);
                this._nodes.delete(owner);
            }
            this._sources.delete(node);
            this._orders.delete(node);
        }
        removeAccessibilityNode(this.tree, removed);
    }

    private _update(source: Node): void {
        if (source.isDisposed()) {
            this._remove(source);
            return;
        }
        const node = this._ensure(source)!;
        const oldParent = node.parent;
        const oldOrder = this._orders.get(node);
        const order = (source._accessibilityTabOrder ?? 0) > 0 ? source._accessibilityTabOrder! : Infinity;
        const manager = source.actionManager;
        if (this._managers.get(source)?.manager !== manager) {
            this._managers.get(source)?.unsubscribe();
            this._managers.delete(source);
            if (manager) {
                this._managers.set(source, { manager, unsubscribe: manager._subscribe(() => this._changed(source, "subtree")) });
            }
        }
        updateAccessibilityNode(this.tree, node, {
            ...this._state(source),
            parent: source.parent ? (this._ensure(source.parent) ?? null) : null,
        });
        this._orders.set(node, order);
        if (oldParent !== node.parent) {
            this._sortParents.add(oldParent);
            this._sortParents.add(node.parent);
        } else if (oldOrder !== order) {
            this._sortParents.add(node.parent);
        }
    }

    private _dispatch(source: Node, event: MouseEvent | KeyboardEvent, secondary: boolean): void {
        if (
            source.isDisposed() ||
            !source.isEnabled() ||
            source.accessibilityTag?.disabled ||
            source.accessibilityTag?.hidden ||
            (source instanceof AbstractMesh && !source.isVisible)
        ) {
            return;
        }
        const actionEvent = {
            source,
            pointerX: "clientX" in event ? event.clientX : 0,
            pointerY: "clientY" in event ? event.clientY : 0,
            meshUnderPointer: source,
            sourceEvent: event,
        };
        const specific = secondary ? ActionManager.OnRightPickTrigger : ActionManager.OnLeftPickTrigger;
        findActionManager(source, specific)?.processTrigger(specific, actionEvent);
        findActionManager(source, ActionManager.OnPickTrigger)?.processTrigger(ActionManager.OnPickTrigger, actionEvent);
    }

    /** Rescan canonical scene wrappers after direct list mutation. Ordinary setters synchronize automatically. */
    public refresh(): void {
        if (this._disposed) {
            throw new Error("HTMLTwinRenderer is disposed.");
        }
        batchAccessibilityUpdates(this.tree, () => {
            const pending = [...this._scene.meshes, ...this._scene.cameras, ...this._scene.lights, ...(this._options.roots ?? [])];
            const descendants = new Set<Node>();
            for (let index = 0; index < pending.length; index++) {
                const source = pending[index]!;
                if (descendants.has(source) || source.isDisposed()) {
                    continue;
                }
                descendants.add(source);
                pending.push(...source.getChildren());
            }
            const sources = new Set(descendants);
            for (const source of descendants) {
                for (let parent = source.parent; parent && !sources.has(parent); parent = parent.parent) {
                    sources.add(parent);
                }
            }
            for (const source of sources) {
                this._update(source);
            }
            for (const source of [...this._nodes.keys()]) {
                if (!sources.has(source)) {
                    this._remove(source);
                }
            }
            this._sortChanged();
        });
    }

    /** Focus a canonical scene wrapper, not a replacement wrapper or generated mesh. */
    public focus(source: Node): boolean {
        const node = this._nodes.get(source);
        if (!node) {
            throw new Error("Node is not registered in this HTML twin.");
        }
        return focusHtmlTwinNode(this.view, node);
    }

    /** Remove the view and all compat subscriptions. Scene disposal also calls this method. */
    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        if (this._scene._accessibilityNodeChanged === this._changed) {
            this._scene._accessibilityNodeChanged = this._previous;
        }
        if (this._scene._accessibilityTagChanging === this._validateTag) {
            this._scene._accessibilityTagChanging = this._previousValidation;
        }
        this._scene.onDisposeObservable.remove(this._onDispose);
        renderers?.delete(this._scene);
        this._dirty.clear();
        this._dirtySubtrees.clear();
        this._nodes.clear();
        this._sources.clear();
        this._orders.clear();
        this._sortParents.clear();
        for (const entry of this._managers.values()) {
            entry.unsubscribe();
        }
        this._managers.clear();
        disposeAccessibilityTree(this.tree);
    }
}
