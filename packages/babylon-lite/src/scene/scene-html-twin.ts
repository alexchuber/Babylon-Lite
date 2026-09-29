import type { SceneContext } from "./scene-core.js";
import type { SceneNode } from "./scene-node.js";
import { getEffectiveAspectRatio, getViewMatrix, getViewProjectionMatrix } from "../camera/camera.js";
import { resolveCameraViewport } from "../camera/viewport.js";
import { projectWorldToScreenToRef } from "../camera/world-to-screen.js";
import { createSceneAccessibility, disposeSceneAccessibility } from "../accessibility/scene-accessibility.js";
import type { SceneAccessibility, SceneAccessibilityOptions } from "../accessibility/scene-accessibility.js";
import { createHtmlTwin } from "../accessibility/html-twin.js";
import type { HtmlTwin, HtmlTwinOptions } from "../accessibility/html-twin.js";

/** Mount options including automatic projected focus. */
export interface SceneHtmlTwinOptions extends HtmlTwinOptions, SceneAccessibilityOptions {
    /** CSS border for the scene focus rectangle; defaults to the system Highlight color. */
    focusBorder?: string;
}

/** Scene binding and its owned HTML view. */
export interface SceneHtmlTwin {
    readonly accessibility: SceneAccessibility;
    readonly view: HtmlTwin;
}

/** Show an automatically updated marker for one focused scene target. Call the returned cleanup on blur. */
export function showSceneFocusIndicator(
    scene: SceneContext,
    target: Pick<SceneNode, "worldMatrix"> & { boundMin?: readonly number[]; boundMax?: readonly number[] },
    canvas: HTMLCanvasElement,
    border?: string
): () => void {
    const doc = canvas.ownerDocument;
    const view = doc.defaultView!;
    const marker = doc.createElement("div");
    marker.className = "lite-accessibility-scene-focus";
    marker.setAttribute("aria-hidden", "true");
    Object.assign(marker.style, { position: "fixed", pointerEvents: "none", border: border ?? "3px solid Highlight", boxSizing: "border-box", zIndex: "2" });
    doc.body.append(marker);
    let frame = 0;
    const point = { x: 0, y: 0, z: 0 };
    const origin = { x: 0, y: 0, z: 0 };
    const result = { x: 0, y: 0, z: 0, cssX: 0, cssY: 0, clipW: 0, behindCamera: false, clipped: false, offscreen: false };
    let bounds: readonly [left: number, top: number, width: number, height: number] | undefined;
    const setHidden = (hidden: boolean): void => {
        if (marker.hidden !== hidden) {
            marker.hidden = hidden;
        }
    };
    const update = (): void => {
        if (scene._z) {
            marker.remove();
            return;
        }
        const camera = scene.camera;
        const rect = canvas.getBoundingClientRect();
        let visible = false;
        if (camera && rect.width > 0 && rect.height > 0 && canvas.width > 0 && canvas.height > 0) {
            const viewport = resolveCameraViewport(camera, canvas.width, canvas.height);
            if (viewport.width > 0 && viewport.height > 0) {
                const matrix = target.worldMatrix;
                const cameraWorld = camera.worldMatrix;
                origin.x = camera._useFloatingOrigin ? cameraWorld[12]! : 0;
                origin.y = camera._useFloatingOrigin ? cameraWorld[13]! : 0;
                origin.z = camera._useFloatingOrigin ? cameraWorld[14]! : 0;
                const options = { viewport, backingWidth: canvas.width, backingHeight: canvas.height, cssWidth: rect.width, cssHeight: rect.height, worldOrigin: origin };
                const projection = getViewProjectionMatrix(camera, getEffectiveAspectRatio(camera, canvas.width, canvas.height));
                const viewMatrix = getViewMatrix(camera);
                let left = Infinity;
                let top = Infinity;
                let right = -Infinity;
                let bottom = -Infinity;
                const min = target.boundMin;
                const max = target.boundMax;
                let valid = true;
                for (let corner = 0; corner < (min && max ? 8 : 1); corner++) {
                    const x = min && max ? (corner & 1 ? max[0]! : min[0]!) : 0;
                    const y = min && max ? (corner & 2 ? max[1]! : min[1]!) : 0;
                    const z = min && max ? (corner & 4 ? max[2]! : min[2]!) : 0;
                    point.x = x * matrix[0]! + y * matrix[4]! + z * matrix[8]! + matrix[12]!;
                    point.y = x * matrix[1]! + y * matrix[5]! + z * matrix[9]! + matrix[13]!;
                    point.z = x * matrix[2]! + y * matrix[6]! + z * matrix[10]! + matrix[14]!;
                    projectWorldToScreenToRef(point, viewMatrix, projection, options, result);
                    if (result.behindCamera || !Number.isFinite(result.cssX) || result.z < 0 || result.z > 1) {
                        valid = false;
                        break;
                    }
                    left = Math.min(left, result.cssX - 6);
                    top = Math.min(top, result.cssY - 6);
                    right = Math.max(right, result.cssX + 6);
                    bottom = Math.max(bottom, result.cssY + 6);
                }
                if (!valid) {
                    point.x = matrix[12]!;
                    point.y = matrix[13]!;
                    point.z = matrix[14]!;
                    projectWorldToScreenToRef(point, viewMatrix, projection, options, result);
                    valid = !result.clipped;
                    left = result.cssX - 6;
                    top = result.cssY - 6;
                    right = result.cssX + 6;
                    bottom = result.cssY + 6;
                }
                const viewportLeft = (viewport.x * rect.width) / canvas.width;
                const viewportTop = (viewport.y * rect.height) / canvas.height;
                const viewportRight = ((viewport.x + viewport.width) * rect.width) / canvas.width;
                const viewportBottom = ((viewport.y + viewport.height) * rect.height) / canvas.height;
                if (valid && right > viewportLeft && bottom > viewportTop && left < viewportRight && top < viewportBottom) {
                    left = Math.max(viewportLeft, left);
                    top = Math.max(viewportTop, top);
                    right = Math.min(viewportRight, right);
                    bottom = Math.min(viewportBottom, bottom);
                    const next = [rect.left + left, rect.top + top, right - left, bottom - top] as const;
                    if (!bounds || bounds[0] !== next[0]) {
                        marker.style.left = `${next[0]}px`;
                    }
                    if (!bounds || bounds[1] !== next[1]) {
                        marker.style.top = `${next[1]}px`;
                    }
                    if (!bounds || bounds[2] !== next[2]) {
                        marker.style.width = `${next[2]}px`;
                    }
                    if (!bounds || bounds[3] !== next[3]) {
                        marker.style.height = `${next[3]}px`;
                    }
                    bounds = next;
                    visible = true;
                }
            }
        }
        setHidden(!visible);
        frame = view.requestAnimationFrame(update);
    };
    update();
    return () => {
        view.cancelAnimationFrame(frame);
        marker.remove();
    };
}

