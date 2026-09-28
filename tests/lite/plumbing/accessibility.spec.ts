import { expect, test } from "@playwright/test";
import type {} from "../../../lab/lite/src/accessibility-fixture-types";

test("initial adoption preserves input focus and selection", async ({ page }) => {
    await page.goto(`http://localhost:${process.env.LAB_TEST_PORT ?? 5179}/lite/accessibility-test.html?focused`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const input = page.getByRole("textbox", { name: "Player name" });
    await expect(input).toBeFocused();
    expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([1, 4]);
});

test("removing the last focused item falls back to the region when the canvas is not focusable", async ({ page }) => {
    await page.goto(`http://localhost:${process.env.LAB_TEST_PORT ?? 5179}/lite/accessibility-test.html`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.getByRole("textbox", { name: "Player name" }).focus();
    await page.evaluate(() => window.accessibilityFixture.clear());
    await expect(page.getByRole("region", { name: "Music scene" })).toBeFocused();
});

test.beforeEach(async ({ page }) => {
    await page.goto(`http://localhost:${process.env.LAB_TEST_PORT ?? 5179}/lite/accessibility-test.html`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
});

test("Chromium's accessibility tree exposes the live region, control names, and pressed state", async ({ page }) => {
    const session = await page.context().newCDPSession(page);
    try {
        const before = await session.send("Accessibility.getFullAXTree");
        expect(before.nodes.some((node) => !node.ignored && node.role?.value === "region" && node.name?.value === "Music scene")).toBe(true);
        const piano = before.nodes.find((node) => !node.ignored && node.role?.value === "button" && node.name?.value === "Play piano");
        expect(piano).toBeDefined();
        expect(String(piano?.properties?.find((property) => property.name === "pressed")?.value.value)).toBe("false");
        expect(before.nodes.some((node) => !node.ignored && node.role?.value === "textbox" && node.name?.value === "Player name")).toBe(true);
        await page.evaluate(() => window.accessibilityFixture.update());
        const after = await session.send("Accessibility.getFullAXTree");
        const updated = after.nodes.find((node) => !node.ignored && node.role?.value === "button" && node.name?.value === "Stop piano");
        expect(String(updated?.properties?.find((property) => property.name === "pressed")?.value.value)).toBe("true");
        expect(after.nodes.some((node) => !node.ignored && node.name?.value === "Play piano")).toBe(false);
    } finally {
        await session.detach();
    }
});

test("exposes a named hierarchy with native button keyboard activation and live ARIA", async ({ page }) => {
    const piano = page.getByRole("button", { name: "Play piano" });
    await expect(page.getByRole("region", { name: "Music scene" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Instruments", exact: true })).toBeVisible();
    await piano.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(page.locator("output")).toHaveText("2");
    await page.evaluate(() => window.accessibilityFixture.update());
    await expect(page.getByRole("button", { name: "Stop piano" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Stop piano" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("region", { name: "Music scene" })).toMatchAriaSnapshot(`
        - region "Music scene":
          - group "Instruments":
            - button "Stop piano" [pressed]
            - button "Play drum"
          - textbox "Player name"
    `);
});

test("preserves focus through reparenting, moves it after hiding, and permits Tab exit", async ({ page }) => {
    await page.getByRole("button", { name: "Play piano" }).focus();
    await page.evaluate(() => window.accessibilityFixture.reparent());
    await expect(page.getByRole("button", { name: "Play piano" })).toBeFocused();
    await page.evaluate(() => window.accessibilityFixture.hide());
    await expect(page.getByRole("button", { name: "Play piano" })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Player name" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "After scene" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("textbox", { name: "Player name" })).toBeFocused();
});

test("uses live native input, visible focus, and restores adopted controls on disposal", async ({ page }) => {
    const input = page.getByRole("textbox", { name: "Player name" });
    await input.fill("Alex");
    await expect(input).toHaveValue("Alex");
    await input.focus();
    expect(await input.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await page.evaluate(() => window.accessibilityFixture.dispose());
    await expect(page.getByRole("region", { name: "Music scene" })).toHaveCount(0);
    await expect(page.locator("#original input")).toHaveValue("Alex");
    await expect(page.locator("#original input")).toHaveAttribute("aria-label", "Original label");
    await expect(page.getByRole("button", { name: "Play piano" })).toHaveCount(0);
    await expect(page.locator("canvas")).toBeFocused();
});

test("removes obsolete ARIA and preserves logical focus when actionability changes", async ({ page }) => {
    await page.getByRole("button", { name: "Play piano" }).focus();
    await page.evaluate(() => window.accessibilityFixture.clearAria());
    await expect(page.getByRole("button", { name: "Play piano" })).not.toHaveAttribute("aria-pressed");
    await page.evaluate(() => window.accessibilityFixture.staticItem());
    await expect(page.getByRole("note")).toBeFocused();
    await expect(page.getByRole("note")).toHaveText("Piano information");
    await page.keyboard.press("Enter");
    await expect(page.locator("output")).toHaveText("0");
});

test("keeps disabled descendants exposed but removes them from activation and Tab order", async ({ page }) => {
    await page.getByRole("button", { name: "Play piano" }).focus();
    await page.evaluate(() => window.accessibilityFixture.disableGroup());
    await expect(page.getByRole("button", { name: "Play piano" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Play drum" })).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Player name" })).toBeFocused();
    await page.getByRole("button", { name: "Play piano" }).evaluate((element) => (element as HTMLButtonElement).click());
    await expect(page.locator("output")).toHaveText("0");
});

test("updates adopted native groups without losing selection and disables dynamic descendants", async ({ page }) => {
    await page.evaluate(() => window.accessibilityFixture.nativeControl(false));
    const input = page.getByRole("textbox", { name: "Nested input" });
    await input.focus();
    await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(1, 4));
    await page.evaluate(() => window.accessibilityFixture.nativeControl(false));
    await expect(input).toBeFocused();
    expect(await input.evaluate((element) => [(element as HTMLInputElement).selectionStart, (element as HTMLInputElement).selectionEnd])).toEqual([1, 4]);
    await page.evaluate(() => window.accessibilityFixture.nativeControl(true));
    await expect(input).toBeDisabled();
    await page.evaluate(() => window.accessibilityFixture.dynamicControl());
    await expect(page.getByRole("textbox", { name: "Dynamic input" })).toBeDisabled();
    await page.evaluate(() => window.accessibilityFixture.nativeControl(false));
    await expect(input).toBeEnabled();
    await expect(page.getByRole("textbox", { name: "Dynamic input" })).toBeEnabled();
});

test("rejects conflicting ownership and invalid roles atomically and supports clean remounting", async ({ page }) => {
    expect(await page.evaluate(() => window.accessibilityFixture.invalid())).toEqual({ failures: 3, unchanged: true });
    await expect(page.locator(".lite-accessibility")).toHaveCount(1);
    await page.evaluate(() => {
        window.accessibilityFixture.remount();
        window.accessibilityFixture.remount();
    });
    await expect(page.locator(".lite-accessibility")).toHaveCount(1);
    await page.getByRole("button", { name: "Play piano" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("output")).toHaveText("1");
});
