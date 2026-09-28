import { onAccessibilityTreeChanged } from "./accessibility-tree.js";
import type { AccessibilityNode, AccessibilityNodeOptions, AccessibilityTree } from "./accessibility-tree.js";

/** Options for the browser-native semantic layer. */
export interface HtmlTwinOptions {
    /** Visible DOM parent outside the rendering canvas and outside any inert subtree. */
    parent: HTMLElement;
    /** Focus fallback when the last object disappears or the twin is disposed. */
    canvas?: HTMLCanvasElement;
    /** Accessible name of the generated region. */
    label?: string;
    /** Additional scene focus decoration. Return a cleanup that restores prior state. */
    focusVisual?: (node: AccessibilityNode, element: HTMLElement) => (() => void) | void;
}

interface TwinItem {
    node: AccessibilityNode;
    wrapper: HTMLDivElement;
    children: HTMLDivElement;
    element: HTMLElement;
    adopted: boolean;
    parent: Node | null;
    next: Node | null;
    attributes: Map<string, string | null>;
    applied: Map<string, string | null>;
    listeners: (() => void)[];
    disabledChildren: Map<HTMLElement, Map<string, string | null>>;
    groupAttributes: Set<string>;
    group: boolean;
    disabled: boolean;
}

/** A mounted semantic region. Its functions own all listeners and adopted DOM state. */
export interface HtmlTwin {
    readonly element: HTMLDivElement;
    readonly tree: AccessibilityTree;
    /** @internal */
    _options: HtmlTwinOptions;
    /** @internal */
    _items: Map<AccessibilityNode, TwinItem>;
    /** @internal */
    _style: HTMLStyleElement;
    /** @internal */
    _unsubscribe: () => void;
    /** @internal */
    _focusCleanup?: () => void;
    /** @internal */
    _disposed: boolean;
}

let elementOwners: WeakMap<HTMLElement, HtmlTwin> | undefined;

function available(element: HTMLElement): boolean {
    return !element.closest("[hidden], [inert], [aria-hidden=true], [aria-disabled=true]") && !element.matches(":disabled");
}

function canActivate(twin: HtmlTwin, node: AccessibilityNode): boolean {
    if (twin._disposed || !twin.tree._nodes.has(node)) {
        return false;
    }
    for (let current: AccessibilityNode | null = node; current; current = current.parent) {
        const tag = current.tag;
        if (
            current.hidden ||
            current.disabled ||
            tag?.hidden ||
            tag?.disabled ||
            String(tag?.aria?.["aria-hidden"]) === "true" ||
            String(tag?.aria?.["aria-disabled"]) === "true"
        ) {
            return false;
        }
    }
    return true;
}

