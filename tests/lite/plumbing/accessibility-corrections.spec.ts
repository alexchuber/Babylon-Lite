import { expect, test } from "@playwright/test";
import type * as Lite from "../../../packages/babylon-lite/src/index";
import type * as CompatScene from "../../../packages/babylon-lite-compat/src/scene/scene";
import type * as CompatEngine from "../../../packages/babylon-lite-compat/src/engine/engine";
import type * as CompatMeshes from "../../../packages/babylon-lite-compat/src/meshes/meshes";
import type * as CompatTwin from "../../../packages/babylon-lite-compat/src/accessibility/html-twin";
import type * as CompatActions from "../../../packages/babylon-lite-compat/src/actions/actions";
import type {} from "../../../lab/lite/src/accessibility-fixture-types";

const base = `/@fs/${process.cwd()}/packages/`;
const urls = {
    lite: `${base}babylon-lite/src/index.ts`,
    scene: `${base}babylon-lite-compat/src/scene/scene.ts`,
    engine: `${base}babylon-lite-compat/src/engine/engine.ts`,
    meshes: `${base}babylon-lite-compat/src/meshes/meshes.ts`,
    twin: `${base}babylon-lite-compat/src/accessibility/html-twin.ts`,
    actions: `${base}babylon-lite-compat/src/actions/actions.ts`,
};

test.beforeEach(async ({ page }) => {
    await page.goto(`http://localhost:${process.env.LAB_TEST_PORT ?? 5179}/lite/accessibility-test.html`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.accessibilityFixture.dispose());
});

for (const focusThrows of [false, true]) {
    test(`R1 terminal scene cleanup drains multiple views despite application errors (focus error: ${focusThrows})`, async ({ page }) => {
        const result = await page.evaluate(
            async ({ urls, focusThrows }) => {
                const api: typeof Lite = await import(urls.lite);
                const scene = api.createSceneContext(api.createNullEngine(), { defaultRenderTask: false });
                const other = api.createSceneContext(api.createNullEngine(), { defaultRenderTask: false });
                api.onSceneDispose(scene, () => {
                    throw new Error("Application cleanup failed");
                });
                const source = api.createTransformNode("Shared");
                const descriptor = Object.getOwnPropertyDescriptor(source, "visible");
                let activations = 0;
                let cleanups = 0;
                api.setAccessibilityTag(source, { name: "Scene action", eventHandler: { click: () => activations++ } });
                const adapters = [api.createSceneAccessibility(scene, { roots: [source] }), api.createSceneAccessibility(scene, { roots: [source] })];
                const surviving = api.createSceneAccessibility(other, { roots: [source] });
                const views = adapters.map((adapter) =>
                    api.createHtmlTwin(adapter.tree, {
                        parent: document.body,
                        focusVisual: () => () => {
                            cleanups++;
                            if (focusThrows) {
                                throw new Error("Focus cleanup failed");
                            }
                        },
                    })
                );
                const buttons = views.map((view) => view.element.querySelector("button")!);
                buttons[0]!.focus();
                const messages: string[] = [];
                const record = (error: unknown): void => {
                    if (error instanceof AggregateError) {
                        error.errors.forEach(record);
                    } else {
                        messages.push(String(error));
                    }
                };
                try {
                    api.disposeScene(scene);
                } catch (error) {
                    record(error);
                }
                buttons.forEach((button) => button.click());
                api.setAccessibilityTag(source, { name: "Still shared" });
                await Promise.resolve();
                const sharedName = api.getAccessibilityNode(surviving, source)?.tag?.name;
                const disposed = adapters.every((adapter) => adapter.tree.disposed && adapter._disposed);
                const disconnected = views.every((view) => !view.element.isConnected && view._disposed);
                api.disposeScene(other);
                api.disposeScene(scene);
                return {
                    messages,
                    disposed,
                    disconnected,
                    activations,
                    cleanups,
                    sharedName,
                    restored: JSON.stringify(Object.getOwnPropertyDescriptor(source, "visible")) === JSON.stringify(descriptor),
                };
            },
            { urls, focusThrows }
        );
        expect(result).toMatchObject({ disposed: true, disconnected: true, activations: 0, cleanups: 1, sharedName: "Still shared", restored: true });
        expect(result.messages.some((message) => message.includes("Application cleanup failed"))).toBe(true);
        expect(result.messages.some((message) => message.includes("Focus cleanup failed"))).toBe(focusThrows);
    });
}

