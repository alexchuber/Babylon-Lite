import { validateFormOwnership } from "./form-ownership.js";

/** Options for a live DOM panel or screen-aligned canvas overlay. */
export interface HtmlOverlayOptions {
    canvas: HTMLCanvasElement;
    /** Caller-owned live content. Inert HTML texture sources are deliberately rejected. */
    element: HTMLElement;
    parent?: HTMLElement;
    label?: string;
    mode?: "panel" | "overlay";
}

/** Real DOM hosting, not a captured texture or simulated input surface. */
export interface HtmlOverlay {
    readonly element: HTMLDivElement;
    readonly content: HTMLElement;
    /** @internal */
    _options: HtmlOverlayOptions;
    /** @internal */
    _parent: Node | null;
    /** @internal */
    _next: Node | null;
    /** @internal */
    _cleanup: (() => void)[];
    /** @internal */
    _disposed: boolean;
    /** @internal */
    _frame?: number;
    /** @internal */
    _bounds?: readonly [left: number, top: number, width: number, height: number];
}

/** Align the overlay with the canvas's current CSS bounds. Call after application CSS transforms. */
export function updateHtmlOverlay(overlay: HtmlOverlay): void {
    if (overlay._disposed) {
        throw new Error("HTML overlay is disposed.");
    }
    if (overlay._options.mode === "overlay") {
        const view = overlay.element.ownerDocument.defaultView!;
        if (overlay._frame !== undefined) {
            view.cancelAnimationFrame(overlay._frame);
            overlay._frame = undefined;
        }
        const rect = overlay._options.canvas.getBoundingClientRect();
        const bounds = [rect.left, rect.top, rect.width, rect.height] as const;
        const previous = overlay._bounds;
        if (!previous || previous[0] !== bounds[0]) {
            overlay.element.style.left = `${bounds[0]}px`;
        }
        if (!previous || previous[1] !== bounds[1]) {
            overlay.element.style.top = `${bounds[1]}px`;
        }
        if (!previous || previous[2] !== bounds[2]) {
            overlay.element.style.width = `${bounds[2]}px`;
        }
        if (!previous || previous[3] !== bounds[3]) {
            overlay.element.style.height = `${bounds[3]}px`;
        }
        overlay._bounds = bounds;
    }
}

function cancelGeometryUpdate(overlay: HtmlOverlay): void {
    if (overlay._frame !== undefined) {
        overlay.element.ownerDocument.defaultView!.cancelAnimationFrame(overlay._frame);
        overlay._frame = undefined;
    }
}

function scheduleGeometryUpdate(overlay: HtmlOverlay): void {
    if (overlay._disposed || overlay.element.hidden || overlay._frame !== undefined) {
        return;
    }
    const view = overlay.element.ownerDocument.defaultView!;
    overlay._frame = view.requestAnimationFrame(() => {
        overlay._frame = undefined;
        if (!overlay._disposed && !overlay.element.hidden) {
            updateHtmlOverlay(overlay);
        }
    });
}

/** Hide both the visual panel and its focusable descendants without replacing live controls. */
export function setHtmlOverlayVisible(overlay: HtmlOverlay, visible: boolean): void {
    if (overlay._disposed) {
        throw new Error("HTML overlay is disposed.");
    }
    const hadFocus = overlay.element.contains(overlay.element.ownerDocument.activeElement);
    if (visible && overlay.element.hidden) {
        updateHtmlOverlay(overlay);
        overlay.element.hidden = false;
    } else if (visible) {
        scheduleGeometryUpdate(overlay);
    } else {
        overlay.element.hidden = true;
        cancelGeometryUpdate(overlay);
    }
    if (!visible && hadFocus) {
        overlay._options.canvas.focus({ preventScroll: true });
    }
}

/** Host the original HTMLElement outside the canvas, preserving editing, selection, and browser events. */
export function createHtmlOverlay(options: HtmlOverlayOptions): HtmlOverlay {
    const doc = options.canvas.ownerDocument;
    const parent = options.parent ?? doc.body;
    if (
        options.element.ownerDocument !== doc ||
        !doc.defaultView ||
        !parent.isConnected ||
        parent.ownerDocument !== doc ||
        parent.closest("canvas,[inert]") ||
        options.element.closest("canvas,[inert],.lite-html-overlay,.lite-accessibility") ||
        options.element.contains(parent) ||
        options.element === options.canvas ||
        (options.label !== undefined && !options.label.trim())
    ) {
        throw new Error("A live HTML overlay requires unowned, non-inert content and a parent outside the canvas in the same document.");
    }
    validateFormOwnership(options.element, parent);
    const element = doc.createElement("div");
    element.className = "lite-html-overlay";
    element.setAttribute("role", "region");
    element.setAttribute("aria-label", options.label ?? "Scene controls");
    const style = doc.createElement("style");
    style.textContent = ".lite-html-overlay :focus{outline:3px solid var(--lite-accessibility-focus-color,Highlight);outline-offset:3px}";
    const slot = doc.createElement("div");
    slot.style.pointerEvents = "auto";
    slot.style.width = "fit-content";
    if (options.mode === "overlay") {
        Object.assign(element.style, { position: "fixed", pointerEvents: "none", zIndex: "1" });
    }
    const overlay: HtmlOverlay = {
        element,
        content: options.element,
        _options: options,
        _parent: options.element.parentNode,
        _next: options.element.nextSibling,
        _cleanup: [],
        _disposed: false,
    };
    const active = doc.activeElement;
    const hadFocus = active instanceof doc.defaultView.HTMLElement && options.element.contains(active);
    try {
        slot.append(options.element);
        element.append(style, slot);
        parent.append(element);
        const update = (): void => scheduleGeometryUpdate(overlay);
        if (options.mode === "overlay") {
            const view = doc.defaultView;
            const observer = new view.ResizeObserver(update);
            overlay._cleanup.push(() => {
                observer.disconnect();
                view.removeEventListener("resize", update);
                view.removeEventListener("scroll", update, true);
            });
            observer.observe(options.canvas);
            view.addEventListener("resize", update);
            view.addEventListener("scroll", update, true);
        }
        updateHtmlOverlay(overlay);
        if (hadFocus) {
            active.focus({ preventScroll: true });
        }
    } catch (error) {
        disposeHtmlOverlay(overlay);
        throw error;
    }
    return overlay;
}

/** Restore content to its original parent/sibling and remove only library-owned hosting state. */
export function disposeHtmlOverlay(overlay: HtmlOverlay): void {
    if (overlay._disposed) {
        return;
    }
    overlay._disposed = true;
    cancelGeometryUpdate(overlay);
    const hadFocus = overlay.element.contains(overlay.element.ownerDocument.activeElement);
    for (const cleanup of overlay._cleanup) {
        cleanup();
    }
    overlay._cleanup.length = 0;
    if (overlay.element.contains(overlay.content)) {
        if (overlay._parent) {
            overlay._parent.insertBefore(overlay.content, overlay._next?.parentNode === overlay._parent ? overlay._next : null);
        } else {
            overlay.content.remove();
        }
    }
    overlay.element.remove();
    if (hadFocus) {
        overlay._options.canvas.focus({ preventScroll: true });
    }
}
