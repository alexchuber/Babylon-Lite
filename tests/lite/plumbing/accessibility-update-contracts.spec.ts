import { expect, test } from "@playwright/test";
import type * as Lite from "../../../packages/babylon-lite/src/index";
import type {} from "../../../lab/lite/src/accessibility-fixture-types";

const moduleUrl = `/@fs/${process.cwd()}/packages/babylon-lite/src/index.ts`;

test.beforeEach(async ({ page }) => {
    await page.goto(`http://localhost:${process.env.LAB_TEST_PORT ?? 5179}/lite/accessibility-test.html`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.accessibilityFixture.dispose());
});

for (const configuration of ["two views", "earlier observer"] as const) {
    test(`N1 populated tree synchronizes rename, disable, and removal with ${configuration}`, async ({ page }) => {
        const result = await page.evaluate(
            async ({ url, configuration }) => {
                const api: typeof Lite = await import(url);
                const tree = api.createAccessibilityTree();
                const click = (): void => {};
                const action = api.addAccessibilityNode(tree, { tag: { name: "Original action", eventHandler: { click } } });
                api.addAccessibilityNode(tree, { tag: { name: "Unrelated status", role: "status" } });
                let observed = 0;
                if (configuration === "earlier observer") {
                    api.onAccessibilityTreeChanged(tree, () => observed++);
                }
                const views = Array.from({ length: configuration === "two views" ? 2 : 1 }, () => api.createHtmlTwin(tree, { parent: document.body }));
                const originalElements = views.map((view) => api.getHtmlTwinElement(view, action)!);
                const snapshot = (): { text: string | null; disabled: boolean; sameElement: boolean }[] =>
                    views.map((view, index) => {
                        const element = api.getHtmlTwinElement(view, action)!;
                        return { text: element.textContent, disabled: element.hasAttribute("disabled"), sameElement: element === originalElements[index] };
                    });
                api.updateAccessibilityNode(tree, action, { tag: { name: "Renamed action", eventHandler: { click } } });
                const renamed = snapshot();
                api.updateAccessibilityNode(tree, action, { tag: { name: "Renamed action", disabled: true, eventHandler: { click } } });
                const disabled = snapshot();
                api.removeAccessibilityNode(tree, action);
                const removed = views.map((view, index) => !api.getHtmlTwinElement(view, action) && !originalElements[index]!.isConnected);
                const notifications = observed;
                api.disposeAccessibilityTree(tree);
                return { renamed, disabled, removed, notifications };
            },
            { url: moduleUrl, configuration }
        );
        const count = configuration === "two views" ? 2 : 1;
        expect(result).toEqual({
            renamed: Array.from({ length: count }, () => ({ text: "Renamed action", disabled: false, sameElement: true })),
            disabled: Array.from({ length: count }, () => ({ text: "Renamed action", disabled: true, sameElement: true })),
            removed: Array.from({ length: count }, () => true),
            notifications: configuration === "earlier observer" ? 3 : 0,
        });
    });
}

test("N1 empty-tree earlier observer does not cause unrelated metadata reads", async ({ page }) => {
    const result = await page.evaluate(async (url) => {
        const api: typeof Lite = await import(url);
        const tree = api.createAccessibilityTree();
        api.onAccessibilityTreeChanged(tree, () => {});
        const view = api.createHtmlTwin(tree, { parent: document.body });
        const changed = api.addAccessibilityNode(tree, { tag: { name: "Changed" } });
        const unrelated = api.addAccessibilityNode(tree, { tag: { name: "Stable live node", role: "status", aria: { "aria-live": "polite" } } });
        const tag = unrelated.tag;
        let reads = 0;
        Object.defineProperty(unrelated, "tag", {
            configurable: true,
            get: () => {
                reads++;
                return tag;
            },
        });
        api.updateAccessibilityNode(tree, changed, { tag: { name: "Changed again" } });
        const result = { reads, rendered: api.getHtmlTwinElement(view, changed)!.textContent };
        Object.defineProperty(unrelated, "tag", { configurable: true, writable: true, value: tag });
        api.disposeAccessibilityTree(tree);
        return result;
    }, moduleUrl);
    expect(result).toEqual({ reads: 0, rendered: "Changed again" });
});

