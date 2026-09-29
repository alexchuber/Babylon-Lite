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

for (const order of ["accessibility-first", "animation-first"] as const) {
    test(`F11 terminal cleanup detaches animation and accessibility bindings (${order})`, async ({ page }) => {
        const result = await page.evaluate(
            async ({ urls, order }) => {
                const api: typeof Lite = await import(urls.lite);
                const scene = api.createSceneContext(api.createNullEngine(), { defaultRenderTask: false });
                const manager = api.createAnimationManager();
                let adapter: Lite.SceneAccessibility;
                if (order === "accessibility-first") {
                    adapter = api.createSceneAccessibility(scene);
                    api.bindAnimationManagerToScene(scene, manager);
                } else {
                    api.bindAnimationManagerToScene(scene, manager);
                    adapter = api.createSceneAccessibility(scene);
                }
                scene._disposables.push(() => {
                    throw new Error("Application cleanup failed");
                });
                let message = "";
                try {
                    api.disposeScene(scene);
                } catch (error) {
                    message = String(error);
                }
                return {
                    message,
                    adapterDisposed: adapter.tree.disposed,
                    managerDetached: manager._startGuard === undefined && !scene._beforeRender.length,
                };
            },
            { urls, order }
        );
        expect(result).toEqual({
            message: "Error: Application cleanup failed",
            adapterDisposed: true,
            managerDetached: true,
        });
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

for (const hiddenSource of ["node", "tag", "aria"] as const) {
    test(`F01 focused descendants recover when ${hiddenSource} hides an ancestor`, async ({ page }) => {
        const result = await page.evaluate(
            async ({ urls, hiddenSource }) => {
                const api: typeof Lite = await import(urls.lite);
                const tree = api.createAccessibilityTree();
                const parent = api.addAccessibilityNode(tree, { tag: { name: "Group", role: "group" } });
                const focused = api.addAccessibilityNode(tree, { parent, tag: { name: "Focused", eventHandler: { click: () => {} } } });
                const fallback = api.addAccessibilityNode(tree, { tag: { name: "Fallback", eventHandler: { click: () => {} } } });
                const twin = api.createHtmlTwin(tree, { parent: document.body });
                api.focusHtmlTwinNode(twin, focused);
                if (hiddenSource === "node") {
                    api.updateAccessibilityNode(tree, parent, { hidden: true });
                } else if (hiddenSource === "tag") {
                    api.updateAccessibilityNode(tree, parent, { tag: { ...parent.tag, hidden: true } });
                } else {
                    api.updateAccessibilityNode(tree, parent, { tag: { ...parent.tag, aria: { "aria-hidden": true } } });
                }
                return {
                    fallbackFocused: document.activeElement === api.getHtmlTwinElement(twin, fallback),
                    focusedHidden: api.getHtmlTwinElement(twin, focused)?.closest("[hidden]") !== null,
                };
            },
            { urls, hiddenSource }
        );
        expect(result).toEqual({ fallbackFocused: true, focusedHidden: true });
    });
}

for (const mode of ["native", "compat"] as const) {
    for (const unavailable of ["hidden", "disabled", "aria-hidden", "aria-disabled"] as const) {
        test(`G01 ${mode} ${unavailable} ancestor updates recover focus and native descendant state`, async ({ page }) => {
            const result = await page.evaluate(
                async ({ urls, mode, unavailable }) => {
                    const api: typeof Lite = await import(urls.lite);
                    let focusedElement: HTMLElement;
                    let fallbackElement: HTMLElement;
                    let updateParent: () => void;
                    let cleanup: () => void;
                    if (mode === "native") {
                        const scene = api.createSceneContext(api.createNullEngine(), { defaultRenderTask: false });
                        const parent = api.createTransformNode("Parent");
                        const focused = api.createTransformNode("Focused");
                        const fallback = api.createTransformNode("Fallback");
                        api.setParent(focused, parent);
                        api.setAccessibilityTag(parent, { name: "Parent", role: "group" });
                        api.setAccessibilityTag(focused, { name: "Focused", eventHandler: { click: () => {} } });
                        api.setAccessibilityTag(fallback, { name: "Fallback", eventHandler: { click: () => {} } });
                        const adapter = api.createSceneAccessibility(scene, { roots: [parent, fallback] });
                        const twin = api.createHtmlTwin(adapter.tree, { parent: document.body });
                        focusedElement = api.getHtmlTwinElement(twin, api.getAccessibilityNode(adapter, focused)!)!;
                        fallbackElement = api.getHtmlTwinElement(twin, api.getAccessibilityNode(adapter, fallback)!)!;
                        api.focusHtmlTwinNode(twin, api.getAccessibilityNode(adapter, focused)!);
                        updateParent = () =>
                            api.setAccessibilityTag(
                                parent,
                                unavailable.startsWith("aria-")
                                    ? { name: "Parent", role: "group", aria: { [unavailable]: true } }
                                    : { name: "Parent", role: "group", [unavailable]: true }
                            );
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
                        const parent = new TransformNode("Parent", scene);
                        const focused = new TransformNode("Focused", scene);
                        const fallback = new TransformNode("Fallback", scene);
                        focused.parent = parent;
                        parent.accessibilityTag = { description: "Parent", role: "group" };
                        focused.accessibilityTag = { description: "Focused", eventHandler: { click: () => {} } };
                        fallback.accessibilityTag = { description: "Fallback", eventHandler: { click: () => {} } };
                        const renderer = HTMLTwinRenderer.Render(scene, { roots: [parent, fallback], parentElement: document.body });
                        const buttons = renderer.view.element.querySelectorAll<HTMLElement>("button");
                        focusedElement = buttons[0]!;
                        fallbackElement = buttons[1]!;
                        renderer.focus(focused);
                        updateParent = () => {
                            parent.accessibilityTag = unavailable.startsWith("aria-")
                                ? { description: "Parent", role: "group", aria: { [unavailable]: true } }
                                : { description: "Parent", role: "group", [unavailable]: true };
                        };
                        cleanup = () => scene.dispose();
                    }
                    updateParent();
                    await Promise.resolve();
                    const hidden = unavailable.endsWith("hidden");
                    const result = {
                        fallbackFocused: document.activeElement === fallbackElement,
                        nativeUnavailable: hidden ? focusedElement.closest("[hidden]") !== null : focusedElement.matches(":disabled"),
                    };
                    cleanup();
                    return result;
                },
                { urls, mode, unavailable }
            );
            expect(result).toEqual({ fallbackFocused: true, nativeUnavailable: true });
        });
    }
}

test("F05 borrowed DOM additions and replacements reject atomically with multiple mounted views", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const api: typeof Lite = await import(urls.lite);
        const original = document.createElement("div");
        const borrowed = document.createElement("button");
        original.append(borrowed);
        document.body.append(original);
        const tree = api.createAccessibilityTree();
        const generated = api.addAccessibilityNode(tree, { tag: { name: "Generated" } });
        const first = api.createHtmlTwin(tree, { parent: document.body });
        const second = api.createHtmlTwin(tree, { parent: document.body });
        let addRejected = false;
        let replaceRejected = false;
        try {
            api.addAccessibilityNode(tree, { element: borrowed });
        } catch {
            addRejected = true;
        }
        try {
            api.updateAccessibilityNode(tree, generated, { element: borrowed });
        } catch {
            replaceRejected = true;
        }
        const result = {
            addRejected,
            replaceRejected,
            roots: tree.roots.length,
            generatedUnchanged: generated.element === undefined && api.getHtmlTwinElement(first, generated)?.textContent === "Generated",
            borrowedUnchanged: borrowed.parentElement === original,
            firstChildren: first.element.querySelectorAll("[data-lite-a11y]").length,
            secondChildren: second.element.querySelectorAll("[data-lite-a11y]").length,
        };
        api.disposeHtmlTwin(first);
        api.disposeHtmlTwin(second);
        return result;
    }, urls);
    expect(result).toEqual({
        addRejected: true,
        replaceRejected: true,
        roots: 1,
        generatedUnchanged: true,
        borrowedUnchanged: true,
        firstChildren: 1,
        secondChildren: 1,
    });
});

