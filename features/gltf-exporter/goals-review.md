# Review — `_/features/gltf-exporter/goals.md`

**TLDR:** The goal is sound and the constraints section is unusually well-aligned with GUIDANCE. But the document rests on one assumption that the codebase does not support — that a Lite scene retains enough source information to be *round-tripped* — and it inherits a testing strategy that is essentially unportable. The two flagged tensions are both resolvable; the unflagged ones are worse. My recommendation: **cut v1 to geometry + hierarchy + PBR factors + `.glb`, with zero textures and zero extensions**, and rewrite the testing section from scratch.

---

## 1. Consistency

**1.1 "One entry point" vs "zero bytes when unused" is a false tension.**
The goals treat this as an open conflict; it isn't. [packages/babylon-lite/package.json](packages/babylon-lite/package.json) already declares `sideEffects: false` with a root-only `exports` map, [tests/lite/build/treeshake-rollup.test.ts](tests/lite/build/treeshake-rollup.test.ts) proves the graph collapses to a sentinel, and [packages/babylon-lite/src/index.ts](packages/babylon-lite/src/index.ts) already ships ~30 opt-in `enable*` features from that same entry at zero cost to non-users. GUIDANCE §4e states it outright: "Root re-exports remain tree-shakable because the package is side-effect-free; alternate package entry points are not required for optional features."

The *real* risk is the one the goals don't name: GUIDANCE's **"Opt-in features pay for themselves at their enabler."** If the exporter needs any core module (mesh upload, material builders, texture loader) to change on its behalf, those bytes land in all 234 scenes in [scene-config.json](scene-config.json) — whose ceilings run from 14.8 KB to 161.3 KB. That, not the entry point, is where this feature can fail.

**1.2 "Port the BJS tests" directly contradicts "we do NOT copy Babylon.js code."**
GUIDANCE Pillar 4 is unqualified. Test code is code. The goals say "this is not a copy of the Babylon.js serializer" in one section and "port the existing Babylon.js exporter tests … as our regression suite" two sections later. Beyond the principle, the tests are technically unportable (see §3.9). Recommend restating as: *use the BJS tests as a behavioural checklist to derive Lite-native tests from.*

**1.3 The extension analogy breaks on the trigger.**
The constraint says extensions should be "triggered by what the scene actually contains — mirroring how `load-gltf.ts` registers loader features." But the loader's trigger is `needs(json)` — a cheap predicate over *source JSON* — and the entire registry is skipped by `assetUsesGltfFeatures(json)` at [load-gltf.ts:169](packages/babylon-lite/src/loader-gltf/load-gltf.ts#L169). An exporter has no JSON. Its trigger must be a scan over live scene state, and there is no equivalent cheap "does this scene use anything exotic" gate. The mirror is only half true, and the half that's missing is the cheap one.