for (const operation of ["clear", "replace"] as const) {
    test(`N2 same-task natural reparent and camera ${operation} preserve grouping, identity, and focus`, async ({ page }) => {
        const result = await page.evaluate(
            async ({ url, operation }) => {
                const api: typeof Lite = await import(url);
                const scene = api.createSceneContext(api.createNullEngine(), { defaultRenderTask: false });
                const camera = api.createFreeCamera({ x: 0, y: 0, z: -5 }, { x: 0, y: 0, z: 0 });
                const replacement = api.createFreeCamera({ x: 0, y: 0, z: -10 }, { x: 0, y: 0, z: 0 });
                const child = api.createTransformNode("Independent");
                const group = api.createTransformNode("Semantic group");
                api.setAccessibilityTag(camera, { name: "Retained camera", eventHandler: { click: () => {} } });
                api.setAccessibilityTag(child, { name: "Retained child", eventHandler: { click: () => {} } });
                api.setAccessibilityTag(group, { name: "Semantic group", role: "group" });
                scene.camera = camera;
                const adapter = api.createSceneAccessibility(scene, { roots: [child, group] });
                api.setAccessibilityParent(adapter, camera, group);
                const originalNode = api.getAccessibilityNode(adapter, camera)!;
                const groupNode = api.getAccessibilityNode(adapter, group)!;
                const view = api.createHtmlTwin(adapter.tree, { parent: document.body });
                const originalElement = api.getHtmlTwinElement(view, originalNode)!;
                const initiallyFocused = api.focusHtmlTwinNode(view, originalNode) && document.activeElement === originalElement;
                const snapshot = (): { nodeIdentity: boolean; grouped: boolean; domIdentity: boolean; focused: boolean } => {
                    const current = api.getAccessibilityNode(adapter, camera);
                    return {
                        nodeIdentity: current === originalNode,
                        grouped: current?.parent === groupNode,
                        domIdentity: !!current && api.getHtmlTwinElement(view, current) === originalElement && originalElement.isConnected,
                        focused: document.activeElement === originalElement,
                    };
                };
                api.setParent(child, camera);
                scene.camera = operation === "clear" ? null : replacement;
                const immediate = snapshot();
                await Promise.resolve();
                const flushed = snapshot();
                const childParent = api.getAccessibilityNode(adapter, child)?.parent === originalNode && child.parent === camera;
                api.disposeScene(scene);
                return { initiallyFocused, immediate, flushed, childParent };
            },
            { url: moduleUrl, operation }
        );
        const preserved = { nodeIdentity: true, grouped: true, domIdentity: true, focused: true };
        expect(result).toEqual({ initiallyFocused: true, immediate: preserved, flushed: preserved, childParent: true });
    });
}

test("R4 actual AX names survive leaf-to-parent and parent-to-leaf transitions", async ({ page }) => {
    await page.evaluate(async (url) => {
        const api: typeof Lite = await import(url);
        const tree = api.createAccessibilityTree();
        const parents = ["img", "region", "group"].map((role) => api.addAccessibilityNode(tree, { tag: { role, name: `Transition ${role}` } }));
        api.createHtmlTwin(tree, { parent: document.body });
        let children: Lite.AccessibilityNode[] = [];
        document.addEventListener("add-children", () => {
            children = parents.map((parent) => api.addAccessibilityNode(tree, { parent, tag: { name: "Nested description" } }));
        });
        document.addEventListener("remove-children", () => {
            children.forEach((node) => api.removeAccessibilityNode(tree, node));
        });
    }, moduleUrl);
    const session = await page.context().newCDPSession(page);
    try {
        for (const event of ["initial", "add-children", "remove-children"]) {
            await page.evaluate((event) => document.dispatchEvent(new Event(event)), event);
            const { nodes } = await session.send("Accessibility.getFullAXTree");
            for (const [role, name] of [
                ["image", "img"],
                ["region", "region"],
                ["group", "group"],
            ]) {
                expect(nodes.some((node) => !node.ignored && node.role?.value === role && node.name?.value === `Transition ${name}`)).toBe(true);
            }
        }
    } finally {
        await session.detach();
    }
});