test("F02 compat metadata changes avoid descendant reconciliation and unrelated ordering", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const { Scene }: typeof CompatScene = await import(urls.scene);
        const { NullEngine }: typeof CompatEngine = await import(urls.engine);
        const { TransformNode }: typeof CompatMeshes = await import(urls.meshes);
        const { HTMLTwinRenderer }: typeof CompatTwin = await import(urls.twin);
        const engine = new NullEngine();
        const canvas = document.createElement("canvas");
        document.body.append(canvas);
        engine.getRenderingCanvas = () => canvas;
        const scene = new Scene(engine);
        const changed = new TransformNode("Changed root", scene);
        const unrelated = new TransformNode("Unrelated root", scene);
        const descendants: InstanceType<typeof TransformNode>[] = [];
        for (let index = 0; index < 24; index++) {
            const child = new TransformNode(`Child ${index}`, scene);
            child.parent = changed;
            child.accessibilityTag = { description: child.name };
            descendants.push(child);
        }
        changed.accessibilityTag = { description: changed.name, role: "group" };
        unrelated.accessibilityTag = { description: unrelated.name };
        const renderer = HTMLTwinRenderer.Render(scene, { roots: [changed, unrelated], parentElement: document.body });
        let descendantReads = 0;
        for (const child of descendants) {
            const tag = child.accessibilityTag;
            Object.defineProperty(child, "accessibilityTag", {
                configurable: true,
                get: () => {
                    descendantReads++;
                    return tag;
                },
            });
        }
        let unrelatedOrderReads = 0;
        Object.defineProperty(unrelated, "_accessibilityTabOrder", {
            configurable: true,
            get: () => {
                unrelatedOrderReads++;
                return undefined;
            },
        });
        changed.accessibilityTag = { ...changed.accessibilityTag, description: "Renamed root" };
        await Promise.resolve();
        const renamed = renderer.view.element.querySelector('[aria-label="Renamed root"]') !== null;
        scene.dispose();
        return { descendantReads, unrelatedOrderReads, renamed };
    }, urls);
    expect(result).toEqual({ descendantReads: 0, unrelatedOrderReads: 0, renamed: true });
});

