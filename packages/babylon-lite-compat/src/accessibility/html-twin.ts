import {
    addAccessibilityNode,
    batchAccessibilityUpdates,
    createAccessibilityTree,
    createHtmlTwin,
    disposeAccessibilityTree,
    disposeHtmlTwin,
    removeAccessibilityNode,
    updateAccessibilityNode,
} from "babylon-lite";
import type { AccessibilityNode, AccessibilityTag, AccessibilityTree, HtmlTwin } from "babylon-lite";
import type { Node } from "../node/node.js";
import type { Scene } from "../scene/scene.js";

/** Options for the passive Babylon-compatible HTML twin. */
export interface IHTMLTwinRendererOptions {
    parentElement?: HTMLElement;
    canvas?: HTMLCanvasElement;
    label?: string;
    roots?: readonly Node[];
}

let renderers: WeakMap<Scene, HTMLTwinRenderer> | undefined;

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

/** Babylon-compatible facade over Lite's passive semantic DOM. */
export class HTMLTwinRenderer {
    public readonly tree: AccessibilityTree;
    public readonly view: HtmlTwin;
    private readonly _nodes = new Map<Node, AccessibilityNode>();
    private readonly _previous: Scene["_accessibilityNodeChanged"];
    private readonly _changed: NonNullable<Scene["_accessibilityNodeChanged"]>;
    private readonly _onDispose: (scene: Scene) => void;
    private _pending = false;
    private _disposed = false;

    /** Mount one passive representation for the scene. */
    public static Render(scene: Scene, options: IHTMLTwinRendererOptions = {}): HTMLTwinRenderer {
        if (renderers?.has(scene)) {
            throw new Error("The compat scene already has an HTML twin; dispose it before remounting.");
        }
        return new HTMLTwinRenderer(scene, options);
    }

    private constructor(
        private readonly _scene: Scene,
        options: IHTMLTwinRendererOptions
    ) {
        const canvas = options.canvas ?? this._scene.getEngine().getRenderingCanvas();
        const domCanvas = canvas && "ownerDocument" in canvas ? canvas : undefined;
        const parent = options.parentElement ?? domCanvas?.parentElement ?? domCanvas?.ownerDocument.body;
        if (!parent) {
            throw new Error("HTMLTwinRenderer requires parentElement when the scene has no DOM canvas.");
        }
        this.tree = createAccessibilityTree();
        this.view = createHtmlTwin(this.tree, { parent, label: options.label ?? "Scene" });
        this._previous = this._scene._accessibilityNodeChanged;
        this._changed = (node) => {
            this._previous?.(node);
            this._schedule();
        };
        this._scene._accessibilityNodeChanged = this._changed;
        this._onDispose = this._scene.onDisposeObservable.add(() => this.dispose());
        (renderers ??= new WeakMap()).set(this._scene, this);
        this._roots = options.roots;
        this.refresh();
    }

    private readonly _roots: readonly Node[] | undefined;

    private _schedule(): void {
        if (this._pending || this._disposed) {
            return;
        }
        this._pending = true;
        queueMicrotask(() => {
            this._pending = false;
            if (!this._disposed) {
                this.refresh();
            }
        });
    }

    private _collect(source: Node, desired: Set<Node>, traversed: Set<Node>): void {
        if (traversed.has(source) || source.isDisposed()) {
            return;
        }
        traversed.add(source);
        desired.add(source);
        for (const child of source.getChildren(undefined, true)) {
            this._collect(child, desired, traversed);
        }
    }

    private _ensureNode(source: Node, desired: Set<Node>, creating: Set<Node>): AccessibilityNode {
        let node = this._nodes.get(source);
        if (!node) {
            if (creating.has(source)) {
                throw new Error("Accessibility parent would create a cycle.");
            }
            creating.add(source);
            const parent = source.parent && desired.has(source.parent) ? this._ensureNode(source.parent, desired, creating) : undefined;
            node = addAccessibilityNode(this.tree, { target: source, parent: parent ?? null });
            this._nodes.set(source, node);
            creating.delete(source);
        }
        return node;
    }

    /** Synchronize the current compatibility scene hierarchy immediately. */
    public refresh(): void {
        if (this._disposed) {
            throw new Error("HTMLTwinRenderer is disposed.");
        }
        const desired = new Set<Node>();
        const traversed = new Set<Node>();
        for (const source of [...this._scene.meshes, ...this._scene.cameras, ...this._scene.lights, ...(this._roots ?? [])]) {
            this._collect(source, desired, traversed);
            for (let current = source.parent; current; current = current.parent) {
                desired.add(current);
            }
        }
        batchAccessibilityUpdates(this.tree, () => {
            const creating = new Set<Node>();
            for (const source of desired) {
                this._ensureNode(source, desired, creating);
            }
            for (const source of desired) {
                const parent = source.parent && desired.has(source.parent) ? this._nodes.get(source.parent)! : null;
                const visible = !("isVisible" in source) || source.isVisible !== false;
                const runtimeHidden = source.isDisposed() || !source.isEnabled() || !visible;
                const tag = projectRuntimeHidden(source.accessibilityTag, runtimeHidden);
                updateAccessibilityNode(this.tree, this._nodes.get(source)!, {
                    tag,
                    parent,
                    hidden: runtimeHidden || tag?.hidden === true || String(tag?.aria?.["aria-hidden"]) === "true",
                    disabled: tag?.disabled === true || String(tag?.aria?.["aria-disabled"]) === "true",
                    target: source,
                });
            }
            for (const [source, node] of [...this._nodes]) {
                if (!desired.has(source)) {
                    this._nodes.delete(source);
                    if (this.tree._nodes.has(node)) {
                        removeAccessibilityNode(this.tree, node);
                    }
                }
            }
        });
    }

    /** Dispose the projection without changing the scene. */
    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        if (this._scene._accessibilityNodeChanged === this._changed) {
            this._scene._accessibilityNodeChanged = this._previous;
        }
        this._scene.onDisposeObservable.remove(this._onDispose);
        renderers?.delete(this._scene);
        disposeHtmlTwin(this.view);
        disposeAccessibilityTree(this.tree);
        this._nodes.clear();
    }
}