/** Bind a native scene and mount its HTML twin, including a default scene-space focus marker. */
export function createSceneHtmlTwin(scene: SceneContext, options: SceneHtmlTwinOptions): SceneHtmlTwin {
    const canvas = options.canvas ?? scene.surface.canvas;
    if (!canvas || !("ownerDocument" in canvas)) {
        throw new Error("Scene HTML twins require a DOM canvas; headless scenes can use the semantic tree alone.");
    }
    const accessibility = createSceneAccessibility(scene, options);
    try {
        const view = createHtmlTwin(accessibility.tree, {
            ...options,
            canvas,
            focusVisual: (node, element) => {
                let clearMarker: (() => void) | undefined;
                for (const [source, binding] of accessibility._bindings) {
                    if (binding.node === node) {
                        clearMarker = showSceneFocusIndicator(scene, source, canvas, options.focusBorder);
                        break;
                    }
                }
                let customCleanup: (() => void) | void;
                try {
                    customCleanup = options.focusVisual?.(node, element);
                } catch (error) {
                    clearMarker?.();
                    throw error;
                }
                return () => {
                    clearMarker?.();
                    customCleanup?.();
                };
            },
        });
        return { accessibility, view };
    } catch (error) {
        disposeSceneAccessibility(accessibility);
        throw error;
    }
}

/** Dispose the owned scene adapter and its HTML view. Safe after scene disposal. */
export function disposeSceneHtmlTwin(twin: SceneHtmlTwin): void {
    disposeSceneAccessibility(twin.accessibility);
}
