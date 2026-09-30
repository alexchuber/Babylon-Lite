import { createHtmlTwin, disposeHtmlTwin } from "../accessibility/html-twin.js";
import type { HtmlTwin, HtmlTwinOptions } from "../accessibility/html-twin.js";
import { createSceneAccessibility, disposeSceneAccessibility } from "../accessibility/scene-accessibility.js";
import type { SceneAccessibility, SceneAccessibilityOptions } from "../accessibility/scene-accessibility.js";
import type { SceneContext } from "./scene-core.js";

/** Options for mounting a scene's HTML representation. */
export interface SceneHtmlTwinOptions extends HtmlTwinOptions, SceneAccessibilityOptions {}

/** A scene binding and its owned HTML view. */
export interface SceneHtmlTwin {
    readonly accessibility: SceneAccessibility;
    readonly view: HtmlTwin;
}

/** Bind a scene and mount its HTML representation. */
export function createSceneHtmlTwin(scene: SceneContext, options: SceneHtmlTwinOptions): SceneHtmlTwin {
    const accessibility = createSceneAccessibility(scene, options);
    try {
        return {
            accessibility,
            view: createHtmlTwin(accessibility.tree, options),
        };
    } catch (error) {
        disposeSceneAccessibility(accessibility);
        throw error;
    }
}

/** Dispose the HTML view and scene binding. */
export function disposeSceneHtmlTwin(twin: SceneHtmlTwin): void {
    disposeHtmlTwin(twin.view);
    disposeSceneAccessibility(twin.accessibility);
}
