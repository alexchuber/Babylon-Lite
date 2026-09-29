import { expect, test } from "@playwright/test";
import type {} from "../../../lab/lite/src/accessibility-fixture-types";

const url = `http://localhost:${process.env.LAB_TEST_PORT ?? 5179}/lite/accessibility-integration-test.html`;

test.describe("projected accessibility focus", () => {
    test.use({ deviceScaleFactor: 2 });

    test("orthographic bounds follow CSS resizing and parent motion", async ({ page }) => {
        await page.goto(`${url}?mode=scene`);
        await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
        await page.evaluate(() => window.accessibilityProjection.configure("orthographic"));
        await page.getByRole("button", { name: "Play instrument" }).focus();
        const marker = page.locator(".lite-accessibility-scene-focus");
        await expect.poll(async () => (await marker.boundingBox())?.width).toBeCloseTo(102, 1);
        const canvas = (await page.locator("canvas").boundingBox())!;
        const initial = (await marker.boundingBox())!;
        expect(initial.x + initial.width / 2).toBeCloseTo(canvas.x + canvas.width / 2, 1);
        expect(initial.y + initial.height / 2).toBeCloseTo(canvas.y + canvas.height / 2, 1);

        await page.evaluate(() => window.accessibilityProjection.configure("resize"));
        await expect.poll(async () => (await marker.boundingBox())?.width).toBeCloseTo(57, 1);
        const resized = (await marker.boundingBox())!;
        await page.evaluate(() => window.accessibilityProjection.configure("parent"));
        await expect.poll(async () => (await marker.boundingBox())?.x).toBeCloseTo(resized.x + 22.5, 1);
        await expect(page.getByRole("button", { name: "Play instrument" })).toBeFocused();
    });

    test("high-DPI bounds clip to the active fractional viewport", async ({ page }) => {
        await page.goto(`${url}?mode=scene`);
        await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
        expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
        await page.evaluate(() => window.accessibilityProjection.configure("viewport"));
        await page.getByRole("button", { name: "Play instrument" }).focus();
        const marker = page.locator(".lite-accessibility-scene-focus");
        await expect.poll(async () => (await marker.boundingBox())?.width).toBeCloseTo(320, 1);
        const canvas = (await page.locator("canvas").boundingBox())!;
        const bounds = (await marker.boundingBox())!;
        expect(bounds.x).toBeCloseTo(canvas.x + canvas.width / 2, 1);
        expect(bounds.x + bounds.width).toBeCloseTo(canvas.x + canvas.width, 1);
        expect(bounds.y).toBeGreaterThanOrEqual(canvas.y);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(canvas.y + canvas.height);
    });

    test("near-plane bounds fall back to the origin and clipping leaves the DOM control available", async ({ page }) => {
        await page.goto(`${url}?mode=scene`);
        await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
        const button = page.getByRole("button", { name: "Play instrument" });
        await button.focus();
        const marker = page.locator(".lite-accessibility-scene-focus");
        await page.evaluate(() => window.accessibilityProjection.configure("near"));
        await expect.poll(async () => (await marker.boundingBox())?.width).toBeCloseTo(12, 1);
        await page.evaluate(() => window.accessibilityProjection.configure("origin"));
        await expect(marker).toBeVisible();
        await page.evaluate(() => window.accessibilityProjection.configure("behind"));
        await expect(marker).toBeHidden();
        await expect(button).toBeVisible();
        await expect(button).toBeFocused();
    });

    test("floating-origin focus uses the explicitly supplied secondary canvas", async ({ page }) => {
        await page.goto(`${url}?mode=scene&secondary`);
        await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
        await page.getByRole("button", { name: "Play instrument" }).focus();
        const marker = page.locator(".lite-accessibility-scene-focus");
        await expect(marker).toBeVisible();
        const canvas = (await page.locator("#secondary").boundingBox())!;
        const before = (await marker.boundingBox())!;
        expect(before.x + before.width / 2).toBeCloseTo(canvas.x + canvas.width / 2, 1);
        expect(before.y + before.height / 2).toBeCloseTo(canvas.y + canvas.height / 2, 1);
        await page.evaluate(() => window.accessibilityProjection.configure("floating"));
        await expect.poll(async () => (await marker.boundingBox())?.x).toBeCloseTo(before.x, 1);
        await expect.poll(async () => (await marker.boundingBox())?.width).toBeCloseTo(before.width, 1);
        await page.evaluate(() => window.accessibilityIntegration.dispose());
        await expect(marker).toHaveCount(0);
    });

    test("forced colors retains an outline and a noninteractive scene marker", async ({ page }) => {
        await page.emulateMedia({ forcedColors: "active" });
        await page.goto(`${url}?mode=scene`);
        await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
        const button = page.getByRole("button", { name: "Play instrument" });
        await button.focus();
        const outline = await button.evaluate((element) => {
            const style = getComputedStyle(element);
            return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle, color: style.outlineColor };
        });
        expect(outline.width).toBeGreaterThan(0);
        expect(outline.style).not.toBe("none");
        expect(outline.color).not.toBe("rgba(0, 0, 0, 0)");
        const marker = page.locator(".lite-accessibility-scene-focus");
        await expect(marker).toBeVisible();
        await expect(marker).toHaveAttribute("aria-hidden", "true");
        await expect(marker).toHaveCSS("pointer-events", "none");
    });

    test("static focus markers do not rewrite unchanged visibility or bounds", async ({ page }) => {
        await page.goto(`${url}?mode=scene`);
        await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
        await page.getByRole("button", { name: "Play instrument" }).focus();
        const marker = page.locator(".lite-accessibility-scene-focus");
        await expect(marker).toBeVisible();
        const writes = await marker.evaluate(
            (element: HTMLElement) =>
                new Promise<number>((resolve) => {
                    let writes = 0;
                    let hidden = element.hidden;
                    Object.defineProperty(element, "hidden", {
                        configurable: true,
                        get: () => hidden,
                        set: (value: boolean) => {
                            writes++;
                            hidden = value;
                        },
                    });
                    requestAnimationFrame(() =>
                        requestAnimationFrame(() => {
                            resolve(writes);
                        })
                    );
                })
        );
        expect(writes).toBe(0);
    });
});

