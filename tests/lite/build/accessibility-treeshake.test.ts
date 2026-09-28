import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupTempDirs, ensureLibBuilt, LIB_ENTRY, runRollup } from "./bundler-harness";

afterAll(cleanupTempDirs);
beforeAll(ensureLibBuilt);

describe("accessibility tree shaking", () => {
    it("retains no accessibility implementation when unused", async () => {
        const baseline = await runRollup({
            entrySource: `import { createSceneContext, addToScene } from ${JSON.stringify(LIB_ENTRY)}; console.log(createSceneContext, addToScene);`,
            format: "es",
            minify: false,
        });
        const result = await runRollup({
            entrySource: `import { createSceneContext, addToScene, createSceneHtmlTwin, createNativeControl, createHtmlOverlay, createHtmlTwin, setSceneAnimationsEnabled } from ${JSON.stringify(LIB_ENTRY)}; console.log(createSceneContext, addToScene);`,
            format: "es",
            minify: false,
        });
        expect(result.errors).toEqual([]);
        expect(result.significantWarnings).toEqual([]);
        expect(result.code).toBe(baseline.code);
        expect(result.code).not.toContain("lite-accessibility");
        expect(result.code).not.toContain("sceneObservers");
        expect(result.code).not.toContain("elementOwners");
        expect(result.code).not.toContain("sceneNodeChanged");
        expect(result.code).not.toContain("sceneAnimationOverride");
    });

    it("keeps renderer-independent controls free of scene, projection, and GPU implementations", async () => {
        const result = await runRollup({
            entrySource: `import { createAccessibilityTree, createHtmlTwin, createNativeControl, createHtmlOverlay } from ${JSON.stringify(LIB_ENTRY)}; console.log(createAccessibilityTree, createHtmlTwin, createNativeControl, createHtmlOverlay);`,
            format: "es",
            minify: false,
        });
        expect(result.errors).toEqual([]);
        expect(result.significantWarnings).toEqual([]);
        expect(result.code).toContain("lite-accessibility");
        expect(result.code).not.toContain("createSceneContext");
        expect(result.code).not.toContain("getViewProjectionMatrix");
        expect(result.code).not.toContain("createRenderPipeline");
        expect(result.code).not.toContain("requestAdapter");
    });
});