test("F03/F12 compat refresh prunes unreachable wrappers and visits each direct edge once", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const { Scene }: typeof CompatScene = await import(urls.scene);
        const { NullEngine }: typeof CompatEngine = await import(urls.engine);
        const { TransformNode }: typeof CompatMeshes = await import(urls.meshes);
        const { HTMLTwinRenderer }: typeof CompatTwin = await import(urls.twin);
        const engine = new NullEngine();
        const canvas = document.createElement("canvas");
        document.body.append(canvas);
        engine.getRenderingCanvas = () => canvas;
        const scene = new Scene(engine);
        const root = new TransformNode("Root", scene);
        root.accessibilityTag = { description: root.name, role: "group" };
        const chain = [root];
        for (let index = 0; index < 31; index++) {
            const child = new TransformNode(`Depth ${index}`, scene);
            child.parent = chain.at(-1)!;
            child.accessibilityTag = { description: child.name, role: "group" };
            chain.push(child);
        }
        const stale = new TransformNode("Stale mesh", scene);
        stale.accessibilityTag = { description: stale.name };
        scene.meshes.push(stale);
        const renderer = HTMLTwinRenderer.Render(scene, { roots: [root], parentElement: document.body });
        let visitedEdges = 0;
        for (const source of chain) {
            const getDescendants = source.getDescendants.bind(source);
            source.getDescendants = (direct, predicate) => {
                const descendants = getDescendants(direct, predicate);
                visitedEdges += descendants.length;
                return descendants;
            };
        }
        scene.meshes.splice(scene.meshes.indexOf(stale), 1);
        renderer.refresh();
        const result = {
            visitedEdges,
            edgeCount: chain.length - 1,
            stalePresent: renderer.view.element.textContent?.includes("Stale mesh") ?? false,
            staleFocusAccepted: (() => {
                try {
                    return renderer.focus(stale);
                } catch {
                    return false;
                }
            })(),
        };
        scene.dispose();
        return result;
    }, urls);
    expect(result).toEqual({ visitedEdges: result.edgeCount, edgeCount: 31, stalePresent: false, staleFocusAccepted: false });
});