for (const reverseDisposal of [false, true]) {
    test(`R2 rejects cross-view descendant and ancestor ownership atomically (reverse disposal: ${reverseDisposal})`, async ({ page }) => {
        const result = await page.evaluate(
            async ({ urls, reverseDisposal }) => {
                const api: typeof Lite = await import(urls.lite);
                const original = document.createElement("section");
                const firstHost = document.createElement("section");
                const secondHost = document.createElement("section");
                const group = document.createElement("div");
                const button = document.createElement("button");
                group.append(button);
                original.append(group);
                document.body.append(original, firstHost, secondHost);
                const firstTree = api.createAccessibilityTree();
                api.addAccessibilityNode(firstTree, { element: group });
                const first = api.createHtmlTwin(firstTree, { parent: firstHost });
                const secondTree = api.createAccessibilityTree();
                const secondNode = api.addAccessibilityNode(secondTree, { tag: { name: "Unchanged" } });
                const second = api.createHtmlTwin(secondTree, { parent: secondHost });
                const failures: boolean[] = [];
                for (const element of [button, firstHost]) {
                    const tree = api.createAccessibilityTree();
                    api.addAccessibilityNode(tree, { element });
                    try {
                        api.createHtmlTwin(tree, { parent: document.body });
                        failures.push(false);
                    } catch {
                        failures.push(true);
                    }
                    try {
                        api.updateAccessibilityNode(secondTree, secondNode, { element });
                        failures.push(false);
                    } catch {
                        failures.push(true);
                    }
                }
                const intact = group.contains(button) && first.element.contains(group) && !secondNode.element && secondNode.tag?.name === "Unchanged";
                const views = reverseDisposal ? [second, first] : [first, second];
                views.forEach(api.disposeHtmlTwin);
                return {
                    failures,
                    intact,
                    restored: group.parentElement === original && button.parentElement === group,
                    remaining: document.querySelectorAll(".lite-accessibility").length,
                };
            },
            { urls, reverseDisposal }
        );
        expect(result).toEqual({ failures: [true, true, true, true], intact: true, restored: true, remaining: 0 });
    });
}