function focusables(twin: HtmlTwin): HTMLElement[] {
    return [...twin.element.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter((element) => element.tabIndex >= 0 && available(element));
}

function applyAttribute(item: TwinItem, key: string, value: string | null): void {
    if (!item.attributes.has(key)) {
        item.attributes.set(key, item.element.getAttribute(key));
    }
    if (value === null) {
        item.element.removeAttribute(key);
    } else {
        item.element.setAttribute(key, value);
    }
    item.applied.set(key, value);
}

function restoreAttribute(item: TwinItem, key: string): void {
    if (item.element.getAttribute(key) === item.applied.get(key)) {
        const value = item.attributes.get(key);
        if (value == null) {
            item.element.removeAttribute(key);
        } else {
            item.element.setAttribute(key, value);
        }
    }
    item.applied.delete(key);
    item.attributes.delete(key);
}

function clearFocus(twin: HtmlTwin): void {
    const cleanup = twin._focusCleanup;
    twin._focusCleanup = undefined;
    cleanup?.();
}

function validateItem(twin: HtmlTwin, options: AccessibilityNodeOptions, node?: AccessibilityNode): void {
    const { element, tag } = options;
    if (element) {
        const owner = elementOwners?.get(element);
        if (
            (owner && (owner !== twin || !node || twin._items.get(node)?.element !== element)) ||
            element.ownerDocument !== twin.element.ownerDocument ||
            element.contains(twin.element) ||
            element.closest("canvas,[inert],.lite-html-overlay")
        ) {
            throw new Error("Accessibility controls require exclusive ownership, the host document, and a non-inert location outside the canvas.");
        }
        if (element.matches("input,select,textarea") || element.querySelector("input,select,textarea")) {
            for (const key of ["aria-checked", "aria-selected", "aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-readonly", "aria-multiline"]) {
                if (tag?.aria && key in tag.aria) {
                    throw new Error(`Native form state owns ${key}; update the real control instead.`);
                }
            }
        }
    } else if (tag) {
        const actionable = !!(tag.eventHandler?.click || tag.eventHandler?.contextmenu);
        const roles = actionable
            ? ["button"]
            : ["group", "region", "note", "img", "heading", "status", "log", "alert", "article", "paragraph", "list", "listitem", "none", "presentation"];
        if (tag.role && !roles.includes(tag.role)) {
            throw new Error(`Role ${tag.role} requires a matching native control; it cannot be applied to this generated accessibility item.`);
        }
        if (actionable && !String(tag.name ?? tag.description ?? tag.aria?.["aria-label"] ?? "").trim()) {
            throw new Error("An actionable accessibility item requires a nonempty name.");
        }
    }
}

function createItem(twin: HtmlTwin, node: AccessibilityNode): TwinItem {
    const doc = twin.element.ownerDocument;
    const actionable = !!(node.tag?.eventHandler?.click || node.tag?.eventHandler?.contextmenu);
    const element = node.element ?? doc.createElement(actionable ? "button" : "div");
    if (node.element) {
        const owner = elementOwners?.get(element);
        if (owner) {
            throw new Error("An HTML control can belong to only one accessibility twin.");
        }
        if (element.ownerDocument !== doc || element.contains(twin.element) || element.closest("canvas,[inert],.lite-html-overlay")) {
            throw new Error("Accessibility controls must be unowned, non-inert DOM outside the canvas in the host document.");
        }
        (elementOwners ??= new WeakMap()).set(element, twin);
    } else if (element.tagName === "BUTTON") {
        element.setAttribute("type", "button");
    } else {
        element.tabIndex = -1;
    }
    const item: TwinItem = {
        node,
        wrapper: doc.createElement("div"),
        children: doc.createElement("div"),
        element,
        adopted: !!node.element,
        parent: element.parentNode,
        next: element.nextSibling,
        attributes: new Map(),
        applied: new Map(),
        listeners: [],
        disabledChildren: new Map(),
        groupAttributes: new Set(),
        group: false,
        disabled: false,
    };
    item.wrapper.append(element, item.children);
    applyAttribute(item, "data-lite-a11y", "");
    const blockUnavailable = (event: Event): void => {
        if (!canActivate(twin, node) || item.wrapper.closest("[hidden], [aria-disabled=true]")) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    };
    for (const type of ["click", "contextmenu", "keydown", "keyup", "pointerdown"]) {
        item.wrapper.addEventListener(type, blockUnavailable, true);
        item.listeners.push(() => item.wrapper.removeEventListener(type, blockUnavailable, true));
    }
    const listen = <K extends keyof HTMLElementEventMap>(type: K, callback: (event: HTMLElementEventMap[K]) => void): void => {
        const listener = (event: HTMLElementEventMap[K]): void => {
            if (event.target === item.wrapper || (event.target instanceof doc.defaultView!.Node && element.contains(event.target))) {
                callback(event);
            }
        };
        item.wrapper.addEventListener(type, listener);
        item.listeners.push(() => item.wrapper.removeEventListener(type, listener));
    };
    listen("click", (event) => {
        if (canActivate(twin, node) && available(element)) {
            node.tag?.eventHandler?.click?.(event);
        }
    });
    listen("contextmenu", (event) => {
        if (canActivate(twin, node) && available(element) && node.tag?.eventHandler?.contextmenu) {
            event.preventDefault();
            node.tag.eventHandler.contextmenu(event);
        }
    });
    listen("keydown", (event) => {
        if ((event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) && canActivate(twin, node) && available(element) && node.tag?.eventHandler?.contextmenu) {
            event.preventDefault();
            node.tag.eventHandler.contextmenu(event);
        }
    });
    listen("focusin", (event) => {
        clearFocus(twin);
        twin._focusCleanup = twin._options.focusVisual?.(node, item.group ? item.wrapper : element) ?? undefined;
        node.tag?.eventHandler?.focus?.(event);
    });
    listen("focusout", (event) => {
        clearFocus(twin);
        node.tag?.eventHandler?.blur?.(event);
    });
    if (item.adopted) {
        const observer = new doc.defaultView!.MutationObserver(() => {
            if (!twin._disposed && twin._items.get(node) === item) {
                restoreDisabledChildren(item, true);
                updateItem(item, item.disabled);
            }
        });
        observer.observe(element, { childList: true, subtree: true });
        item.listeners.push(() => observer.disconnect());
    }
    return item;
}

function restoreDisabledChildren(item: TwinItem, removedOnly = false): void {
    for (const [child, attributes] of item.disabledChildren) {
        if (removedOnly && item.element.contains(child)) {
            continue;
        }
        for (const [key, value] of attributes) {
            const applied = key === "disabled" ? "" : key === "tabindex" ? "-1" : "true";
            if (child.getAttribute(key) === applied) {
                if (value === null) {
                    child.removeAttribute(key);
                } else {
                    child.setAttribute(key, value);
                }
            }
        }
        item.disabledChildren.delete(child);
    }
}

function removeItem(item: TwinItem): void {
    for (const remove of item.listeners) {
        remove();
    }
    for (const key of item.attributes.keys()) {
        restoreAttribute(item, key);
    }
    restoreDisabledChildren(item);
    if (item.adopted) {
        elementOwners?.delete(item.element);
        if (item.wrapper.contains(item.element)) {
            if (item.parent) {
                item.parent.insertBefore(item.element, item.next?.parentNode === item.parent ? item.next : null);
            } else {
                item.element.remove();
            }
        }
    }
    item.wrapper.remove();
}

function updateItem(item: TwinItem, disabled: boolean): void {
    const { node, element, wrapper } = item;
    item.disabled = disabled;
    for (const key of item.groupAttributes) {
        wrapper.removeAttribute(key);
    }
    item.groupAttributes.clear();
    const tag = node.tag;
    const group = !!tag && !item.adopted && element.tagName !== "BUTTON" && node.children.length > 0;
    item.group = group;
    const name = tag?.name ?? tag?.description;
    wrapper.hidden = node.hidden || tag?.hidden === true || tag?.aria?.["aria-hidden"] === true || tag?.aria?.["aria-hidden"] === "true";
    if (disabled) {
        wrapper.setAttribute("aria-disabled", "true");
    } else {
        wrapper.removeAttribute("aria-disabled");
    }
    const values = new Map<string, string | null>();
    values.set("data-lite-a11y", "");
    if (tag?.role && !group) {
        values.set("role", tag.role);
    }
    if (group) {
        wrapper.setAttribute("role", tag?.role ?? "group");
        wrapper.setAttribute("data-lite-a11y", "");
        wrapper.tabIndex = disabled ? -1 : (tag.tabIndex ?? -1);
        if (name) {
            wrapper.setAttribute("aria-label", name);
        } else {
            wrapper.removeAttribute("aria-label");
        }
    } else {
        wrapper.removeAttribute("role");
        wrapper.removeAttribute("aria-label");
        wrapper.removeAttribute("data-lite-a11y");
        wrapper.removeAttribute("tabindex");
    }
    if (item.adopted && name) {
        values.set("aria-label", name);
    }
    if (tag?.name && tag.description) {
        values.set("aria-description", tag.description);
    }
    if (tag?.tabIndex !== undefined) {
        values.set("tabindex", String(tag.tabIndex));
    }
    for (const [key, value] of Object.entries(tag?.aria ?? {})) {
        if (!/^aria-[a-z-]+$/.test(key)) {
            throw new Error(`Invalid accessibility attribute: ${key}`);
        }
        values.set(key, value == null ? null : String(value));
    }
    if (group) {
        for (const [key, value] of values) {
            if (key.startsWith("aria-") && value !== null) {
                wrapper.setAttribute(key, value);
                item.groupAttributes.add(key);
            }
        }
    }
    if (disabled) {
        values.set("aria-disabled", "true");
        values.set("tabindex", "-1");
        if (element.matches("button,input,select,textarea,fieldset,option,optgroup")) {
            values.set("disabled", "");
        }
        if (item.adopted) {
            for (const child of element.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href],[tabindex],[contenteditable]")) {
                let attributes = item.disabledChildren.get(child);
                if (!attributes) {
                    attributes = new Map();
                    item.disabledChildren.set(child, attributes);
                }
                for (const key of ["tabindex", "aria-disabled", ...(child.matches("button,input,select,textarea") ? ["disabled"] : [])]) {
                    if (!attributes.has(key)) {
                        attributes.set(key, child.getAttribute(key));
                    }
                    child.setAttribute(key, key === "disabled" ? "" : key === "tabindex" ? "-1" : "true");
                }
            }
        }
    } else {
        restoreDisabledChildren(item);
    }
    if (!item.adopted) {
        element.textContent = group ? "" : (name ?? "");
        element.hidden = !tag || group;
    }
    for (const key of item.applied.keys()) {
        if (!values.has(key)) {
            restoreAttribute(item, key);
        }
    }
    for (const [key, value] of values) {
        applyAttribute(item, key, value);
    }
}

