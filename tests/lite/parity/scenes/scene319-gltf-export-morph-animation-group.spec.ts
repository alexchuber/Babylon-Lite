/**
 * Scene 319 — GLTF Serializer Morph Target Animation Group
 *
 * Ports the Babylon.js visualization test "GLTF Serializer Morph Target Animation Group" (playground #T087A8#29, reference image gltfSerializerMorphTargetAnimationGroup.png).
 * Babylon Lite exports the scene with exportSceneAsGlb, reloads the GLB with loadGltf and renders the reloaded scene;
 * the one Babylon.js reference render is the golden.
 *
 * Not reproduced as in the snippet: the source scene is not right-handed (Lite scenes are always left-handed), FlyCamera is a free
 * camera, and the three material clones are shared copies of the first material.
 *
 * Assertions:
 * - Full image MAD ≤ scene-config.json maxMad
 */
import { test, expect } from "../parity-fixtures";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig, waitForCanvasReady } from "../compare-utils";

const sceneConfig = getSceneConfig(319);
const REFERENCE_DIR = path.resolve(__dirname, "../../../../reference/lite/scene319-gltf-export-morph-animation-group");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test.skip(!!sceneConfig.skipParity, "Scene 319 skipped via skipParity in scene-config.json");

test("Scene 319 — GLTF Serializer Morph Target Animation Group matches Babylon.js", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await captureGolden(page.context().browser()!, { sceneId: 319, timeout: 90_000 });

    await page.goto("/scene319.html");
    await waitForCanvasReady(page, { timeout: 90_000, label: "Scene 319 Lite" });
    await page.locator("#loader-overlay").waitFor({ state: "detached", timeout: 10_000 });

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}, within-5=${((100 * full.within5) / full.totalPixels).toFixed(1)}%`);

    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