for (const mode of ["overlay", "twin"] as const) {
    test(`R3 ${mode} rejects external implicit form disassociation before any DOM or model change`, async ({ page }) => {
        const result = await page.evaluate(
            async ({ urls, mode }) => {
                const api: typeof Lite = await import(urls.lite);
                const form = document.createElement("form");
                const group = document.createElement("div");
                const input = document.createElement("input");
                input.name = "player";
                input.value = "Alex";
                group.append(input);
                form.append(group);
                const canvas = document.createElement("canvas");
                document.body.append(form, canvas);
                const failures: boolean[] = [];
                for (const element of [input, group]) {
                    try {
                        if (mode === "overlay") {
                            api.createHtmlOverlay({ canvas, element });
                        } else {
                            const tree = api.createAccessibilityTree();
                            api.addAccessibilityNode(tree, { element });
                            api.createHtmlTwin(tree, { parent: document.body });
                        }
                        failures.push(false);
                    } catch {
                        failures.push(true);
                    }
                }
                let unchanged = true;
                if (mode === "twin") {
                    const tree = api.createAccessibilityTree();
                    const node = api.addAccessibilityNode(tree, { tag: { name: "Original" } });
                    api.createHtmlTwin(tree, { parent: document.body });
                    try {
                        api.updateAccessibilityNode(tree, node, { element: group, tag: { name: "Invalid" } });
                        failures.push(false);
                    } catch {
                        failures.push(true);
                    }
                    unchanged = !node.element && node.tag?.name === "Original";
                }
                return {
                    failures,
                    unchanged,
                    form: input.form === form,
                    value: new FormData(form).get("player"),
                    parent: input.parentElement === group && group.parentElement === form,
                };
            },
            { urls, mode }
        );
        expect(result).toEqual({ failures: mode === "twin" ? [true, true, true] : [true, true], unchanged: true, form: true, value: "Alex", parent: true });
    });

    for (const association of ["whole-form", "same-form", "explicit"] as const) {
        test(`R3 ${mode} preserves ${association} native submission and validation`, async ({ page }) => {
            const result = await page.evaluate(
                async ({ urls, mode, association }) => {
                    const api: typeof Lite = await import(urls.lite);
                    const form = document.createElement("form");
                    form.id = "player-form";
                    const group = document.createElement("div");
                    const input = document.createElement("input");
                    input.name = "player";
                    input.required = true;
                    if (association === "explicit") {
                        input.setAttribute("form", form.id);
                    }
                    group.append(input);
                    form.append(group);
                    const canvas = document.createElement("canvas");
                    document.body.append(form, canvas);
                    let submits = 0;
                    let invalid = 0;
                    let value: FormDataEntryValue | null = null;
                    form.addEventListener("submit", (event) => {
                        event.preventDefault();
                        submits++;
                        value = new FormData(form).get("player");
                    });
                    input.addEventListener("invalid", () => invalid++);
                    const element = association === "whole-form" ? form : group;
                    const parent = association === "same-form" ? form : document.body;
                    const tree = api.createAccessibilityTree();
                    const hosted = mode === "overlay" ? api.createHtmlOverlay({ canvas, element, parent }) : api.createHtmlTwin(tree, { parent });
                    if (mode === "twin") {
                        api.addAccessibilityNode(tree, { element });
                    }
                    const sameForm = input.form === form;
                    form.requestSubmit();
                    const blocked = submits === 0 && invalid === 1;
                    input.value = "Alex";
                    form.requestSubmit();
                    if ("content" in hosted) {
                        api.disposeHtmlOverlay(hosted);
                    } else {
                        api.disposeHtmlTwin(hosted);
                    }
                    return { sameForm, blocked, submits, value, restored: group.parentElement === form && input.form === form };
                },
                { urls, mode, association }
            );
            expect(result).toEqual({ sameForm: true, blocked: true, submits: 1, value: "Alex", restored: true });
        });
    }
}

test("R4 generated leaf roles expose effective names with ARIA precedence through updates and group transitions", async ({ page }) => {
    await page.evaluate(async (urls) => {
        const api: typeof Lite = await import(urls.lite);
        const label = document.createElement("span");
        label.id = "author-label";
        label.textContent = "Referenced image";
        document.body.append(label);
        const tree = api.createAccessibilityTree();
        for (const role of ["img", "group", "region"]) {
            api.addAccessibilityNode(tree, { tag: { name: `Named ${role}`, role } });
        }
        api.addAccessibilityNode(tree, { tag: { name: "Fallback", role: "img", aria: { "aria-label": "Explicit image", "aria-labelledby": "author-label" } } });
        api.createHtmlTwin(tree, { parent: document.body, label: "Role tests" });
        const change = (): void => {
            for (const node of tree.roots.slice(0, 3)) {
                api.updateAccessibilityNode(tree, node, { tag: { ...node.tag, name: `Updated ${node.tag!.role}` } });
                const child = api.addAccessibilityNode(tree, { parent: node, tag: { name: "Child" } });
                api.removeAccessibilityNode(tree, child);
            }
            const last = tree.roots[3]!;
            api.updateAccessibilityNode(tree, last, { tag: { ...last.tag, aria: { "aria-label": "Explicit image" } } });
        };
        document.addEventListener("change-role-tests", change, { once: true });
    }, urls);
    const session = await page.context().newCDPSession(page);
    try {
        for (const updated of [false, true]) {
            if (updated) {
                await page.evaluate(() => document.dispatchEvent(new Event("change-role-tests")));
            }
            const { nodes } = await session.send("Accessibility.getFullAXTree");
            for (const [role, authored] of [
                ["image", "img"],
                ["group", "group"],
                ["region", "region"],
            ]) {
                expect(nodes.some((node) => !node.ignored && node.role?.value === role && node.name?.value === `${updated ? "Updated" : "Named"} ${authored}`)).toBe(true);
            }
            expect(nodes.some((node) => !node.ignored && node.role?.value === "image" && node.name?.value === (updated ? "Explicit image" : "Referenced image"))).toBe(true);
        }
    } finally {
        await session.detach();
    }
});

