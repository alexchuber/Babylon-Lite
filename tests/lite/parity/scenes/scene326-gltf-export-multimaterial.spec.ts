/**
 * Scene 326 — glTF export: multi-material raw textures
 *
 * Babylon.js visualization test: "GLTF Serializer multimaterial with raw texture"
 * Playground: #KU72PX#0. Reference image: glTFSerializerMultimaterial.png (errorRatio 1.1).
 *
 * Not reproduced one-to-one: Lite has no CreateTiledPlane, SubMesh or MultiMaterial, so the tiled plane's exact
 * vertex data is written out and each sub-mesh becomes a sibling mesh with its own draw range under one "plane" node.
 * The exporter does not write glTF samplers, so the reloaded raw textures sample with the glTF defaults
 * (linear, repeat) instead of the nearest sampling Babylon.js exports. See docs/lite/architecture/60-gltf-exporter.md (Scope).
 */
import { expect, test } from "../parity-fixtures";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig, waitForCanvasReady } from "../compare-utils";

const sceneConfig = getSceneConfig(326);
const REFERENCE_DIR = path.resolve(__dirname, "../../../../reference/lite/scene326-gltf-export-multimaterial");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test.skip(!!sceneConfig.skipParity, "Scene 326 skipped via skipParity in scene-config.json");

test("Scene 326 — GLTF Serializer multimaterial with raw texture matches Babylon.js", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await captureGolden(page.context().browser()!, { sceneId: 326, timeout: 90_000 });

    await page.goto("/scene326.html");
    await waitForCanvasReady(page, { timeout: 90_000, label: "Scene 326 Lite" });
    await page.locator("#loader-overlay").waitFor({ state: "detached", timeout: 10_000 });
    await page.waitForTimeout(500);

    const screenshotPath = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: screenshotPath });

    const full = compareImages(screenshotPath, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, screenshotPath, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}`);

    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
