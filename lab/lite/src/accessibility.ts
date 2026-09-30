import {
    addToScene,
    createNullEngine,
    createSceneContext,
    createSceneHtmlTwin,
    createTransformNode,
    disposeScene,
    removeFromScene,
    setAccessibilityTag,
    setParent,
} from "babylon-lite";

const scene = createSceneContext(createNullEngine(), { defaultRenderTask: false });
const group = createTransformNode("Solar system");
const mars = createTransformNode("Mars");
const descriptionOnly = createTransformNode("Source name");

setAccessibilityTag(group, { name: "Planets", role: "group" });
setAccessibilityTag(mars, {
    name: "Mars",
    description: "The fourth planet from the Sun",
    role: "button",
    aria: {
        "aria-pressed": false,
        "aria-roledescription": "planet",
        "aria-live": "polite",
    },
});
setAccessibilityTag(descriptionOnly, {
    description: "A description-only object",
    role: "img",
});
setParent(mars, group);

const twin = createSceneHtmlTwin(scene, {
    parent: document.querySelector<HTMLElement>("#accessibility")!,
    label: "Solar system scene",
});
addToScene(scene, group);
addToScene(scene, descriptionOnly);

Object.assign(window, {
    accessibilityFixture: {
        replace(): void {
            setAccessibilityTag(mars, {
                name: "Mars <updated>",
                description: "Updated description",
                role: "heading",
                aria: { "aria-level": 2 },
            });
        },
        hide(hidden: boolean): void {
            mars.visible = !hidden;
        },
        reparent(): void {
            setParent(mars, null);
        },
        remove(): void {
            removeFromScene(scene, mars);
        },
        dispose(): void {
            disposeScene(scene);
        },
        twin,
    },
});

document.body.dataset.ready = "true";