test("F03 compat refresh retains dependency ancestors without importing unretained siblings", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const { Scene }: typeof CompatScene = await import(urls.scene);
        const { NullEngine }: typeof CompatEngine = await import(urls.engine);
        const { TransformNode }: typeof CompatMeshes = await import(urls.meshes);
        const { HTMLTwinRenderer }: typeof CompatTwin = await import(urls.twin);
        const engine = new NullEngine();
        const canvas = document.createElement("canvas");
        document.body.append(canvas);
        engine.getRenderingCanvas = () => canvas;
        const scene = new Scene(engine);
        const parent = new TransformNode("Dependency parent", scene);
        const canonical = new TransformNode("Canonical child", scene);
        const sibling = new TransformNode("Unretained sibling", scene);
        canonical.parent = parent;
        sibling.parent = parent;
        canonical.accessibilityTag = { description: canonical.name };
        sibling.accessibilityTag = { description: sibling.name };
        scene.meshes.push(canonical);

        const renderer = HTMLTwinRenderer.Render(scene, { parentElement: document.body });
        const result = {
            parent: renderer.focus(parent),
            canonical: renderer.focus(canonical),
            sibling: (() => {
                try {
                    return renderer.focus(sibling);
                } catch {
                    return false;
                }
            })(),
        };
        scene.dispose();
        return result;
    }, urls);
    expect(result).toEqual({ parent: false, canonical: true, sibling: false });
});

test("G03 compat refresh supersedes stale local and subtree queues but preserves reentrant work", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const { Scene }: typeof CompatScene = await import(urls.scene);
        const { NullEngine }: typeof CompatEngine = await import(urls.engine);
        const { TransformNode }: typeof CompatMeshes = await import(urls.meshes);
        const { HTMLTwinRenderer }: typeof CompatTwin = await import(urls.twin);
        const { ActionManager, ExecuteCodeAction }: typeof CompatActions = await import(urls.actions);
        const engine = new NullEngine();
        const canvas = document.createElement("canvas");
        document.body.append(canvas);
        engine.getRenderingCanvas = () => canvas;
        const scene = new Scene(engine);
        const retained = new TransformNode("Retained", scene);
        const trigger = new TransformNode("Trigger", scene);
        const staleLocal = new TransformNode("Stale local", scene);
        const staleSubtree = new TransformNode("Stale subtree", scene);
        for (const source of [retained, trigger, staleLocal, staleSubtree]) {
            source.accessibilityTag = { description: source.name };
            scene.meshes.push(source);
        }
        const manager = new ActionManager(scene);
        manager.isRecursive = true;
        staleSubtree.actionManager = manager;
        const renderer = HTMLTwinRenderer.Render(scene, { parentElement: document.body });
        staleLocal.name = "Queued local";
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {}));
        scene.meshes.splice(scene.meshes.indexOf(staleLocal), 1);
        scene.meshes.splice(scene.meshes.indexOf(staleSubtree), 1);
        let reentered = false;
        Object.defineProperty(trigger, "_accessibilityTabOrder", {
            configurable: true,
            get: () => {
                if (!reentered) {
                    reentered = true;
                    retained.accessibilityTag = { description: "Reentrant retained" };
                }
                return undefined;
            },
        });
        renderer.refresh();
        await Promise.resolve();
        manager.unregisterAction(manager.actions[0]!);
        await Promise.resolve();
        const internals = renderer as unknown as { _nodes: Map<unknown, unknown>; _managers: Map<unknown, unknown> };
        const result = {
            staleLocal: renderer.view.element.textContent?.includes("Queued local") ?? false,
            staleSubtree: renderer.view.element.textContent?.includes("Stale subtree") ?? false,
            retained: renderer.view.element.textContent?.includes("Reentrant retained") ?? false,
            nodeCount: internals._nodes.size,
            managerCount: internals._managers.size,
        };
        scene.dispose();
        return result;
    }, urls);
    expect(result).toEqual({ staleLocal: false, staleSubtree: false, retained: true, nodeCount: 2, managerCount: 0 });
});

