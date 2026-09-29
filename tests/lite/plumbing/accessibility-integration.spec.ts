import { expect, test } from "@playwright/test";
import type {} from "../../../lab/lite/src/accessibility-fixture-types";

const url = `http://localhost:${process.env.LAB_TEST_PORT ?? 5179}/lite/accessibility-integration-test.html`;

for (const mode of ["scene", "compat"]) {
    for (const state of ["disabled", "hidden", "disposed"] as const) {
        test(`${mode} suppresses ${state} target activation before queued DOM reconciliation`, async ({ page }) => {
            await page.goto(`${url}?mode=${mode}`);
            await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
            await page.evaluate((state) => window.accessibilityRace.run(state), state);
            await expect(page.locator("output")).toHaveText("0");
        });
    }
}

test("native scene objects expose disabled state, secondary keys, and a moving focus marker", async ({ page }) => {
    await page.goto(`${url}?mode=scene`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    const button = page.getByRole("button", { name: "Play instrument" });
    await button.focus();
    const marker = page.locator(".lite-accessibility-scene-focus");
    await expect(marker).toBeVisible();
    const first = await marker.boundingBox();
    await page.evaluate(() => window.accessibilityIntegration.move());
    await expect.poll(async () => (await marker.boundingBox())?.x).not.toBe(first?.x);
    await page.keyboard.press("Shift+F10");
    await expect(page.locator("output")).toHaveText("1");
    await page.evaluate(() => window.accessibilityIntegration.disable());
    await expect(button).toBeDisabled();
    await expect(button).toBeVisible();
    await expect(marker).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Native scene" })).toMatchAriaSnapshot(`
        - region "Native scene":
          - button "Play instrument" [disabled]
    `);
    await page.evaluate(() => window.accessibilityIntegration.dispose());
    await expect(page.getByRole("region", { name: "Native scene" })).toHaveCount(0);
});

test("typing in sibling controls cannot leave camera movement keys held", async ({ page }) => {
    await page.goto(`${url}?mode=scene`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.locator("canvas").focus();
    await page.keyboard.down("w");
    const moved = await page.evaluate(() => window.accessibilityIntegration.tick());
    await page.getByRole("button", { name: "Play instrument" }).focus();
    await page.keyboard.up("w");
    expect(await page.evaluate(() => window.accessibilityIntegration.tick())).toBe(moved);
});

test("GL overlays keep real form behavior, layout updates, and original DOM ownership", async ({ page }) => {
    await page.goto(`${url}?mode=gl`);
    await expect(page.locator("canvas")).toHaveAttribute("data-backend", "webgl2");
    await page.getByRole("checkbox", { name: "Enable sound" }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("checkbox", { name: "Enable sound" })).toBeChecked();
    await page.getByRole("radio", { name: "Piano", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Drum", exact: true })).toBeChecked();
    await page.getByRole("slider", { name: "Volume" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("slider", { name: "Volume" })).toHaveValue("6");
    await page.getByRole("textbox", { name: "Player" }).fill("Player two");
    await page.getByRole("combobox", { name: "Tempo" }).selectOption("fast");
    await page.getByRole("button", { name: "Play", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("output")).toHaveText("1");
    await page.evaluate(() => window.accessibilityIntegration.move());
    await expect.poll(async () => (await page.getByRole("region", { name: "GL controls" }).boundingBox())?.width).toBe(320);
    await page.evaluate(() => window.accessibilityIntegration.dispose());
    await expect(page.locator("#original #content input[type=text]")).toHaveValue("Player two");
    await expect(page.getByRole("region", { name: "GL controls" })).toHaveCount(0);
});

test("compat twins dispatch canonical pick actions, honor explicit callbacks, and dispose with the scene", async ({ page }) => {
    await page.goto(`${url}?mode=compat`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.getByRole("button", { name: "Play compat instrument" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("output")).toHaveText("1");
    await page.evaluate(() => window.accessibilityIntegration.move());
    await page.keyboard.press("Space");
    await expect(page.locator("output")).toHaveText("explicit");
    await page.evaluate(() => window.accessibilityIntegration.disable());
    await expect(page.getByRole("button", { name: "Explicit action" })).toHaveCount(0);
    await page.evaluate(() => window.accessibilityIntegration.dispose());
    await expect(page.locator(".lite-accessibility")).toHaveCount(0);
});

test("compat key actions are canvas scoped and are detached on replacement and disposal", async ({ page }) => {
    await page.goto(`${url}?mode=compat`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.locator("canvas").focus();
    await page.keyboard.press("k");
    await expect(page.locator("output")).toHaveText("1");
    await page.getByRole("button", { name: "Second action" }).focus();
    await page.keyboard.press("k");
    await expect(page.locator("output")).toHaveText("1");
    await page.evaluate(() => window.accessibilityActions.replaceSceneManager());
    await page.locator("canvas").focus();
    await page.keyboard.press("k");
    await expect(page.locator("output")).toHaveText("1");
    await page.evaluate(() => window.accessibilityActions.disposeManager());
    await page.evaluate(() => window.accessibilityIntegration.dispose());
    await page.keyboard.press("k");
    await expect(page.locator("output")).toHaveText("1");
});

test("compat action mutations and positive tab order update locally without positive DOM tabindex", async ({ page }) => {
    await page.goto(`${url}?mode=compat`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.accessibilityActions.removePick());
    await expect(page.getByRole("button", { name: "Play compat instrument" })).toHaveCount(0);
    await page.evaluate(() => window.accessibilityActions.addPick());
    await expect(page.getByRole("button", { name: "Play compat instrument" })).toBeVisible();
    await page.evaluate(() => window.accessibilityActions.setOrder());
    await page.locator("canvas").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Second action" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Play compat instrument" })).toBeFocused();
    await expect(page.locator('[tabindex="1"],[tabindex="2"]')).toHaveCount(0);
});

test("compat metadata validation is atomic before model and DOM mutation", async ({ page }) => {
    await page.goto(`${url}?mode=compat`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    expect(await page.evaluate(() => window.accessibilityActions.invalidTag())).toEqual({ failed: true, unchanged: true });
    await expect(page.getByRole("button", { name: "Play compat instrument" })).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(0);
});

test("disposing a compat parent without its children preserves child control identity and focus", async ({ page }) => {
    await page.goto(`${url}?mode=compat`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.accessibilityActions.parentSecond());
    const child = page.getByRole("button", { name: "Second action" });
    await child.focus();
    await page.evaluate(() => window.accessibilityActions.disposeParent());
    await expect(child).toBeFocused();
    await expect(page.getByRole("button", { name: "Play compat instrument" })).toHaveCount(0);
});

test("recursive ancestor pick managers update child actionability and preserve primary dispatch order", async ({ page }) => {
    await page.goto(`${url}?mode=compat`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.evaluate(() => window.accessibilityActions.recursive(true));
    const child = page.getByRole("button", { name: "Inherited action" });
    await child.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("output")).toHaveText("0left pick");
    await page.evaluate(() => window.accessibilityActions.recursive(false));
    await expect(child).toHaveCount(0);
    await page.evaluate(() => window.accessibilityActions.recursive(true));
    await expect(child).toBeVisible();
});