test("live overlay adoption, hiding, submission, dynamic input, and disposal preserve browser ownership", async ({ page }) => {
    await page.goto(`${url}?mode=gl&focused`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const input = page.getByRole("textbox", { name: "Player" });
    await expect(input).toBeFocused();
    expect(await input.evaluate((element: HTMLInputElement) => [element.selectionStart, element.selectionEnd])).toEqual([1, 3]);
    await input.press("Enter");
    await expect(page.locator("output")).toHaveText("submitted");
    await page.evaluate(() => window.accessibilityIntegration.disable());
    await expect(input).toHaveCount(0);
    await expect(page.locator("canvas")).toBeFocused();
    await page.evaluate(() => window.accessibilityIntegration.tick());
    await expect(page.locator("canvas")).toBeFocused();
    await expect(input).toHaveValue("Alex");
    await page.locator("#content").evaluate((content) => {
        const added = document.createElement("input");
        added.ariaLabel = "Dynamic overlay input";
        added.addEventListener("input", () => {
            document.querySelector("output")!.textContent = added.value;
        });
        content.append(added);
    });
    const added = page.getByRole("textbox", { name: "Dynamic overlay input" });
    await added.fill("before disposal");
    await expect(page.locator("output")).toHaveText("before disposal");
    await page.evaluate(() => window.accessibilityIntegration.dispose());
    await expect(page.locator("canvas")).toBeFocused();
    await expect(page.locator("#original #content")).toBeVisible();
    await expect(added).toHaveValue("before disposal");
    await added.fill("after disposal");
    await expect(page.locator("output")).toHaveText("after disposal");
    await expect(page.locator(".lite-html-overlay")).toHaveCount(0);
});
