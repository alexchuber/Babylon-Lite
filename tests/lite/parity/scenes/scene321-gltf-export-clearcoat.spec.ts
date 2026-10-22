/**
 * Scene 321 — glTF export of the Khronos ClearCoatTest plus a combined intensity/roughness clearcoat row
 *
 * Babylon.js visualization test: "GLTF Serializer KHR materials clearcoat"
 * Playground: #9N6CLU#23. Babylon.js reference image: glTFSerializerKhrMaterialsClearcoat.png (errorRatio 1.1).
 *
 * Not reproduced as in the snippet (see the header of lab/lite/src/lite/scene321.ts): the combined texture is built from the
 * source images decoded out of the GLB, because Lite cannot read back a loaded texture; materials are cloned by shallow copy;
 * the PBR skybox is a hand-built box (scene 26's approach).
 *
 * Known failure: the snippet's `new CubeTexture(".../environment.dds")` is a gamma-space cube texture (`gammaSpace = true`), so
 * Babylon.js decodes the half-float DDS with pow(2.2) for the skybox and for IBL. `loadDdsEnvironment` has no such option and
 * treats the data as linear, so this scene stays above the MAD ceiling until the loader/renderer supports gamma-space environments.
 */
import { expect, test } from "../parity-fixtures";
import * as path from "path";
import { attachCompareArtifacts, captureGolden, compareImages, getSceneConfig, waitForCanvasReady } from "../compare-utils";

const sceneConfig = getSceneConfig(321);
const REFERENCE_DIR = path.resolve(__dirname, "../../../../reference/lite/scene321-gltf-export-clearcoat");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test.skip(!!sceneConfig.skipParity, "Scene 321 skipped via skipParity in scene-config.json");

test("Scene 321 — GLTF Serializer KHR materials clearcoat matches Babylon.js", async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    await captureGolden(page.context().browser()!, { sceneId: 321, timeout: 90_000 });

    await page.goto("/scene321.html");
    await waitForCanvasReady(page, { timeout: 90_000, label: "Scene 321 Lite" });
    await page.locator("#loader-overlay").waitFor({ state: "detached", timeout: 10_000 });

    const actual = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: actual });

    const full = compareImages(actual, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, actual, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Full image (${full.totalPixels} px): MAD=${full.mad.toFixed(3)}`);
    expect(full.mad, `Full image MAD should be ≤ ${sceneConfig.maxMad}`).toBeLessThanOrEqual(sceneConfig.maxMad);
});