test("F02 recursive compat action changes reconcile descendants", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const { Scene }: typeof CompatScene = await import(urls.scene);
        const { NullEngine }: typeof CompatEngine = await import(urls.engine);
        const { TransformNode }: typeof CompatMeshes = await import(urls.meshes);
        const { HTMLTwinRenderer }: typeof CompatTwin = await import(urls.twin);
        const { ActionManager, ExecuteCodeAction }: typeof CompatActions = await import(urls.actions);
        const engine = new NullEngine();
        const canvas = document.createElement("canvas");
        document.body.append(canvas);
        engine.getRenderingCanvas = () => canvas;
        const scene = new Scene(engine);
        const parent = new TransformNode("Parent", scene);
        const child = new TransformNode("Child", scene);
        child.parent = parent;
        child.accessibilityTag = { description: child.name };
        const manager = new ActionManager(scene);
        manager.isRecursive = true;
        parent.actionManager = manager;
        const renderer = HTMLTwinRenderer.Render(scene, { roots: [parent], parentElement: document.body });
        const before = renderer.view.element.querySelectorAll("button").length;
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {}));
        await Promise.resolve();
        const afterAdd = renderer.view.element.querySelectorAll("button").length;
        manager.unregisterAction(manager.actions[0]!);
        await Promise.resolve();
        const afterRemove = renderer.view.element.querySelectorAll("button").length;
        scene.dispose();
        return { before, afterAdd, afterRemove };
    }, urls);
    expect(result).toEqual({ before: 0, afterAdd: 2, afterRemove: 0 });
});

test("F07 automatic overlay geometry coalesces, skips hidden work, diffs writes, and cancels disposal", async ({ page }) => {
    const result = await page.evaluate(async (urls) => {
        const api: typeof Lite = await import(urls.lite);
        const canvas = document.createElement("canvas");
        const content = document.createElement("button");
        document.body.append(canvas, content);
        let left = 10;
        let reads = 0;
        canvas.getBoundingClientRect = () => {
            reads++;
            return { x: left, y: 20, left, top: 20, right: left + 100, bottom: 70, width: 100, height: 50, toJSON: () => ({}) };
        };
        const callbacks = new Map<number, FrameRequestCallback>();
        const cancelled: number[] = [];
        let nextFrame = 0;
        const requestAnimationFrame = window.requestAnimationFrame;
        const cancelAnimationFrame = window.cancelAnimationFrame;
        window.requestAnimationFrame = (callback) => {
            const id = ++nextFrame;
            callbacks.set(id, callback);
            return id;
        };
        window.cancelAnimationFrame = (id) => {
            cancelled.push(id);
            callbacks.delete(id);
        };
        try {
            const overlay = api.createHtmlOverlay({ canvas, element: content, mode: "overlay" });
            reads = 0;
            let geometryWrites = 0;
            for (const property of ["left", "top", "width", "height"] as const) {
                let value = overlay.element.style[property];
                Object.defineProperty(overlay.element.style, property, {
                    configurable: true,
                    get: () => value,
                    set: (next: string) => {
                        geometryWrites++;
                        value = next;
                    },
                });
            }
            window.dispatchEvent(new Event("resize"));
            window.dispatchEvent(new Event("scroll"));
            window.dispatchEvent(new Event("scroll"));
            const queued = callbacks.size;
            const readsBeforeFrame = reads;
            const firstFrame = [...callbacks][0];
            if (firstFrame) {
                callbacks.delete(firstFrame[0]);
                firstFrame[1](0);
            }
            const unchangedWrites = geometryWrites;
            const coalescedReads = reads;

            api.setHtmlOverlayVisible(overlay, false);
            window.dispatchEvent(new Event("resize"));
            const hiddenQueued = callbacks.size;
            left = 25;
            api.updateHtmlOverlay(overlay);
            const explicitLeft = overlay.element.style.left;
            left = 30;
            window.dispatchEvent(new Event("scroll"));
            api.setHtmlOverlayVisible(overlay, true);
            const revealLeft = overlay.element.style.left;
            const revealQueued = callbacks.size;
            window.dispatchEvent(new Event("resize"));
            const pending = [...callbacks.keys()][0];
            api.disposeHtmlOverlay(overlay);
            return {
                queued,
                readsBeforeFrame,
                coalescedReads,
                unchangedWrites,
                hiddenQueued,
                explicitLeft,
                revealLeft,
                revealQueued,
                cancelledPending: pending !== undefined && cancelled.includes(pending),
            };
        } finally {
            window.requestAnimationFrame = requestAnimationFrame;
            window.cancelAnimationFrame = cancelAnimationFrame;
        }
    }, urls);
    expect(result).toEqual({
        queued: 1,
        readsBeforeFrame: 0,
        coalescedReads: 1,
        unchangedWrites: 0,
        hiddenQueued: 0,
        explicitLeft: "25px",
        revealLeft: "30px",
        revealQueued: 0,
        cancelledPending: true,
    });
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
