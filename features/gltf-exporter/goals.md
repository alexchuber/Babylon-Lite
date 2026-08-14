# Goals — glTF Exporter

## What I want

Give Babylon Lite the ability to write a `.glb` file from scene content it holds
in memory. Lite already **imports** glTF (`packages/babylon-lite/src/loader-gltf/`);
it has no way to write one.

The port must follow Babylon Lite guidance — this is not a copy of the Babylon.js
serializer. We understand what the Babylon.js exporter does, then write the
minimum Lite-idiomatic code that produces an equivalent glTF.

## Framing: export, not round trip

Nothing in Lite retains the source glTF JSON, buffer views, accessor layouts,
image bytes, sampler indices, or extension objects. Exporting is a
**re-derivation from live scene state**, not a round trip. We are building an
_export-for-interchange_ feature, and the docs should say so.

## Reference material

Babylon.js source (local clone at `~/Repos/Babylon/Babylon.js`):

- `packages/dev/serializers/src/glTF/2.0/` — exporter core
  (`glTFExporter.ts`, `glTFSerializer.ts`, `glTFMaterialExporter.ts`,
  `glTFAnimation.ts`, `glTFUtilities.ts`, `bufferManager.ts`, `dataWriter.ts`,
  `glTFData.ts`, `glTFMorphTargetsUtilities.ts`, `glTFExporterExtension.ts`)
- `packages/dev/serializers/src/glTF/2.0/Extensions/` — ~25 `KHR_*` / `EXT_*`
  extension exporters, each with a `.pure.ts` sibling

## V1 scope (decided)

**In:**

- Mesh geometry: `POSITION`, `NORMAL`, `TEXCOORD_0`, indices
- Node hierarchy with TRS transforms
- `.glb` output only
- **Both mesh populations** — glTF-loaded subtrees _and_ procedurally created
  meshes (`createBox` et al.), including the LH→RH conversion the latter needs

**Out:**

- **Materials of any kind.** glTF's `materials` array is optional and a primitive
  with no `material` is fully spec-conformant — viewers fall back to default grey.
  Cutting materials removes all material type checking, so mixed Standard/PBR
  scenes need no special handling and no error path. It also moots the
  pre-multiplied-emissive problem (GUIDANCE §1c) entirely.
- Textures and images of any kind
- All `KHR_*` / `EXT_*` extensions
- Non-triangle topology — points, lines, line strips, and triangle strips. The
  exporter throws a named coded error instead of guessing between Lite's two
  topology carriers or silently emitting triangles
- Animations
- Skinning and morph targets
- Lights — not in core glTF at all (needs `KHR_lights_punctual`), and Lite's
  `hemispheric` type has no glTF equivalent, so it would also force a lossiness policy
- Cameras — these _are_ core glTF and Lite's `fov`/`nearPlane`/`farPlane` map almost
  1:1, so this is the cheapest thing to add next. Deliberately deferred, not blocked
- `.gltf` + `.bin` (additive later; `.glb` first keeps the result type simple)
- USDZ, BVH, `.babylon` serialization
- Draco compression

## Key technical findings (verified in source)

These settle the questions that were open in the first draft:

