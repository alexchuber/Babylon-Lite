import { expect, test } from "@playwright/test";
import type * as Lite from "../../../packages/babylon-lite/src/index";
import type {} from "../../../lab/lite/src/accessibility-fixture-types";

const moduleUrl = `/@fs/${process.cwd()}/packages/babylon-lite/src/index.ts`;

test.beforeEach(async ({ page }) => {
    await page.goto(`http://localhost:${process.env.LAB_TEST_PORT ?? 5179}/lite/accessibility-test.html`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.accessibilityFixture.dispose());
});

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
