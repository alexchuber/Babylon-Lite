import {
    addToScene,
    createFreeCamera,
    createNullEngine,
    createSceneContext,
    createSceneHtmlTwin,
    createTransformNode,
    disposeScene,
    setAccessibilityTag,
    createNativeControl,
    createHtmlOverlay,
    disposeHtmlOverlay,
    attachFreeControl,
    stepScene,
    enableOrthographicCamera,
    setParent,
    setHtmlOverlayVisible,
} from "babylon-lite";
import type { SceneNode } from "babylon-lite";
import { createGLEngine, disposeGLEngine } from "babylon-lite-gl";
import { NullEngine } from "../../../packages/babylon-lite-compat/src/engine/engine";
import { Scene } from "../../../packages/babylon-lite-compat/src/scene/scene";
import { TransformNode } from "../../../packages/babylon-lite-compat/src/meshes/meshes";
import { HTMLTwinRenderer } from "../../../packages/babylon-lite-compat/src/accessibility/html-twin";
import { ActionManager, ExecuteCodeAction } from "../../../packages/babylon-lite-compat/src/actions/actions";
import type {} from "./accessibility-fixture-types";

const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const parent = document.querySelector("main")!;
const output = document.querySelector("output")!;
let count = 0;
const activate = (): void => {
    output.textContent = String(++count);
};
const parameters = new URLSearchParams(location.search);
const mode = parameters.get("mode") ?? "scene";