/** Flush the current semantic state to DOM. Tree mutators call this automatically. */
export function updateHtmlTwin(twin: HtmlTwin): void {
    if (twin._disposed) {
        throw new Error("HTML twin is disposed.");
    }
    if (twin.tree.disposed) {
        disposeHtmlTwin(twin);
        return;
    }
    const doc = twin.element.ownerDocument;
    const active = doc.activeElement;
    const activeNode =
        [...twin._items.values()].find((item) => (item.group && item.wrapper === active) || item.element === active || item.element.contains(active))?.node ??
        [...twin.tree._nodes].find((node) => node.element?.contains(active));
    const oldFocusables = focusables(twin);
    const focusIndex = oldFocusables.findIndex((element) => element === active || element.contains(active));
    const hadFocus = !!active && (twin.element.contains(active) || !!activeNode);
    const visited = new Set<AccessibilityNode>();
    const visit = (nodes: readonly AccessibilityNode[], container: HTMLElement, inheritedDisabled: boolean): void => {
        let previous: HTMLElement | null = null;
        for (const node of nodes) {
            visited.add(node);
            let item = twin._items.get(node);
            const expectedTag = node.tag?.eventHandler?.click || node.tag?.eventHandler?.contextmenu ? "BUTTON" : "DIV";
            if (item && (item.adopted ? item.element !== node.element : !!node.element || item.element.tagName !== expectedTag)) {
                removeItem(item);
                twin._items.delete(node);
                item = undefined;
            }
            if (!item) {
                item = createItem(twin, node);
                twin._items.set(node, item);
            }
            const disabled =
                inheritedDisabled || node.disabled || node.tag?.disabled === true || node.tag?.aria?.["aria-disabled"] === true || node.tag?.aria?.["aria-disabled"] === "true";
            updateItem(item, disabled);
            const next: ChildNode | null = previous ? previous.nextSibling : container.firstChild;
            if (next !== item.wrapper) {
                container.insertBefore(item.wrapper, next);
            }
            previous = item.wrapper;
            visit(node.children, item.children, disabled);
        }
    };
    visit(twin.tree.roots, twin.element, false);
    for (const [node, item] of twin._items) {
        if (!visited.has(node)) {
            removeItem(item);
            twin._items.delete(node);
        }
    }
    if (hadFocus) {
        const mounted = activeNode ? getHtmlTwinElement(twin, activeNode) : null;
        const current = mounted?.contains(active) && active instanceof doc.defaultView!.HTMLElement ? active : mounted;
        if (current && twin.element.contains(current) && available(current)) {
            if (doc.activeElement !== current) {
                current.focus({ preventScroll: true });
            }
        } else {
            clearFocus(twin);
            const remaining = focusables(twin);
            const next = oldFocusables.slice(focusIndex + 1).find((element) => remaining.includes(element));
            const fallback = next ?? remaining[Math.min(focusIndex, remaining.length - 1)] ?? twin._options.canvas;
            fallback?.focus({ preventScroll: true });
            if (!fallback || doc.activeElement !== fallback) {
                twin.element.focus({ preventScroll: true });
            }
        }
    }
}