for (const mode of ["native", "compat"] as const) {
    for (const state of ["disabled", "hidden"] as const) {
        test(`R6 ${mode} reparenting under ${state} ancestors blocks primary, secondary, and focus before flushing`, async ({ page }) => {
            const result = await page.evaluate(
                async ({ urls, mode, state }) => {
                    const api: typeof Lite = await import(urls.lite);
                    let activations = 0;
                    let focusCalls = 0;
                    const handlers = { click: () => activations++, contextmenu: () => activations++, focus: () => focusCalls++ };
                    let button: HTMLElement;
                    let reparent: () => void;
                    let focus: () => boolean;
                    let cleanup: () => void;
                    if (mode === "native") {
                        const scene = api.createSceneContext(api.createNullEngine(), { defaultRenderTask: false });
                        const parent = api.createTransformNode("Unavailable");
                        const child = api.createTransformNode("Action");
                        api.setAccessibilityTag(parent, { name: "Unavailable", [state]: true });
                        api.setAccessibilityTag(child, { name: "Action", eventHandler: handlers });
                        const adapter = api.createSceneAccessibility(scene, { roots: [parent, child] });
                        const view = api.createHtmlTwin(adapter.tree, { parent: document.body });
                        const node = api.getAccessibilityNode(adapter, child)!;
                        button = api.getHtmlTwinElement(view, node)!;
                        reparent = () => api.setParent(child, parent);
                        focus = () => api.focusHtmlTwinNode(view, node);
                        cleanup = () => api.disposeScene(scene);
                    } else {
                        const { Scene }: typeof CompatScene = await import(urls.scene);
                        const { NullEngine }: typeof CompatEngine = await import(urls.engine);
                        const { TransformNode }: typeof CompatMeshes = await import(urls.meshes);
                        const { HTMLTwinRenderer }: typeof CompatTwin = await import(urls.twin);
                        const engine = new NullEngine();
                        const canvas = document.createElement("canvas");
                        document.body.append(canvas);
                        engine.getRenderingCanvas = () => canvas;
                        const scene = new Scene(engine);
                        const parent = new TransformNode("Unavailable", scene);
                        const child = new TransformNode("Action", scene);
                        parent.accessibilityTag = { description: "Unavailable", [state]: true };
                        child.accessibilityTag = { description: "Action", eventHandler: handlers };
                        const renderer = HTMLTwinRenderer.Render(scene, { roots: [parent, child], parentElement: document.body });
                        button = renderer.view.element.querySelector("button")!;
                        reparent = () => {
                            child.parent = parent;
                        };
                        focus = () => renderer.focus(child);
                        cleanup = () => scene.dispose();
                    }
                    reparent();
                    button.click();
                    button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
                    button.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true }));
                    button.focus();
                    const directFocus = document.activeElement === button;
                    const accepted = focus();
                    const counts = { activations, focusCalls, directFocus, accepted };
                    await Promise.resolve();
                    cleanup();
                    return counts;
                },
                { urls, mode, state }
            );
            expect(result).toEqual({ activations: 0, focusCalls: 0, directFocus: false, accepted: false });
        });
    }
}