if (mode === "scene") {
    const engine = createNullEngine();
    const scene = createSceneContext(engine, { defaultRenderTask: false });
    const camera = createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
    camera.inertia = 0;
    scene.camera = camera;
    const focusCanvas = parameters.has("secondary") ? document.createElement("canvas") : canvas;
    if (focusCanvas !== canvas) {
        focusCanvas.id = "secondary";
        focusCanvas.width = 640;
        focusCanvas.height = 400;
        focusCanvas.style.width = "320px";
        focusCanvas.style.height = "200px";
        focusCanvas.tabIndex = 0;
        canvas.after(focusCanvas);
    }
    const view = createSceneHtmlTwin(scene, { parent, canvas: focusCanvas, label: "Native scene", focusBorder: "4px solid rgb(255, 0, 0)" });
    const source: SceneNode & { boundMin?: readonly number[]; boundMax?: readonly number[] } = Object.assign(createTransformNode("Instrument"), {
        boundMin: [-1, -1, -1],
        boundMax: [1, 1, 1],
    });
    addToScene(scene, source);
    setAccessibilityTag(source, { description: "Play instrument", eventHandler: { click: activate, contextmenu: activate } });
    const detachCamera = attachFreeControl(camera, canvas, scene);
    window.accessibilityProjection = {
        configure: (value) => {
            switch (value) {
                case "orthographic":
                    enableOrthographicCamera(camera, { halfHeight: 4 });
                    break;
                case "viewport":
                    focusCanvas.width = 1280;
                    focusCanvas.height = 720;
                    focusCanvas.style.width = "640px";
                    focusCanvas.style.height = "360px";
                    camera.viewport = { x: 0.5, y: 0, width: 0.5, height: 1 };
                    source.scaling.x = 100;
                    break;
                case "near":
                    camera.nearPlane = 0.1;
                    source.position.z = -4.5;
                    break;
                case "behind":
                    source.position.z = -10;
                    break;
                case "origin":
                    source.boundMin = undefined;
                    source.boundMax = undefined;
                    break;
                case "floating":
                    camera._useFloatingOrigin = true;
                    camera.position.x = 1_000_000;
                    camera.target.x = 1_000_000;
                    source.position.x = 1_000_000;
                    break;
                case "parent": {
                    const group = createTransformNode("Moving parent");
                    addToScene(scene, group);
                    setParent(source, group);
                    group.position.x = 1;
                    break;
                }
                case "resize":
                    focusCanvas.style.width = "320px";
                    focusCanvas.style.height = "180px";
                    break;
            }
            return new Promise<void>((resolve) => {
                requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
            });
        },
    };
    window.accessibilityIntegration = {
        disable: () => setAccessibilityTag(source, { description: "Play instrument", disabled: true, eventHandler: { click: activate } }),
        move: () => {
            source.position.x = 1;
        },
        dispose: () => {
            detachCamera();
            disposeScene(scene);
        },
        tick: () => {
            stepScene(engine, scene, 16);
            return camera.position.z;
        },
    };
    if (!view.accessibility.tree) {
        throw new Error("Scene accessibility did not initialize.");
    }
    window.accessibilityRace = {
        run: (state) => {
            const button = view.view.element.querySelector<HTMLButtonElement>("button")!;
            if (state === "disposed") {
                window.accessibilityIntegration.dispose();
            } else {
                setAccessibilityTag(source, { description: "Play instrument", [state]: true, eventHandler: { click: activate } });
            }
            button.click();
        },
    };
} else if (mode === "gl") {
    const engine = createGLEngine(canvas);
    const content = document.querySelector<HTMLElement>("#content")!;
    content.addEventListener("submit", (event) => {
        event.preventDefault();
        output.textContent = "submitted";
    });
    const controls = [
        createNativeControl({ kind: "checkbox", label: "Enable sound", checked: false }),
        createNativeControl({ kind: "radio", label: "Piano", name: "instrument", checked: true }),
        createNativeControl({ kind: "radio", label: "Drum", name: "instrument" }),
        createNativeControl({ kind: "range", label: "Volume", min: 0, max: 10, value: 5 }),
        createNativeControl({ kind: "text", label: "Player", value: "Alex" }),
        createNativeControl({
            kind: "select",
            label: "Tempo",
            choices: [
                { label: "Slow", value: "slow" },
                { label: "Fast", value: "fast" },
            ],
        }),
        createNativeControl({ kind: "button", label: "Play", onClick: activate }),
    ];
    for (const control of controls) {
        content.append(control.element);
    }
    if (parameters.has("focused")) {
        const input = content.querySelector<HTMLInputElement>('input[type="text"]')!;
        input.focus();
        input.setSelectionRange(1, 3);
    }
    const overlay = createHtmlOverlay({ canvas, element: content, parent, mode: "overlay", label: "GL controls" });
    canvas.dataset.backend = "webgl2";
    window.accessibilityIntegration = {
        disable: () => setHtmlOverlayVisible(overlay, false),
        move: () => {
            canvas.style.width = "320px";
        },
        dispose: () => {
            disposeHtmlOverlay(overlay);
            disposeGLEngine(engine);
        },
        tick: () => {
            setHtmlOverlayVisible(overlay, true);
            return 0;
        },
    };
} else {
    const engine = new NullEngine();
    engine.getRenderingCanvas = () => canvas;
    const scene = new Scene(engine);
    const source = new TransformNode("Compat instrument", scene);
    source.accessibilityTag = { description: "Play compat instrument" };
    source.actionManager = new ActionManager();
    const pick = new ExecuteCodeAction(1, (event) => {
        if (event?.source !== source) {
            throw new Error("The twin dispatched a replacement wrapper.");
        }
        activate();
    });
    source.actionManager.registerAction(pick);
    const second = new TransformNode("Second", scene);
    second.accessibilityTag = { description: "Second action", eventHandler: { click: () => {} } };
    const keys = new ActionManager(scene);
    keys.registerAction(
        new ExecuteCodeAction({ trigger: ActionManager.OnKeyDownTrigger, parameter: "k" }, (event) => {
            if (event?.source !== scene || !(event.sourceEvent instanceof KeyboardEvent)) {
                throw new Error("Keyboard actions lost the original event or scene source.");
            }
            activate();
        })
    );
    scene.actionManager = keys;
    const renderer = HTMLTwinRenderer.Render(scene, { parentElement: parent, canvas, roots: [source, second] });
    let recursiveManager: ActionManager | undefined;
    window.accessibilityActions = {
        removePick: () => {
            source.actionManager!.unregisterAction(pick);
        },
        addPick: () => {
            source.actionManager!.registerAction(pick);
        },
        setOrder: () => {
            source.accessibilityTag = { ...source.accessibilityTag, tabIndex: 2 };
            second.accessibilityTag = { ...second.accessibilityTag, tabIndex: 1 };
        },
        replaceSceneManager: () => {
            scene.actionManager = new ActionManager(scene);
        },
        disposeManager: () => {
            scene.actionManager!.dispose();
        },
        invalidTag: () => {
            const before = source.accessibilityTag;
            let failed = false;
            try {
                source.accessibilityTag = { description: "Invalid slider", role: "slider" };
            } catch {
                failed = true;
            }
            return { failed, unchanged: source.accessibilityTag === before };
        },
        parentSecond: () => {
            second.parent = source;
        },
        disposeParent: () => {
            source.accessibilityTag = { description: "Retiring parent" };
            source.dispose(true);
        },
        recursive: (enabled) => {
            if (!recursiveManager) {
                const group = new TransformNode("Action group", scene);
                const child = new TransformNode("Inherited", scene);
                child.accessibilityTag = { description: "Inherited action" };
                child.parent = group;
                recursiveManager = new ActionManager(scene);
                group.actionManager = recursiveManager;
                for (const trigger of [ActionManager.OnLeftPickTrigger, ActionManager.OnPickTrigger]) {
                    recursiveManager.registerAction(
                        new ExecuteCodeAction(trigger, (event) => {
                            if (event?.source !== child || !(event.sourceEvent instanceof MouseEvent)) {
                                throw new Error("Inherited action lost the canonical child or original event.");
                            }
                            output.textContent += trigger === ActionManager.OnLeftPickTrigger ? "left " : "pick";
                        })
                    );
                }
            }
            recursiveManager.isRecursive = enabled;
        },
    };
    window.accessibilityIntegration = {
        disable: () => {
            source.setEnabled(false);
        },
        move: () => {
            source.accessibilityTag = {
                description: "Explicit action",
                eventHandler: {
                    click: () => {
                        output.textContent = "explicit";
                    },
                },
            };
        },
        dispose: () => {
            scene.dispose();
        },
        tick: () => (renderer.focus(source) ? 1 : 0),
    };
    window.accessibilityRace = {
        run: (state) => {
            const button = renderer.view.element.querySelector<HTMLButtonElement>("button")!;
            if (state === "disposed") {
                window.accessibilityIntegration.dispose();
            } else {
                source.accessibilityTag = { ...source.accessibilityTag, [state]: true };
            }
            button.click();
        },
    };
}
document.body.dataset.ready = "true";