/** Retrieve the real semantic element for focus, inspection, or native control integration. */
export function getHtmlTwinElement(twin: HtmlTwin, node: AccessibilityNode): HTMLElement | undefined {
    const item = twin._items.get(node);
    return item?.group ? item.wrapper : item?.element;
}

/** Focus an available semantic object without scrolling. Returns false for hidden/disabled objects. */
export function focusHtmlTwinNode(twin: HtmlTwin, node: AccessibilityNode): boolean {
    updateHtmlTwin(twin);
    const element = getHtmlTwinElement(twin, node);
    if (!element) {
        throw new Error("Accessibility node is not mounted in this HTML twin.");
    }
    if (!available(element)) {
        return false;
    }
    element.focus({ preventScroll: true });
    return element.ownerDocument.activeElement === element;
}

/** Remove focus from this view without moving focus that is already outside it. */
export function blurHtmlTwin(twin: HtmlTwin): void {
    if (twin._disposed) {
        throw new Error("HTML twin is disposed.");
    }
    const active = twin.element.ownerDocument.activeElement;
    if (active instanceof twin.element.ownerDocument.defaultView!.HTMLElement && twin.element.contains(active)) {
        active.blur();
    }
}

/** Mount a visible, labelled region with native browser focus order and activation. */
export function createHtmlTwin(tree: AccessibilityTree, options: HtmlTwinOptions): HtmlTwin {
    if (
        tree.disposed ||
        !options.parent.ownerDocument.defaultView ||
        !options.parent.isConnected ||
        options.parent.closest("canvas, [inert]") ||
        (options.canvas && options.canvas.ownerDocument !== options.parent.ownerDocument) ||
        (options.label !== undefined && !options.label.trim())
    ) {
        throw new Error("HTML twin requires a live tree and a non-inert parent outside the canvas.");
    }
    const doc = options.parent.ownerDocument;
    const element = doc.createElement("div");
    element.className = "lite-accessibility";
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", options.label ?? "Scene");
    element.tabIndex = -1;
    const style = doc.createElement("style");
    style.textContent =
        ".lite-accessibility [data-lite-a11y]:focus,.lite-accessibility [data-lite-a11y] :focus{outline:3px solid var(--lite-accessibility-focus-color,Highlight);outline-offset:3px}.lite-accessibility [hidden]{display:none!important}";
    options.parent.append(style, element);
    const twin: HtmlTwin = { element, tree, _options: options, _items: new Map(), _style: style, _unsubscribe: () => {}, _disposed: false };
    const validate = (options: AccessibilityNodeOptions, node?: AccessibilityNode): void => validateItem(twin, options, node);
    const unsubscribe = onAccessibilityTreeChanged(tree, () => updateHtmlTwin(twin));
    tree._validators.add(validate);
    twin._unsubscribe = () => {
        unsubscribe();
        tree._validators.delete(validate);
    };
    try {
        for (const node of tree._nodes) {
            validate(node, node);
        }
        updateHtmlTwin(twin);
    } catch (error) {
        disposeHtmlTwin(twin);
        throw error;
    }
    return twin;
}

/** Remove owned DOM/listeners and restore borrowed controls to their original locations. */
export function disposeHtmlTwin(twin: HtmlTwin): void {
    if (twin._disposed) {
        return;
    }
    twin._disposed = true;
    const hadFocus = twin.element.contains(twin.element.ownerDocument.activeElement);
    twin._unsubscribe();
    try {
        clearFocus(twin);
    } finally {
        for (const item of twin._items.values()) {
            removeItem(item);
        }
        twin._items.clear();
        twin.element.remove();
        twin._style.remove();
        if (hadFocus) {
            twin._options.canvas?.focus({ preventScroll: true });
        }
    }
}