**1.4 "Texture export works from `Texture2D`" is stated as a constraint but is the thing that makes texture export hard.**
[Texture2D](packages/babylon-lite/src/texture/texture-2d.ts) holds `texture`, `view`, `sampler`, `width`, `height`, a UV transform, and `invertY`. It has **no name, no source URL, no mime type, and no original bytes**. The one field that does carry a URL — `_recoverySource` — is stamped only by [device-lost-recovery-capture.ts:11](packages/babylon-lite/src/engine/device-lost-recovery-capture.ts#L11), i.e. only when device-lost recovery is enabled. So "works from `Texture2D`" reduces to "must read pixels back off the GPU," which §3.2 shows is currently impossible.

**1.5 The lab-scene deliverable is a category mismatch.**
[CONTRIBUTING.md](CONTRIBUTING.md) and GUIDANCE §2 require every new scene to ship a BJS reference scene, a golden PNG captured from BJS, a `maxMad`, a `maxRawKB`, a thumbnail, and a parity spec. An "export" scene has no BJS pixel equivalent. The existing machinery does not fit; the "if that is the right way" hedge should be resolved before design, not during.

---

## 2. Gaps

**2.1 There is no scene-level node registry — the exporter has no graph to walk.**
This is the largest omission. [SceneContext](packages/babylon-lite/src/scene/scene-core.ts#L88) holds `meshes: Mesh[]`, `lights`, `camera`, `animationGroups` — and no `rootNodes` or `transformNodes`. [addToScene](packages/babylon-lite/src/scene/scene-core.ts#L373) pushes only `Mesh` into `meshes` and `LightBase` into `lights`; a bare `TransformNode` is recursed into to set parent links but **is never registered anywhere**. So an exporter given a `SceneContext` can only enter the graph via `scene.meshes` and walk `parent` upward — meaning **any node without a mesh descendant is invisible and silently dropped**: pivots, attachment points, named nulls, empty groups. This single fact should determine the exporter's input type before anything else is designed.

**2.2 No decision on the input contract.** `exportGltf(scene)` vs `exportGltf(container)` vs `exportGltf(nodes[])`. [AssetContainer](packages/babylon-lite/src/asset-container.ts) holds `entities` (the root `TransformNode`), plus `cameras`, `materialVariants`, and `xmpMetadata` — it preserves everything a `SceneContext` throws away. See §7.3.

**2.3 No async/readiness story.** BJS does `await scene.whenReadyAsync()` before serializing (packages/dev/serializers/src/glTF/2.0/glTFSerializer.ts). Lite builds lazily: `_deferredBuilders` / `_built` in [scene-core.ts](packages/babylon-lite/src/scene/scene-core.ts), and GUIDANCE §1c notes material flags "are computed at first render." Exporting before `registerScene` or before frame 1 may observe a half-built scene. Not mentioned at all.

**2.4 No lossiness policy.** Non-goals covers "features Babylon Lite cannot represent." The harder class is features Lite *can render* but *cannot reconstruct* — ORM packing, pre-multiplied emissive, baked flat normals. Silent degradation needs an explicit policy: warn, throw, or drop.

**2.5 No error-handling story.** Lite has a coded error system ([lite-error.ts](packages/babylon-lite/src/lite-error.ts), [error-messages.ts](packages/babylon-lite/src/error-messages.ts), `enableErrorDecoding`, doc [49-error-handling.md](docs/lite/architecture/49-error-handling.md)). A new public API must use it, and GUIDANCE §6 bans `console.log`, so warnings need a real channel.

**2.6 No texture identity/dedup story.** BJS dedups on `internalTexture.uniqueId`. Lite's `cloneTexture2D` returns a fresh wrapper sharing the same `GPUTexture` — so dedup must key on `.texture` identity, not the wrapper object. Easy to get wrong; not mentioned.

**2.7 Nothing on `extras` / metadata / variants round-trip**, though the loader supports all three (`Material.metadata`, [gltf-feature-extras.ts](packages/babylon-lite/src/loader-gltf/gltf-feature-extras.ts), [material-variants.ts](packages/babylon-lite/src/loader-gltf/material-variants.ts)).

**2.8 No API-stability statement.** [AGENTS.md](AGENTS.md) ties breaking changes to release markers scanned from commits. Is `GltfExportResult` semver-stable from v1, or explicitly experimental (as the null engine is in [docs/lite/05-headless-null-engine.md](docs/lite/05-headless-null-engine.md))?

**Minor:** doc slot 53 is free, but note [docs/lite/architecture](docs/lite/architecture) already has duplicate numbers (two 42s, two 49s). Also [TESTING.md](TESTING.md) claims "25 scene spec files / All 25 test scenes" while `scene-config.json` has 234 entries — don't trust its counts.

---

## 3. Complications

**3.1 Vertex data is only partially retained on the CPU — and the missing part depends on an unrelated feature flag.**
[load-gltf.ts:125–128](packages/babylon-lite/src/loader-gltf/load-gltf.ts#L125) unconditionally retains `_cpuPositions`, `_cpuNormals`, `_cpuUvs`, `_cpuIndices`. But `_cpuUv2s`, `_cpuTangents`, `_cpuColors`, and `_cpuGpuIndices` are set **only inside `engine._dlr?.m(...)`** at [load-gltf.ts:129](packages/babylon-lite/src/loader-gltf/load-gltf.ts#L129), which resolves to [device-lost-recovery-capture.ts:49–63](packages/babylon-lite/src/engine/device-lost-recovery-capture.ts#L49) — i.e. only when device-lost recovery is enabled. [getMeshGeometry](packages/babylon-lite/src/mesh/get-mesh-geometry.ts) faithfully reflects that, emitting `tangents`/`uvs2`/`colors` only when present.

Consequence: an exporter built on `getMeshGeometry` **silently drops TANGENT, TEXCOORD_1, and COLOR_0 on the default path**, and produces different output depending on whether an unrelated recovery feature was enabled. Worse, **JOINTS_0 / WEIGHTS_0 are never CPU-retained at all** — they live only in `SkeletonData`. Skinned export is blocked on new retention plumbing, which is itself a bundle-size-sensitive core change.

**3.2 GPU readback is not available for either geometry or textures.**
[createMappedBuffer](packages/babylon-lite/src/resource/gpu-buffers.ts#L31) creates vertex/index buffers with `usage | BU.COPY_DST` — no `COPY_SRC`. Loaded textures use `TEXTURE_BINDING | COPY_DST | RENDER_ATTACHMENT` at [texture-2d.ts:193](packages/babylon-lite/src/texture/texture-2d.ts#L193) — no `COPY_SRC`. Nothing can be copied out as-is.

The existing precedent shows the cost: [screenshot-readback.ts](packages/babylon-lite/src/engine/screenshot-readback.ts) has to **reconfigure the swapchain** with `COPY_SRC` *before* the frame it wants, and pad every row to a 256-byte multiple. Adding `COPY_SRC` unconditionally to every texture is a footprint change across all 234 scenes.

**3.3 The V-flip trap — and Lite has two conventions, not one.**
GUIDANCE §8: raster uploads go through `copyExternalImageToTexture({ flipY: invertY=true })`, so the GPU texture stores row 0 = bottom. **A readback therefore yields a vertically flipped image versus the source PNG.** Codec textures (ktx2/basis) take the *other* path — stored row 0 = top, with `Texture2D.invertY = true` and a material-side V-flip. One exporter, two storage conventions, per-texture disambiguation required.

BJS hit exactly this. See the `internalTexture.invertY` branch in packages/dev/serializers/src/glTF/exportImageUtils.ts, which abandons its cached-bytes fast path precisely because "the GPU has the texture stored flipped … Falling back to GPU readback produces bytes that round-trip correctly." Lite has no cached-bytes path to fall back *from*.

**3.4 Handedness is harder than "how much applies," because Lite holds two populations of meshes.**
Lite's synthetic root is `createTransformNode("__root__", 0,0,0, 0,0,0,1, -1,1,1)` — identity rotation, scale `[-1,1,1]` ([load-gltf.ts:356](packages/babylon-lite/src/loader-gltf/load-gltf.ts#L356)). BJS uses rotation `[0,1,0,0]` + scale `[1,1,-1]` (noted at [gltf-parser.ts:145](packages/babylon-lite/src/loader-gltf/gltf-parser.ts#L145)). Same matrix, **different TRS decomposition** — so BJS's `IsNoopNode` / `removeNoopRootNodes` logic cannot be lifted.

Then: Lite stamps `mesh._authoredSign = -1` on glTF meshes ([gltf-share.ts:33](packages/babylon-lite/src/loader-gltf/gltf-share.ts#L33), [load-gltf.ts:664](packages/babylon-lite/src/loader-gltf/load-gltf.ts#L664)) to record that winding was authored for a negative-determinant space. Procedural meshes ([create-box.ts](packages/babylon-lite/src/mesh/create-box.ts) et al.) have **no** flip root and are authored in Lite's LH space. A single scene can legitimately contain both. That's why BJS carries 38 handedness references in `glTFExporter.ts` alone.

**3.5 ORM packing is destructive.**
[gltf-ext-orm.ts](packages/babylon-lite/src/loader-gltf/gltf-ext-orm.ts) composites metallic-roughness + occlusion into a new `ImageBitmap` via `OffscreenCanvas`, resizing occlusion to the MR dimensions, and hands back a single `ormTexture`. The sources are gone. You can emit one image referenced by both `metallicRoughnessTexture` and `occlusionTexture` (valid glTF), but the original occlusion resolution/encoding is lost. Note also that `PbrMaterialProps.ormTexture` is documented as R=occ/G=rough/B=metal while glTF's `metallicRoughnessTexture` only defines G/B — so the exporter must not assume R is meaningful when no compositing occurred.

**3.6 Emissive is stored pre-multiplied.**
GUIDANCE §1c: "`emissiveColor` is stored pre-multiplied (`factor × strength`)." `PbrMaterialProps._emissiveColor` is `@internal`, set only via `setPbrEmissive`. `KHR_materials_emissive_strength` is therefore unrecoverable — you either emit an out-of-spec `emissiveFactor` above 1.0 or clamp and lose energy. Needs a retained strength field or a documented policy.

**3.7 Every material feature lives behind an `@internal` `_`-field with a registrar.**
`_clearCoat`, `_sheen`, `_iridescence`, `_anisotropy`, `_subsurface`, `_transmissive`, `_unlit`, `_alphaCutOff`, `_metallicF0Factor`, `_uv2Mask`, `_gammaAlbedo` ([pbr-material.ts](packages/babylon-lite/src/material/pbr/pbr-material.ts)). Reading them internally is fine — but each extension exporter that touches one creates a module edge into the PBR material graph. GUIDANCE §4c′ documents that moving 5 shared feature bits out of `pbr-flag-bits.ts` returned scene1 to byte-identical. Design must guarantee every extension exporter uses `import type` only (fully erased) and never pulls a runtime constant from a shared module.

**3.8 The mesh-under-node bake doubles hierarchy depth per round trip.**
Per the comment at [load-gltf.ts:113–117](packages/babylon-lite/src/loader-gltf/load-gltf.ts#L113), the loader attaches each mesh as a *child* of its glTF node. Lite's graph is one level deeper than the source. Unless the exporter collapses mesh-under-node pairs, every load→export cycle adds a level. Easy to miss, trivially caught by a round-trip-twice test.

**3.9 The three named BJS tests are, individually, not portable.**

- **`sideEffects.test.ts`** asserts on `GLTFExporter._ExtensionNames` — a **module-level static registry**, which GUIDANCE explicitly forbids ("no module-level `new Map()`"). Lite already has the correct analogue: [tests/lite/build/treeshake-rollup.test.ts](tests/lite/build/treeshake-rollup.test.ts) and [treeshake-webpack.test.ts](tests/lite/build/treeshake-webpack.test.ts), which bundle and assert the graph collapses to a sentinel. Extend those; do not port the BJS test.
- **`glTFMaterialExporter.test.ts`** constructs `new NullEngine(...)` + `new Scene(engine)` and exercises the cached-URL-bytes path. Lite's null engine is **device-less by design** — [null-engine.ts](packages/babylon-lite/src/engine/null-engine.ts) states "`_device` is intentionally absent," and [docs/lite/05-headless-null-engine.md](docs/lite/05-headless-null-engine.md) says rendering is out of scope. `loadGltf` calls `createMappedBuffer(engine, …)` → `engine._device.createBuffer`, so it cannot run headless. And Lite has no cached-bytes path at all. Untranslatable as written.
- **`glTFSerializer.test.ts`** is Playwright driving a page with a `window.BABYLON` UMD global plus `@tools/test-tools` helpers (`evaluateInitEngine`, `getGlobalConfig`, `empty.html`, `#babylon-canvas`). Lite ships ESM-only with a root-only export map enforced by [tests/lite/build/public-api-types.test.ts](tests/lite/build/public-api-types.test.ts) and no global. All ~40 `page.evaluate` blocks would need rewriting. **The assertions are genuinely valuable; the harness is worthless here.**
- **Visual references.** Lite's parity harness compares against BJS-captured goldens under `reference/lite/sceneN-slug/`. There is no BJS-side equivalent of "Lite-exported-then-Lite-reimported," so a round-trip test's ground truth must be *Lite's own pre-export render* — a comparison mode the harness does not currently have.

**3.10 The round-trip parity test is weaker than the goals imply.**
Export → re-import → render → compare passes trivially for any **self-consistent** error. If exporter and importer share the same wrong handedness or UV convention, pixels match and the file is still broken in Blender or three.js. It proves *symmetry*, not *spec conformance*. See §7.4.

**3.11 Single camera slot.** `SceneContext.camera: Camera | null`. Multi-camera glTFs only survive as `AssetContainer.cameras`, and only after `enableGltfCameras()` ([index.ts:329](packages/babylon-lite/src/index.ts#L329)). Camera export from a `SceneContext` can structurally never emit more than one.

**3.12 Bundle-size enforcement is 234 scenes wide.** Also heed GUIDANCE's deoptimization rule: **never hand `GltfExportOptions` to an unknown callee** if its properties gate dynamic imports — pass pre-computed scalars. The measured precedent (`bgOptions` in `load-env.ts`) cost 4,968 B + 1,882 B across 55 scenes.

---

## 4. Assumptions to validate

1. **That a Lite scene is round-trippable at all.** Nothing retains the source glTF JSON, buffer views, accessor layouts, image bytes, sampler indices, non-mesh node names, or extension objects (except `metadata.gltf.extras` and `xmpMetadata`). This is a **re-derivation**, not a round trip. The phrase "load a glTF into Lite, modify the scene, export it back out" sets an expectation the data model cannot meet. Validate by taking BoomBox and hand-listing exactly what survives.
2. **That `getMeshGeometry` is the right source.** It `.slice()`s every array — fine for one mesh, unmeasured for Sponza.
3. **That "export" produces files.** BJS's `GLTFData.downloadFiles()` pulls in `Tools.Download`. Keep DOM download out of the core result type.
4. **That Lite's PBR maps cleanly to glTF core.** Mostly yes — `baseColorFactor`, `metallicFactor`, `roughnessFactor`, `normalTextureScale`, `occlusionStrength` are all present and glTF-named. But `specGlossTexture`, `_gammaAlbedo`, `reflectance`, `environmentIntensity`, `directIntensity` are Babylon-isms with no glTF home.
5. **That Standard materials are out of scope.** A scene can mix Standard and PBR. BJS converts via `SpecularPowerToRoughness` + `MergeTexturesAsync`. The goals never say whether Standard materials export, throw, or degrade.
6. **That the scene is stable when `exportGltf` is called.** See §2.3.
7. **That zero regression is achievable without touching core.** Verify *early* — if even one core module needs a hook, it has to move to an `engine._x?.()`-style seam.

---

## 5. Scope risks

| Risk | Where the v1 line should go |
|---|---|
| **"Port the glTF export capability from Babylon.js"** — unbounded; BJS is 9,227 lines across 63 files with 25 extensions | Replace with an explicit capability list in the architecture doc |
| **"Port the existing Babylon.js exporter tests"** — 960 lines against a harness that doesn't exist here | Highest creep risk in the document; could exceed the exporter's own cost. Rewrite as a checklist |
| **"A lab scene … if that is the right way"** — the "if" invites building new harness machinery | Decide before design starts; probably a plumbing test, not a scene |
| **Animation export** — BJS's `glTFAnimation.ts` is 1,087 lines and *bakes* curves. Lite's `AnimationGroup` is already sampler-based with `nodeIndex`/`path` in `targetedAnimations`, which looks deceptively close | Explicit non-goal for v1. The closeness is a trap |
| **"Extensions, never hardcoded"** could be read as "build the framework in v1" | With 0–2 extensions there's no framework worth building. Ship the *shape* (one module per extension, dynamic-imported, no core branching) with only what you implement |
| **Skinning / morph** | Non-goal — blocked on §3.1 |
| **Texture export** | Its own milestone. §3.2 + §3.3 make it the single largest risk |

---

## 6. Ideas

**6.1 Split into two deliverables: `exportGltfJson` (geometry + hierarchy + material factors, no images) and a separate opt-in texture path.** The first needs zero GPU work and is independently useful for editors, analytics, and geometry pipelines. The second carries all of the readback risk.

**6.2 Add a provenance seam instead of a readback path.** Lite already has the exact pattern: `Texture2D._recoverySource` carries `{ kind: "url", url, opts }`. Generalise it into a small opt-in `enableAssetProvenance()` that stamps origin URL / bytes / mime at load time — paid for at the enabler, per GUIDANCE §4. Texture export then becomes a **byte copy**, not a readback, which is what BJS's `GetCachedImageAsync` does most of the time anyway, and it dodges §3.3 entirely.

**6.3 Export from `AssetContainer` (or `SceneNode[]`), not `SceneContext`.** Preserves hierarchy, multiple cameras, `materialVariants`, and `xmpMetadata`; avoids the §2.1 hole; and is the natural inverse of `loadGltf`. Offer a `SceneContext` overload as sugar if desired, with its limitations documented.

**6.4 Validate against `@khronos-group/gltf-validator` in a vitest unit test.** It runs in Node, needs no GPU, and is the only thing that proves *spec conformance* rather than self-consistency. Directly addresses §3.10 at very low cost.

**6.5 Test at three levels, none of them ported:**
- (a) **vitest unit** on pure builders — accessor packing, min/max computation, TRS extraction, 4-byte alignment/padding, GLB chunk framing. No engine, no WebGPU. Matches the 194 existing tests in [tests/lite/unit](tests/lite/unit).
- (b) **Playwright plumbing** under [tests/lite/plumbing](tests/lite/plumbing) — load a GLB, export it, assert JSON shape + validator-clean. This is where the real GPU lives.
- (c) **one** round-trip parity spec.
Use the BJS integration test's ~40 `page.evaluate` cases purely as the behaviour checklist that generates (a) and (b).

**6.6 Make lossiness a first-class result field:** `GltfExportResult.warnings: readonly GltfExportWarning[]`, coded through [lite-error.ts](packages/babylon-lite/src/lite-error.ts) / [error-messages.ts](packages/babylon-lite/src/error-messages.ts) so it works with `enableErrorDecoding`. ESLint bans `console.log` anyway.

**6.7 Write [docs/lite/architecture/53-gltf-exporter.md](docs/lite/architecture) first and treat it as the scope contract.** GUIDANCE §4 requires it. Use its "Babylon.js Equivalence Map" section to record, per BJS extension, one of: *implemented / deferred / unrepresentable-in-Lite*. That converts the open scope question into a reviewable table.

**6.8 Consider framing this as "an exporter for Lite-authored content," not a round-tripper.** More honest about §4.1, and it sets user expectations correctly.

---

## 7. Answers to the Open Questions

### Q1 — Scope of v1
**Recommend:** core mesh (POSITION, NORMAL, TEXCOORD_0, indices) + node hierarchy + metallic-roughness PBR *factors* + alpha modes + double-sided. **Zero extensions. Zero textures** (unless you adopt 6.2, in which case textures-by-provenance). Explicitly out: skinning, morph, animation, cameras, lights, every `KHR_*`.

**Reasoning:** §3.1 blocks skinning outright (no CPU joints/weights), §3.2 + §3.3 block textures, animation is a 1,087-line trap (§5). Everything remaining is factor copying and matrix decomposition. This is roughly 5% of BJS's line count and is genuinely shippable. Confidence: **high**.

### Q2 — `.glb` vs `.gltf`
**Recommend: `.glb` only in v1.** Single binary chunk, no URI resolution, no multi-file result shape, no mime negotiation. Note that BJS's `GLTFData.files` map exists *specifically* to model the multi-file case — you do not want that type in your v1 public API, because removing it later is breaking. `.gltf` + `.bin` is a serialization layer over the same JSON + buffer output and can be added additively. Confidence: **high**.

### Q3 — Texture encoding
**Recommend: not in v1 — and when you do it, a provenance seam, not a readback utility.**

Three concrete blockers: (i) loaded textures lack `COPY_SRC` ([texture-2d.ts:193](packages/babylon-lite/src/texture/texture-2d.ts#L193)) and adding it globally changes footprint across 234 scenes; (ii) even with readback you inherit the two-convention V-flip problem (GUIDANCE §8), which BJS itself documents as the reason it abandons its cached path; (iii) PNG encoding in-browser means `OffscreenCanvas` + `convertToBlob`, another dependency in a size-critical package.

**On "does it belong in the exporter or a texture utility": the utility, unambiguously.** The exporter should consume `{ bytes: Uint8Array, mimeType: string, width, height }` and be indifferent to who produced it. Mirror [engine/screenshot-readback.ts](packages/babylon-lite/src/engine/screenshot-readback.ts) if a readback path is ever built. Confidence: **high** on the placement, **medium** on provenance-vs-readback (depends on whether you care about textures created procedurally, which have no provenance).

### Q4 — Right-handed conversion
**Recommend:** bake the flip into root-node TRS, with a fast path that **removes** Lite's `__root__` when it is the only thing between the subtree and RH.

**Reasoning:** Lite's `__root__` is scale `[-1,1,1]` — exactly the inverse of what glTF needs. A glTF-loaded subtree therefore exports correctly by *deleting that node*, with zero per-vertex work. But procedural meshes have no such root and genuinely need conversion.

So the real question is not "how much of BJS's work applies" — it's **"Lite holds two populations of meshes and the exporter must detect which it has."** The existing signal is `mesh._authoredSign` (set to `-1` by [gltf-share.ts:33](packages/babylon-lite/src/loader-gltf/gltf-share.ts#L33)).

Avoid per-vertex negation if at all possible: winding order, normals, tangent `.w` handedness, morph deltas, and thin-instance matrices all have to flip in lockstep — that's the source of BJS's 38 handedness references.

**Flagging for you:** whether v1 supports *mixed-handedness* scenes at all is a product call I can't make. Supporting only glTF-loaded subtrees in v1 is dramatically cheaper.

### Q5 — Where does this live
**Recommend: inside `packages/babylon-lite`, one named root export, everything below it dynamic-imported.**

The stated tension is not real (§1.1). GUIDANCE §4e settles it explicitly. A separate package would also **fail on a harder constraint**: it would need `@internal` material and mesh fields, which the d.ts trim pass strips from `dist/index.d.ts` per GUIDANCE §4b′.

The genuine risk is any change to a *core* module made on the exporter's behalf. Guard it by running a filtered bundle build against the smallest scenes (`maxRawKB` ≈ 14.8) before merging, per GUIDANCE §0c. Confidence: **high**.

### Q6 — Does `@babylonjs/lite-gl` need this?
**No — with high confidence.** [packages/babylon-lite-gl/package.json](packages/babylon-lite-gl/package.json) describes it as a "Function-based, tree-shakeable WebGL2 micro-engine for fullscreen effects, sprites and dynamic textures." Its `src/` is context, shader, effect, texture, mesh, sprites, render-target, state. There is **no scene graph, no node hierarchy, no PBR material, and no glTF loader** to be the inverse of. There is nothing to serialize.

---

## What I could not answer without you

- **Mixed-handedness support in v1** (§7.4) — a product scope call.
- **Whether Standard materials export at all** (§4.5) — needs your intent.
- **Whether the round trip must be lossless enough to be a workflow** (§4.1) vs. an export-for-interchange feature. This changes the whole design and is the single most important thing to settle before the architecture doc.
- **Whether `enableAssetProvenance()`-style retention is an acceptable new opt-in surface** (§6.2), or whether you'd rather live without texture export indefinitely.

---

**Confidence in this review: HIGH** for all claims about the Babylon-Lite codebase (every one is cited to a file and, where relevant, a line). **MEDIUM** for the BJS-side test-infrastructure claims — I read the imports and harness setup but did not execute the suites.