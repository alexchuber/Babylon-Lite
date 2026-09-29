import { expect, test } from "@playwright/test";

test.describe("passive accessibility HTML", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/lite/accessibility.html");
        await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    });

    test("exposes hierarchy and full ARIA without interactive DOM", async ({ page }) => {
        const region = page.getByRole("region", { name: "Solar system scene" });
        const group = region.getByRole("group", { name: "Planets" });
        const mars = group.locator('[data-lite-accessibility-node][role="button"]');

        await expect(mars).toHaveAttribute("aria-label", "Mars");
        await expect(mars).toHaveAttribute("aria-description", "The fourth planet from the Sun");
        await expect(mars).toHaveAttribute("aria-pressed", "false");
        await expect(mars).toHaveAttribute("aria-roledescription", "planet");
        await expect(mars).toHaveAttribute("aria-live", "polite");
        await expect(mars).toContainText("Mars");
        await expect(mars).toContainText("The fourth planet from the Sun");
        await expect(region.locator("button, input, select, textarea, a[href], [tabindex]")).toHaveCount(0);
        await expect(mars).toHaveJSProperty("tagName", "DIV");
    });

    test("updates roles, ARIA, hierarchy, visibility, removal, and disposal", async ({ page }) => {
        const region = page.getByRole("region", { name: "Solar system scene" });
        const node = region.locator("[data-lite-accessibility-node]", { hasText: "Mars" }).last();

        await page.evaluate(() => (window as unknown as { accessibilityFixture: { replace(): void } }).accessibilityFixture.replace());
        await expect(node).toHaveAttribute("role", "heading");
        await expect(node).toHaveAttribute("aria-level", "2");
        await expect(node).not.toHaveAttribute("aria-pressed");
        await expect(node).toContainText("Mars <updated>");
        await expect(node).not.toContainText("&lt;updated&gt;");

        await page.evaluate(() => (window as unknown as { accessibilityFixture: { hide(hidden: boolean): void } }).accessibilityFixture.hide(true));
        await expect(node).toBeHidden();
        await page.evaluate(() => (window as unknown as { accessibilityFixture: { hide(hidden: boolean): void } }).accessibilityFixture.hide(false));
        await expect(node).toBeVisible();

        await page.evaluate(() => (window as unknown as { accessibilityFixture: { reparent(): void } }).accessibilityFixture.reparent());
        await expect(region.locator(":scope > [data-lite-accessibility-node]", { hasText: "Mars" })).toHaveCount(1);

        await page.evaluate(() => (window as unknown as { accessibilityFixture: { remove(): void } }).accessibilityFixture.remove());
        await expect(node).toHaveCount(0);

        await page.evaluate(() => (window as unknown as { accessibilityFixture: { dispose(): void } }).accessibilityFixture.dispose());
        await expect(region).toHaveCount(0);
    });
});