- **Vertex data needs no GPU readback.** GPU buffers are allocated `COPY_DST`-only
  ([gpu-buffers.ts:32](packages/babylon-lite/src/resource/gpu-buffers.ts#L32)), so
  they genuinely cannot be copied out — but Lite retains CPU mirrors.
  `_cpuPositions`, `_cpuNormals`, `_cpuUvs`, `_cpuIndices` are set unconditionally
  on **both** the glTF path ([load-gltf.ts:125](packages/babylon-lite/src/loader-gltf/load-gltf.ts#L125))
  and the procedural path ([mesh-factories.ts:62](packages/babylon-lite/src/mesh/mesh-factories.ts#L62)).
  `getMeshGeometry(mesh)` returns caller-owned copies. Every v1 attribute is
  already there.
  _(For the record: `_cpuTangents`, `_cpuUv2s`, `_cpuColors` are retained on the
  procedural path but only under device-lost recovery on the glTF path; joints and
  weights are never CPU-retained. All are out of v1 scope.)_
- **The hierarchy is intact, it just isn't indexed by the scene.**
  `TransformNode` is a type alias for `SceneNode`
  ([transform-node.ts:15](packages/babylon-lite/src/scene/transform-node.ts#L15))
  and `Mesh extends SceneNode`. `SceneContext` keeps flat `meshes`/`lights` arrays
  and no `rootNodes`; [addToScene](packages/babylon-lite/src/scene/scene-core.ts#L373)
  never registers a bare `TransformNode` anywhere. Exporting from a `SceneContext`
  would therefore drop empty pivots and attachment points.
- **Therefore: v1 exports an `AssetContainer`, not a `SceneContext` or loose
  `SceneNode[]`.** `AssetContainer.entities` is the array of hierarchy roots
  ([asset-container.ts:19](packages/babylon-lite/src/asset-container.ts#L19)).
  It is the natural first adapter because `loadGltf` already returns one, but it
  must remain an adapter into a container-agnostic serializer core rather than
  becoming the exporter's permanent internal data model.
- **The container is a live-state view, not a snapshot.** `exportGltf()` reads the
  transforms and CPU geometry currently referenced by the container. A freshly
  loaded or manually assembled container need not have been registered or rendered.
  If it was added to scenes, export it before removing it from its final owning
  scene and keep it live and stable until the export promise settles. Final removal
  permanently retires each mesh and eventually marks `mesh._disposed`; disposed
  entities are invalid export input
  ([scene-remove.ts:14](packages/babylon-lite/src/scene/scene-remove.ts#L14),
  [mesh-scene-registry.ts:62](packages/babylon-lite/src/scene/mesh-scene-registry.ts#L62)).
- **Handedness has two cases, and `_authoredSign` discriminates them.**
  glTF-loaded subtrees hang under a `__root__` with scale `[-1,1,1]`
  ([load-gltf.ts:356](packages/babylon-lite/src/loader-gltf/load-gltf.ts#L356)) and
  carry `mesh._authoredSign = -1` ([gltf-share.ts:33](packages/babylon-lite/src/loader-gltf/gltf-share.ts#L33));
  those export by **removing that node**, with no per-vertex work. Procedural
  meshes have no flip root and need real LH→RH conversion, with winding order,
  normals, and tangent `.w` flipping in lockstep. This is the largest single piece
  of v1 work.
- **The package-location question is settled by GUIDANCE §4e.** This lives inside
  `packages/babylon-lite`, exposed as one named root export, with everything below
  it dynamic-imported. The package is already `sideEffects: false` and ships ~30
  opt-in `enable*` features at zero cost to non-users. A separate package would
  fail anyway — it would need `@internal` fields that the d.ts trim pass strips.

## Testing approach

Use the Babylon.js exporter tests as a **behavioural checklist to derive
Lite-native tests from** — not as a suite to port. Porting them would violate
"we do NOT copy Babylon.js code", and all three are technically unportable:
`sideEffects.test.ts` asserts on a module-level static registry GUIDANCE forbids,
`glTFMaterialExporter.test.ts` needs a rendering `NullEngine` Lite deliberately
does not have, and `glTFSerializer.test.ts` drives a `window.BABYLON` UMD global
that ESM-only Lite does not ship.

Four levels:

1. **vitest unit** (`tests/lite/unit/`) — pure builders: accessor packing,
   min/max computation, TRS extraction, 4-byte alignment and padding, GLB chunk
   framing, LH→RH conversion. No engine, no WebGPU.
2. **Structural conformance** — hand-rolled assertions over the emitted JSON and
   binary layout (chunk framing, buffer/bufferView/accessor reachability, index
   bounds, required fields, no dangling references). We are deliberately _not_
   taking a dependency on `@khronos-group/gltf-validator`.
3. **Playwright plumbing** (`tests/lite/plumbing/`) — load a GLB, export it,
   assert JSON shape and structural correctness. One round-trip check
   (export → re-import → render) as a sanity signal only; on its own it proves
   symmetry, not correctness.
4. **Babylon.js visual parity** — adapt, rather than copy, three live upstream
   serializer scenarios discovered in
   `packages/tools/tests/test/visualization/config.json`:

- `KX53VK#88`: negative-world-matrix winding, including a second round trip
- `KX53VK#85`: shared geometry converted once across multiple meshes
- `UK7FLI#1`: varied parent/child quaternion conversion

All three playgrounds were fetched and validated live against Babylon.js 9.21.1:
they rendered ready scenes with no console/page errors. Their existing PNGs are
**not reusable** because Babylon.js wrote 4, 3, and 1 materials respectively,
while v1 intentionally emits none. Reimplement the behaviours in focused BJS/Lite
fixtures, apply equivalent test-only materials after re-import, and generate new
BJS references through Lite's parity harness. Do not copy playground source or
upstream golden images.

Existing tree-shaking coverage
([treeshake-rollup.test.ts](tests/lite/build/treeshake-rollup.test.ts),
[treeshake-webpack.test.ts](tests/lite/build/treeshake-webpack.test.ts)) is
extended rather than duplicated.

## Constraints (from GUIDANCE.md — non-negotiable)

- **Pure state interfaces.** No methods on public types. `exportGltf(container, options)`,
  not `container.exportGltf()`.
- **One-way data ownership.** The exporter reads nodes; nodes never gain an
  exporter reference.
- **Extensions, never hardcoded.** V1 ships zero extensions, but the _shape_ must
  be right — one module per extension, dynamic-imported, no feature branching in
  the exporter core. Extension-only feature constants live inside their own
  module, never in a shared one (GUIDANCE §4c′).
- **Zero module-level side effects.** No registration at import time, no
  module-level `new Map()`.
- **Zero bytes when unused.** No bundle-size regression in any of the 234 scenes;
  no ceiling changes. Verify early against the smallest scenes
  (`maxRawKB` ≈ 14.8) per GUIDANCE §0c. If any _core_ module needs to change on
  the exporter's behalf, it must go through an `engine._x?.()`-style seam.
- **Never pass an options object to an unknown callee** if its properties gate
  dynamic imports — pass pre-computed scalars (GUIDANCE §4, the `bgOptions`
  precedent cost 4,968 B + 1,882 B across 55 scenes).
- **One public package entry point.** Re-exported by name from
  `packages/babylon-lite/src/index.ts`. No subpath export.
- **No GPU internals in the public API.**
- **Coded errors.** Use [lite-error.ts](packages/babylon-lite/src/lite-error.ts) /
  [error-messages.ts](packages/babylon-lite/src/error-messages.ts); `console.log`
  is banned.

## Deliverables

- Exporter implementation in `packages/babylon-lite/src/`
- Tests at the four levels above
- A lab demo page with an export + download button, for manual verification.
  This showcase is **not itself** a numbered parity scene; the focused BJS/Lite
  exporter fixtures above own the visual references and parity specs
- Architecture doc at `docs/lite/architecture/53-gltf-exporter.md`, matching the
  style of the existing numbered docs, including a **Babylon.js equivalence map**
  recording each BJS extension as _implemented / deferred / unrepresentable-in-Lite_

## PR completeness reference

Use [this Babylon-Lite PR](https://github.com/BabylonJS/Babylon-Lite/pull/528) (adds line system API) for reference on what a new feature's
PR might contain, especially one that keeps a minimal scope and was added to begin
parity work with an existing a Babylon.js feature.

Use [Babylon-Lite PR #534](https://github.com/BabylonJS/Babylon-Lite/pull/534)
(`ea876f56`, screen-space effects) as the model for a complete feature landing,
not as an implementation template. Applicable layers are: root API/type exports,
focused tests, a full architecture contract, interactive demo + catalog entry +
thumbnail, demo bundle measurement, zero-byte proof for unrelated scenes, scoped
quality commands, and a PR body recording concrete validation. Its 124 scene-manifest
edits were mostly shared-chunk hash churn, with a few tiny byte movements; they are not
a checklist item. This exporter must leave unrelated scene manifests untouched when
their fetched bytes do not move.

## Decisions for the architecture phase to capture

- **Input adapter.** Public v1 accepts only `AssetContainer`. The serializer core
  must consume an internal neutral representation so future adapters can be added
  without making `AssetContainer` its permanent schema.
- **Readiness and lifetime.** Export raw live node state with no registration or
  first-render precondition. Reject observable disposed meshes; document the caller
  rule to export before final scene removal and avoid mutation/removal while pending.
- **Lossiness reporting.** Warnings channel on the result
  (`GltfExportResult.warnings`) versus throwing. Dropped attributes, skipped
  materials, and unsupported node kinds all need somewhere to surface.
- **API stability.** V1 is explicitly experimental, like the null engine — confirm
  how that is declared and enforced.
- **Result type.** Keep DOM download out of the core result — BJS's
  `GLTFData.files` map exists to model the multi-file `.gltf` case we are not
  shipping, and having that type in v1 would make removing it breaking. The lab
  demo page's download button lives in lab code, not in the package.