test("R8 structural batches and inherited disable updates leave unrelated live content and focus untouched", async ({ page }) => {
    const result = await page.evaluate(async (url) => {
        const api: typeof Lite = await import(url);
        const tree = api.createAccessibilityTree();
        const branch = api.addAccessibilityNode(tree, { tag: { name: "Changed branch", role: "group" } });
        const button = api.addAccessibilityNode(tree, { parent: branch, tag: { name: "Action", eventHandler: { click: () => {} } } });
        const stable = document.createElement("input");
        stable.value = "abcdef";
        const live = api.addAccessibilityNode(tree, { tag: { name: "Keep live", role: "status", aria: { "aria-live": "polite" } } });
        api.addAccessibilityNode(tree, { element: stable });
        const twin = api.createHtmlTwin(tree, { parent: document.body });
        stable.focus();
        stable.setSelectionRange(1, 4);
        const liveElement = api.getHtmlTwinElement(twin, live)!;
        const observer = new MutationObserver(() => {});
        observer.observe(liveElement.parentElement!, { subtree: true, attributes: true, childList: true, characterData: true });
        api.batchAccessibilityUpdates(tree, () => {
            const removed = api.addAccessibilityNode(tree, { parent: branch, tag: { name: "Transient" } });
            api.removeAccessibilityNode(tree, removed);
            api.updateAccessibilityNode(tree, branch, { disabled: true });
        });
        const disabled = api.getHtmlTwinElement(twin, button)!.hasAttribute("disabled");
        api.updateAccessibilityNode(tree, branch, { disabled: false });
        api.updateAccessibilityNode(tree, button, { parent: null });
        api.removeAccessibilityNode(tree, branch);
        const enabled = !api.getHtmlTwinElement(twin, button)!.hasAttribute("disabled");
        const mutations = observer.takeRecords().length;
        observer.disconnect();
        return { disabled, enabled, mutations, focused: document.activeElement === stable, selection: [stable.selectionStart, stable.selectionEnd] };
    }, moduleUrl);
    expect(result).toEqual({ disabled: true, enabled: true, mutations: 0, focused: true, selection: [1, 4] });
});

test("R6 semantic overrides govern synchronous reparent availability without changing transform parents", async ({ page }) => {
    const result = await page.evaluate(async (url) => {
        const api: typeof Lite = await import(url);
        const scene = api.createSceneContext(api.createNullEngine(), { defaultRenderTask: false });
        const blocked = api.createTransformNode("Blocked");
        const enabled = api.createTransformNode("Enabled");
        const source = api.createTransformNode("Source");
        let clicks = 0;
        api.setAccessibilityTag(blocked, { name: "Blocked", disabled: true });
        api.setAccessibilityTag(enabled, { name: "Enabled" });
        api.setAccessibilityTag(source, { name: "Source", eventHandler: { click: () => clicks++ } });
        const adapter = api.createSceneAccessibility(scene, { roots: [blocked, enabled, source] });
        const twin = api.createHtmlTwin(adapter.tree, { parent: document.body });
        const node = api.getAccessibilityNode(adapter, source)!;
        const button = api.getHtmlTwinElement(twin, node)!;
        api.setAccessibilityParent(adapter, source, enabled);
        api.setParent(source, blocked);
        button.click();
        const allowed = api.focusHtmlTwinNode(twin, node);
        api.setAccessibilityParent(adapter, source, blocked);
        api.setParent(source, enabled);
        button.click();
        const denied = !api.focusHtmlTwinNode(twin, node);
        await Promise.resolve();
        const transformUnchanged = source.parent === enabled;
        api.disposeScene(scene);
        return { clicks, allowed, denied, transformUnchanged };
    }, moduleUrl);
    expect(result).toEqual({ clicks: 1, allowed: true, denied: true, transformUnchanged: true });
});
