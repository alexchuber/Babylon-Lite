import {
    addAccessibilityNode,
    createAccessibilityTree,
    removeAccessibilityNode,
    updateAccessibilityNode,
} from "../../../packages/babylon-lite/src/accessibility/accessibility-tree";
import { createHtmlTwin, disposeHtmlTwin } from "../../../packages/babylon-lite/src/accessibility/html-twin";
import { createNativeControl } from "../../../packages/babylon-lite/src/accessibility/native-control";
import type { AccessibilityNode } from "../../../packages/babylon-lite/src/accessibility/accessibility-tree";
import type {} from "./accessibility-fixture-types";

const tree = createAccessibilityTree();
const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
const first = addAccessibilityNode(tree, { tag: { description: "Instruments", role: "group" } });
let activations = 0;
const activate = (): void => {
    document.querySelector("output")!.textContent = String(++activations);
};
const piano = addAccessibilityNode(tree, {
    parent: first,
    tag: { description: "Play piano", aria: { "aria-pressed": false }, eventHandler: { click: activate } },
});
const drum = addAccessibilityNode(tree, { parent: first, tag: { description: "Play drum", eventHandler: { click: activate } } });
const input = document.querySelector<HTMLInputElement>("input")!;
if (new URLSearchParams(location.search).has("focused")) {
    input.value = "abcdef";
    input.focus();
    input.setSelectionRange(1, 4);
}
addAccessibilityNode(tree, { tag: { description: "Player name" }, element: input });
let twin = createHtmlTwin(tree, { parent: document.querySelector("main")!, canvas, label: "Music scene" });
let native: AccessibilityNode | undefined;
const nativeGroup = document.createElement("div");

window.accessibilityFixture = {
    update: () => updateAccessibilityNode(tree, piano, { tag: { description: "Stop piano", aria: { "aria-pressed": true }, eventHandler: { click: activate } } }),
    hide: () => updateAccessibilityNode(tree, piano, { hidden: true }),
    remove: () => removeAccessibilityNode(tree, piano),
    reparent: () => updateAccessibilityNode(tree, piano, { parent: drum }),
    disableGroup: () => updateAccessibilityNode(tree, first, { disabled: true }),
    clearAria: () => updateAccessibilityNode(tree, piano, { tag: { description: "Play piano", eventHandler: { click: activate } } }),
    staticItem: () => updateAccessibilityNode(tree, piano, { tag: { description: "Piano information", role: "note", tabIndex: 0 } }),
    dispose: () => disposeHtmlTwin(twin),
    remount: () => {
        disposeHtmlTwin(twin);
        twin = createHtmlTwin(tree, { parent: document.querySelector("main")!, canvas, label: "Music scene" });
    },
    nativeControl: (disabled) => {
        if (!native) {
            nativeGroup.append(createNativeControl({ kind: "text", label: "Nested input", value: "abcdef" }).element);
            native = addAccessibilityNode(tree, { element: nativeGroup, tag: { description: "Native group", role: "group" } });
        }
        updateAccessibilityNode(tree, native, { disabled });
    },
    dynamicControl: () => nativeGroup.append(createNativeControl({ kind: "text", label: "Dynamic input" }).element),
    clear: () => {
        canvas.removeAttribute("tabindex");
        for (const node of [...tree.roots]) {
            removeAccessibilityNode(tree, node);
        }
    },
    invalid: () => {
        const parent = input.parentNode;
        const roots = tree.roots.length;
        const tag = piano.tag;
        let failures = 0;
        for (const attempt of [
            () => addAccessibilityNode(tree, { element: input }),
            () => updateAccessibilityNode(tree, piano, { tag: { description: "Invalid slider", role: "slider" } }),
            () => {
                const other = createAccessibilityTree();
                addAccessibilityNode(other, { element: input });
                createHtmlTwin(other, { parent: document.querySelector("main")! });
            },
        ]) {
            try {
                attempt();
            } catch (error) {
                if (!(error instanceof Error)) {
                    throw error;
                }
                failures++;
            }
        }
        return { failures, unchanged: input.parentNode === parent && tree.roots.length === roots && piano.tag === tag };
    },
};
document.body.dataset.ready = "true";