test("R7 reconciliation respects an authored blur handler's newer external focus destination", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const api: typeof Lite = await import(urls.lite);
        const outside = document.createElement("button");
        document.body.append(outside);
        const tree = api.createAccessibilityTree();
        let blurs = 0;
        const node = api.addAccessibilityNode(tree, {
            tag: {
                name: "Action",
                eventHandler: {
                    click: () => {},
                    blur: () => {
                        blurs++;
                        outside.focus();
                    },
                },
            },
        });
        const parent = api.addAccessibilityNode(tree, { tag: { name: "Parent", role: "group" } });
        const twin = api.createHtmlTwin(tree, { parent: document.body });
        api.focusHtmlTwinNode(twin, node);
        api.updateAccessibilityNode(tree, node, { parent });
        return { blurs, outside: document.activeElement === outside };
    }, urls);
    expect(result).toEqual({ blurs: 1, outside: true });
});

test("R8 metadata changes touch only dirty items, without rewriting live regions or scanning unrelated content", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const api: typeof Lite = await import(urls.lite);
        const tree = api.createAccessibilityTree();
        const changed = api.addAccessibilityNode(tree, { tag: { name: "Change me", eventHandler: { click: () => {} } } });
        const live = api.addAccessibilityNode(tree, { tag: { name: "Unchanged live content", role: "status", aria: { "aria-live": "polite" } } });
        const group = api.addAccessibilityNode(tree, { tag: { name: "Unchanged group", role: "group" } });
        api.addAccessibilityNode(tree, { parent: group, tag: { name: "Unchanged child" } });
        const twin = api.createHtmlTwin(tree, { parent: document.body });
        const liveElement = api.getHtmlTwinElement(twin, live)!;
        const groupElement = api.getHtmlTwinElement(twin, group)!;
        const observer = new MutationObserver(() => {});
        observer.observe(twin.element, { subtree: true, attributes: true, childList: true, characterData: true });
        let unrelatedReads = 0;
        const liveTag = live.tag;
        Object.defineProperty(live, "tag", {
            configurable: true,
            get: () => {
                unrelatedReads++;
                return liveTag;
            },
        });
        api.updateAccessibilityNode(tree, changed, { tag: { ...changed.tag, name: "Changed" } });
        const records = observer.takeRecords();
        const untouched = records.filter((record) => liveElement.contains(record.target) || groupElement.contains(record.target)).length;
        const metadataReads = unrelatedReads;
        api.updateAccessibilityNode(tree, changed, { tag: changed.tag });
        const repeatedWrites = observer.takeRecords().length;
        observer.disconnect();
        return { untouched, metadataReads, repeatedWrites, changed: api.getHtmlTwinElement(twin, changed)?.textContent };
    }, urls);
    expect(result).toEqual({ untouched: 0, metadataReads: 0, repeatedWrites: 0, changed: "Changed" });
});

test("R9 rejected scene action-manager replacement preserves the old property and keyboard listeners", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const { Scene }: typeof CompatScene = await import(urls.scene);
        const { NullEngine }: typeof CompatEngine = await import(urls.engine);
        const { ActionManager, ExecuteCodeAction }: typeof CompatActions = await import(urls.actions);
        const canvas = document.createElement("canvas");
        document.body.append(canvas);
        const engine = new NullEngine();
        engine.getRenderingCanvas = () => canvas;
        const scene = new Scene(engine);
        const original = new ActionManager(scene);
        let count = 0;
        original.registerAction(new ExecuteCodeAction(ActionManager.OnKeyDownTrigger, () => count++));
        scene.actionManager = original;
        canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
        const invalid = new ActionManager(scene);
        invalid.dispose();
        let rejected = false;
        try {
            scene.actionManager = invalid;
        } catch {
            rejected = true;
        }
        canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
        const preserved = scene.actionManager === original;
        scene.dispose();
        canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
        return { rejected, preserved, count };
    }, urls);
    expect(result).toEqual({ rejected: true, preserved: true, count: 2 });
});
