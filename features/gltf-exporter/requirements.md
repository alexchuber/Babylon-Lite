# Requirements — glTF Exporter (v1)

**Status:** Draft for review — 104 requirements; all decisions resolved
**Source goals:** [\_/features/gltf-exporter/goals.md](_/features/gltf-exporter/goals.md)
**Source review:** [\_/features/gltf-exporter/goals-review.md](_/features/gltf-exporter/goals-review.md)
**Governing constraints:** [GUIDANCE.md](GUIDANCE.md) (immutable), [AGENTS.md](AGENTS.md), [CONTRIBUTING.md](CONTRIBUTING.md), [TESTING.md](TESTING.md)

---

## 0. Framing

Babylon Lite retains no source glTF JSON, buffer views, accessor layouts, image bytes,
sampler indices, or extension objects. Export is therefore a **re-derivation from current
live state referenced by an `AssetContainer`**, not a round trip or snapshot. This feature is
**export-for-interchange**: the output
must be a valid, portable, correctly oriented glTF binary that a conformant third-party
viewer renders as Lite renders it — it is explicitly _not_ a lossless serialization of a
Lite scene, and must never be documented or tested as one.

Requirement language follows RFC 2119: **MUST**, **MUST NOT**, **SHOULD**, **MAY**.
Every question this document once carried as an open marker has been decided; the resolutions are
recorded in §12. No requirement below is provisional.

**Scope note — materials are out of v1 entirely.** No material, texture, image, or sampler of any
kind is exported, and emitted primitives carry no `material` property. glTF's `materials` array is
optional and a material-less primitive is fully spec-conformant: a conformant viewer falls back to
its own default (grey) material. Because the exporter never inspects a material, there is no
material type checking, no material error path, and mixed Standard/PBR scenes need no special
handling at all.

**Terminology.** _Exporter_ = the public export capability. _Input container_ = the caller-supplied
`AssetContainer` whose `entities` provide entry points into the node graph. _Lossy condition_ =
live state the exporter can observe but cannot represent in core glTF 2.0 without an extension.

---

## 1. Public API (`REQ-API`)

### Entry point and shape

- **REQ-API-1** — The exporter MUST be reachable through exactly one named export re-exported
  from [packages/babylon-lite/src/index.ts](packages/babylon-lite/src/index.ts). It MUST NOT
  introduce a package subpath export; the `exports` map of `@babylonjs/lite` MUST remain
  root-only in both source and emitted package metadata (GUIDANCE §4e).
- **REQ-API-2** — The public surface MUST be a standalone function taking its subject as the
  first argument. No exported type introduced by this feature MAY carry a method (GUIDANCE §4b′).
  `exportGltf(container, options)` is conformant; `container.exportGltf()` is not.
- **REQ-API-3** — The exporter MUST NOT require an `EngineContext`, `GPUDevice`, or any other
  GPU handle as a parameter, and no exported type MAY expose a raw WebGPU object
  (`GPUTexture`, `GPUBuffer`, `GPUDevice`, `GPUSampler`, `GPUTextureView`) (GUIDANCE §4d).
- **REQ-API-4** — The exporter MUST be asynchronous and return a `Promise`, so that all
  implementation modules below the entry point can be dynamic-imported (see REQ-SIZE-3).
- **REQ-API-5** — The exporter MUST NOT mutate any node, mesh, or container it is given. Data
  ownership stays one-way: the exporter reads scene state; scene state never gains a reference
  to the exporter (GUIDANCE §4b).

### Input contract

- **REQ-API-6** — The first argument to `exportGltf()` in v1 MUST be exactly one
  `AssetContainer`. The exporter MUST traverse every `SceneNode` entry in `container.entities`,
  including entries after the first. Non-`SceneNode` entries such as `LightBase`, and any subtree
  rooted beneath them, MUST be excluded with the lossiness warning required by REQ-NODE-9 and
  REQ-ERR-6. V1 MUST NOT promote their children or synthesize transform-only replacement nodes.
- **REQ-API-7** — `AssetContainer` MUST be the first public input adapter, not the permanent data
  model of the serializer core. The adapter MUST feed a private, container-neutral export
  representation consumed by the same GLB-writing and geometry-conversion behaviour, so a future
  input adapter can feed that representation without changing those behaviours. The neutral
  representation MUST NOT be exposed in the v1 public API.
- **REQ-API-8** — V1 MUST NOT expose a `SceneContext` or `SceneNode[]` overload, convenience,
  union input, or alternate entry point. `SceneContext` holds flat `meshes`/`lights` arrays and no
  `rootNodes`, and [`addToScene`](packages/babylon-lite/src/scene/scene-core.ts) never registers a
  bare `TransformNode`, so scene-based traversal would silently drop pivots, attachment points,
  and empty groups. The only v1 public input adapter is the `AssetContainer` in REQ-API-6.
- **REQ-API-9** — An `AssetContainer` whose `entities` array is empty or contains no exportable
  `SceneNode` MUST still produce a structurally valid empty `.glb` (see REQ-GLB) rather than
  throwing. Observable excluded entries MUST still produce their required warnings.

### Options and result

- **REQ-API-10** — The options argument MUST be optional. Calling the exporter with only the
  input argument MUST produce a valid export.
- **REQ-API-11** — The result MUST expose the complete `.glb` payload as a single binary
  value (`ArrayBuffer` or `Uint8Array`). It MUST NOT expose a multi-file map keyed by
  filename, and MUST NOT expose any DOM download, `Blob`, or object-URL helper — those
  model the multi-file `.gltf` case that is out of v1 scope, and removing them later would
  be a breaking change.
- **REQ-API-12** — The result MUST expose a readonly collection of lossiness warnings
  (see REQ-ERR-5). The collection MUST be present and empty rather than absent when the
  export was lossless.

### Readiness and determinism

- **REQ-API-13** — The exporter MUST read the current live transform and CPU-geometry state
  referenced by the container at serialization time. It MUST NOT require `registerScene`, a
  rendered frame, or prior scene ownership, and MUST NOT trigger a build, registration, or frame
  to obtain data. A freshly loaded or manually assembled container that has never entered a scene
  MUST remain valid input. The container is a set of live references, not a snapshot.
- **REQ-API-14** — Two exports of the same unmodified input MUST produce byte-identical
  output. Node, mesh, accessor, and buffer-view ordering MUST be deterministic and
  derived from traversal order, never from map/set iteration of object identities.
- **REQ-API-15** — The v1 API surface MUST be declared **experimental**, not semver-stable, in the
  same manner as the headless null engine
  ([docs/lite/05-headless-null-engine.md](docs/lite/05-headless-null-engine.md)). The declaration
  MUST appear both in [docs/lite/architecture/53-gltf-exporter.md](docs/lite/architecture) and in
  the public TSDoc of the exported function, so the input contract and the result type can later
  absorb `.gltf`, material, texture, and camera support additively without a breaking change.
- **REQ-API-16** — If a container has been added to one or more scenes, the caller MUST invoke
  and await `exportGltf()` before removing it from its final owning scene. The container and every
  reachable entity MUST remain live and stable — not mutated, removed, or disposed — until the
  returned `Promise` settles. Removing the container from a non-final scene is not intrinsically
  invalid while another scene still owns each reachable mesh.
- **REQ-API-17** — Preflight MUST reject any reachable mesh observably marked
  `_disposed === true`, abort before returning a partial result, and raise a coded error naming
  that mesh. Non-mesh nodes expose no equivalent disposed bit, so the exporter MUST NOT invent or
  infer one. This guard is intentionally limited to observable state: final-removal teardown is
  deferred, so the exporter MUST NOT claim it can always detect a just-removed mesh before
  retirement stamps `_disposed`. The caller contract remains REQ-API-16.

---

## 2. Geometry (`REQ-GEOM`)

- **REQ-GEOM-1** — The exporter MUST emit `POSITION`, `NORMAL`, `TEXCOORD_0`, and indices for
  every exported mesh. V1 supports triangle-list geometry only, and all four data sets are
  required; absence of any one MUST raise the coded error defined by REQ-GEOM-7.
- **REQ-GEOM-2** — The exporter MUST source geometry from Lite's retained CPU mirrors and
  MUST NOT attempt any GPU readback. Vertex and index buffers are created without
  `COPY_SRC` ([resource/gpu-buffers.ts](packages/babylon-lite/src/resource/gpu-buffers.ts)),
  so readback is impossible without a footprint change across every scene.
- **REQ-GEOM-3** — Each exported `Mesh` MUST map to exactly one glTF mesh containing exactly
  one primitive. `Mesh` has no submesh concept, so there is never a second primitive to emit.
- **REQ-GEOM-4** — Every emitted accessor MUST declare a `count`, `componentType`, and `type`
  consistent with the data it describes, and the `POSITION` accessor MUST additionally
  declare `min` and `max` (required by the glTF specification).
- **REQ-GEOM-5** — Attribute component types MUST be: `POSITION` = `FLOAT`/`VEC3`,
  `NORMAL` = `FLOAT`/`VEC3`, `TEXCOORD_0` = `FLOAT`/`VEC2`. Indices MUST use an unsigned
  integer component type wide enough for the mesh's vertex count.
- **REQ-GEOM-6** — Every accessor's `byteOffset` MUST satisfy the glTF 4-byte alignment rule
  relative to the start of the binary buffer, with padding inserted as required.
- **REQ-GEOM-7** — A mesh from which any required geometry cannot be obtained MUST raise a coded
  error identifying the mesh by name. It MUST NOT be silently skipped. "Cannot be obtained" means
  `POSITION`, `NORMAL`, `TEXCOORD_0`, or indices are not retained.
- **REQ-GEOM-8** — Any mesh whose topology is known to be non-triangle MUST abort the whole export
  before the exporter returns a partial `.glb`. The coded error MUST identify the mesh by name and
  state that triangle-list is the only topology supported in v1. Detection MUST cover both mesh
  populations and both existing carrier forms: procedurally created meshes use numeric
  `Mesh._topology`, while glTF-loaded meshes use loader-applied `_primitive` / `_primitiveFeatures`
  state rather than `Mesh._topology`. These carriers are inputs to error detection only; the
  exporter MUST NOT emit any non-triangle `primitive.mode`. Exact carrier decoding is an
  architecture decision and is not prescribed here.
- **REQ-GEOM-9** — Attributes Lite may hold but that are out of v1 scope — `TANGENT`,
  `TEXCOORD_1`, `COLOR_0`, `JOINTS_0`, `WEIGHTS_0` — MUST NOT be emitted, and their presence
  MUST raise a lossiness warning (REQ-ERR-5) rather than being dropped silently.
- **REQ-GEOM-10** — A mesh carrying thin-instance data, skeleton data, VAT data, or morph
  target data MUST export its base geometry only, and MUST raise a lossiness warning naming
  the dropped feature. It MUST NOT error.
- **REQ-GEOM-11** — When several meshes share the same underlying geometry, the exporter
  SHOULD emit that geometry once and reference it from multiple nodes rather than duplicating
  the buffer data.
- **REQ-GEOM-12** — Exported vertex data MUST be numerically equal to the retained CPU data
  up to the handedness transform defined in REQ-HAND. The exporter MUST NOT quantize,
  re-index, weld, or otherwise re-author geometry in v1.
- **REQ-GEOM-14** — A mesh with no topology marker on any carrier named in REQ-GEOM-8 is the
  normal triangle-list encoding and MUST export as glTF TRIANGLES, with `primitive.mode` omitted
  or set to `4`. It MUST NOT raise a warning or an error. Absence MUST be established across the
  applicable carriers; an unset `Mesh._topology` alone does not make a glTF-loaded mesh
  topology-less when its loader-applied state identifies a non-triangle mode.
- **REQ-GEOM-16** — No emitted primitive MAY carry a `material` property. A primitive with no
  `material` is fully conformant glTF 2.0 and renders with the consuming viewer's own default
  material, so its absence is a supported state rather than a malformed one. Every mesh that
  carries a Lite material MUST instead raise the material-loss warning of REQ-ERR-6.

---

## 3. Node hierarchy (`REQ-NODE`)

- **REQ-NODE-1** — The exporter MUST emit the full node tree reachable from every `SceneNode`
  entry in `AssetContainer.entities`, including nodes that carry no mesh and have no mesh
  descendant (pivots, attachment points, named nulls, empty groups).
- **REQ-NODE-2** — Node parent/child relationships in the output MUST match the input
  `parent`/`children` relationships, after the collapse defined in REQ-NODE-5 and the root removal
  defined in REQ-HAND-2.
- **REQ-NODE-3** — For a node whose local transform is expressed as a TRS triple, the exporter
  MUST emit `translation`, `rotation`, and `scale`, omitting any component equal to its glTF
  default (`[0,0,0]`, `[0,0,0,1]`, `[1,1,1]`). For a node whose local transform is expressed
  as a raw local matrix (the `_localMatrix` case used for glTF `matrix` nodes, where the TRS
  triple is ignored), the exporter MUST emit `matrix`. It MUST NOT emit both forms on one node.
- **REQ-NODE-4** — `SceneNode.name` MUST be preserved on the corresponding glTF node.
  A node with an empty name MUST omit `name` rather than emit an empty string.
- **REQ-NODE-5** — The exporter MUST collapse the loader's mesh-under-node pairing. The glTF
  loader attaches each mesh as a _child_ of its source glTF node, so Lite's graph is one level
  deeper than the source asset. Consequence, and the acceptance test:
  **N successive load→export cycles MUST NOT increase node depth.** Depth after two cycles
  MUST equal depth after one.
- **REQ-NODE-6** — Traversal MUST be cycle-safe and MUST visit a node reachable by more than
  one path exactly once. Malformed input MUST NOT cause unbounded recursion.
- **REQ-NODE-7** — Node ordering in the output MUST be a deterministic function of input
  traversal order (see REQ-API-14).
- **REQ-NODE-8** — `SceneNode.visible === false` has no core glTF representation. The node and
  its geometry MUST still be exported, and the exporter MUST raise a lossiness warning. Omission
  would be unrecoverable for the consumer — the geometry would simply not exist in the file —
  whereas an exported-but-warned node loses only a flag the caller can reapply.
- **REQ-NODE-9** — `AssetContainer.camera`, `AssetContainer.cameras`, and non-`SceneNode`
  `LightBase` entries MUST NOT be emitted in v1. Each excluded camera or light root MUST raise a
  lossiness warning. A subtree rooted beneath an excluded `LightBase` is excluded with that root;
  v1 MUST NOT promote its children because doing so would require another transform adapter.
- **REQ-NODE-10** — `SceneNode.metadata` MUST NOT be emitted in v1, and its presence MUST raise a
  lossiness warning. This includes `metadata.gltf.extras`, which MUST NOT be round-tripped even
  though the loader populates it and the mapping back to node `extras` would be 1:1 — v1 holds the
  "no extensions, no extras" line without exception.

---

## 4. Handedness (`REQ-HAND`)

- **REQ-HAND-1** — Exported content MUST be right-handed, Y-up, +Z toward the viewer, per the
  glTF 2.0 coordinate convention. A conformant third-party viewer MUST render the exported
  asset with the same orientation, chirality, and face visibility Lite renders it with.
- **REQ-HAND-2** — For content loaded from glTF, Lite interposes a synthetic `__root__` node
  with scale `[-1, 1, 1]`. The exporter MUST remove that node rather than emit it, and MUST
  reparent its children to the exported scene roots. It MUST NOT perform per-vertex work for
  this population.
- **REQ-HAND-3** — For procedurally created triangle-list meshes, which have no flip root and are
  authored in Lite's left-handed space, the exporter MUST perform a genuine left-to-right handed
  conversion. Vertex positions, vertex normals, and triangle winding order MUST be converted in
  lockstep so the result is self-consistent.
- **REQ-HAND-4** — The exporter MUST correctly handle a single export containing **both**
  populations simultaneously — glTF-loaded subtrees and procedurally created meshes — with each
  mesh oriented and wound correctly in the same output file.
- **REQ-HAND-5** — The exporter MUST NOT achieve handedness by leaving a negative-determinant
  transform on an emitted node without a corresponding winding flip. No emitted mesh MAY have a
  net negative-determinant world transform unless its winding was flipped to match.
- **REQ-HAND-6** — Round-trip verification: exporting a glTF-loaded asset and re-importing the
  result MUST reproduce every mesh's world-space vertex positions within floating-point
  tolerance of the original import.
- **REQ-HAND-7** — Handedness conversion MUST be verifiable without a GPU. The transform is a
  pure function of vertex data and MUST be exercised by unit tests (REQ-TEST-1).

---

## 5. Binary container (`REQ-GLB`)

- **REQ-GLB-1** — The exporter MUST produce `.glb` only. It MUST NOT produce a separate
  `.gltf` JSON file, a sidecar `.bin`, or any externally referenced URI.
- **REQ-GLB-2** — The output MUST begin with a 12-byte header: magic `glTF` (`0x46546C67`),
  version `2`, and a total length field equal to the exact byte length of the output.
- **REQ-GLB-3** — The output MUST contain exactly two chunks in order: a JSON chunk
  (type `0x4E4F534A`) followed by a binary chunk (type `0x004E4942`).
- **REQ-GLB-4** — Each chunk's declared length MUST equal its actual payload length, and each
  chunk's payload MUST be padded to a 4-byte boundary — the JSON chunk with spaces (`0x20`),
  the binary chunk with zeros (`0x00`). Padding MUST NOT be counted in the chunk length field
  in a way that contradicts the specification.
- **REQ-GLB-5** — The JSON chunk MUST declare exactly one buffer, with no `uri`, whose
  `byteLength` matches the binary chunk payload length.
- **REQ-GLB-6** — The JSON chunk MUST declare `asset.version` `"2.0"` and an `asset.generator`
  string identifying Babylon Lite and its version.
- **REQ-GLB-7** — The JSON chunk MUST NOT declare `extensionsUsed` or `extensionsRequired` in
  v1, since no extension is emitted.
- **REQ-GLB-8** — Output MUST satisfy a **hand-rolled structural conformance check** over the
  emitted JSON and binary layout. No validator package MAY be introduced to perform it
  (REQ-SIZE-9). The check MUST assert at minimum:
    1. **chunk framing** — magic, version, total length, chunk types, and chunk order;
    2. **padding rules** — JSON chunk space-padded, binary chunk zero-padded, both to 4 bytes;
    3. **reachability** — every `bufferView` resolves to a declared buffer, every `accessor` to a
       declared `bufferView`, and every attribute and index reference to a declared accessor;
    4. **no dangling references** — every index into `nodes`, `meshes`, `accessors`, `bufferViews`,
       and `buffers` is within bounds;
    5. **index bounds** — every index value is less than the referenced position accessor's `count`;
    6. **required fields present** — `asset.version`, accessor `count`/`componentType`/`type`,
       buffer `byteLength`;
    7. **accessor `min`/`max` correctness** — the declared bounds equal the true component-wise
       extrema of the data they describe;
    8. **byte alignment** — accessor and `bufferView` offsets satisfy the 4-byte rule.

    This proves **structural correctness and internal consistency — not full glTF 2.0 specification
    conformance.** Neither this document, the architecture doc, nor the tests MAY claim otherwise.

- **REQ-GLB-9** — The exporter MUST NOT emit a `scenes`/`scene` structure that leaves any
  exported node unreachable from the default scene.
- **REQ-GLB-10** — The output MUST be openable by at least one independent third-party consumer
  without modification. Because REQ-GLB-8 is a structural check rather than a specification
  validator, this requirement is verified by **manual inspection**: exporting from the lab demo
  page (REQ-TEST-11) and opening the result in an external viewer. It is a judgement gate, not a
  mechanized one, and MUST be recorded as such.
- **REQ-GLB-11** — The JSON chunk MUST NOT declare `materials`, `textures`, `images`, or
  `samplers` — neither populated nor empty — and no primitive MAY reference one (REQ-GEOM-16).

---

## 6. Errors and lossiness (`REQ-ERR`)

- **REQ-ERR-1** — All exporter failures MUST be raised as thrown `Error`s written as
  `throw new Error("…")` in source, so the build's error-code rewrite
  ([scripts/lite-error-plugin.ts](scripts/lite-error-plugin.ts)) moves the message text out of
  shipped bundles and the error remains decodable via `decodeError` / `enableErrorDecoding`
  ([docs/lite/architecture/49-error-handling.md](docs/lite/architecture)).
- **REQ-ERR-2** — The exporter MUST NOT use `console.log`. `no-console` is enforced by ESLint
  and permits only `warn`/`error`/`time`/`timeEnd`/`trace`; the exporter MUST NOT use any of
  them as its lossiness channel either (see REQ-ERR-5).
- **REQ-ERR-3** — Exactly **four** conditions MUST be **errors** (export aborts):
    1. a mesh whose CPU geometry is unavailable (REQ-GEOM-7);
    2. a first argument that is not an `AssetContainer` (REQ-API-6, REQ-API-8);
    3. a mesh whose topology is known to be non-triangle (REQ-GEOM-8); and
    4. a reachable mesh observably marked `_disposed === true` (REQ-API-17).

    There is deliberately no material-related abort condition — the exporter never inspects a
    material (REQ-GEOM-16). Any further abort condition is a scope change.

- **REQ-ERR-4** — Every entity-specific error message MUST identify the offending entity by name
  (or index where unnamed) so the caller can locate it without a debugger. In particular, the
  disposed-mesh error MUST name the mesh. An input-shape error MUST identify the first argument
  as the invalid subject.
- **REQ-ERR-5** — Every lossy condition MUST surface as a structured **warning** on the result
  (REQ-API-12), carrying a stable machine-readable code and the identity of the affected
  entity. Warnings MUST NOT abort the export, and MUST NOT be written to the console.
- **REQ-ERR-6** — The exporter MUST raise a lossiness warning for at minimum: **dropped material
  information** (REQ-GEOM-16), raised once per mesh that carries a Lite material, since every
  emitted primitive is material-less and this is the largest single loss in v1; dropped
  attributes (REQ-GEOM-9); thin instances, skinning, VAT, and morph targets (REQ-GEOM-10);
  invisible nodes (REQ-NODE-8); dropped lights and cameras (REQ-NODE-9); dropped metadata
  (REQ-NODE-10); and dropped animation groups.
- **REQ-ERR-7** — Warning codes MUST be stable across releases so callers can filter on them.
  Adding a code is additive; changing the meaning of an existing code is breaking.
- **REQ-ERR-8** — A lossy export MUST still produce a valid `.glb` satisfying REQ-GLB.
  Lossiness never degrades output validity.
- **REQ-ERR-9** — The exporter MUST NOT silently degrade. Any observable scene state that is
  not represented in the output MUST be either an error (REQ-ERR-3) or a warning (REQ-ERR-6).
  Silent omission is a defect.
- **REQ-ERR-10** — Error and warning text MUST NOT be constructed by string concatenation that
  defeats the build-time message extraction; interpolated runtime values MUST be passed as
  arguments so they are attached to the thrown error rather than baked into every bundle.

---

## 7. Footprint, tree-shaking, and regression (`REQ-SIZE`)

- **REQ-SIZE-1** — Adding the exporter MUST cause **zero** runtime-byte growth in every scene
  in [scene-config.json](scene-config.json) that does not call it. `scene-config.json` has 237
  entries, 234 of which carry a `maxRawKB` ceiling ranging from 14.8 KB to 161.3 KB. Verify
  early against the smallest ceilings (GUIDANCE §0c).
- **REQ-SIZE-2** — No `maxRawKB` ceiling and no `maxMad` threshold MAY be changed for this
  feature. A regression is a design defect, not a new baseline (GUIDANCE §4, AGENTS.md).
- **REQ-SIZE-3** — Importing the `@babylonjs/lite` barrel MUST NOT pull exporter code into a
  consumer's graph. Only a consumer that references the exporter export MAY pay for it.
- **REQ-SIZE-4** — Adding the exporter MUST NOT cause any chunk that a scene previously
  tree-shook away to become runtime-fetched in that scene. This is the observable form of
  GUIDANCE's deoptimization rule (the measured `bgOptions` precedent cost 4,968 B + 1,882 B
  across 55 scenes); it is verified by per-scene bundle manifests, not by code review.
- **REQ-SIZE-5** — No module introduced by this feature MAY execute code at import time: no
  `register*()` calls, no `globalThis` mutation, no module-level `new Map()`/`new Set()`/
  `new WeakMap()`. The existing side-effect tests
  ([tests/lite/build/treeshake-rollup.test.ts](tests/lite/build/treeshake-rollup.test.ts),
  [treeshake-webpack.test.ts](tests/lite/build/treeshake-webpack.test.ts)) MUST pass unmodified.
- **REQ-SIZE-6** — The root-only package export map MUST remain intact;
  [tests/lite/build/public-api-types.test.ts](tests/lite/build/public-api-types.test.ts) MUST
  pass without being weakened or bypassed.
- **REQ-SIZE-7** — No `@internal` member MAY appear in the exporter's public type surface after
  the d.ts trim pass. The emitted `dist/index.d.ts` MUST remain self-consistent (GUIDANCE §4b′).
- **REQ-SIZE-8** — Core modules (mesh, material, scene, loader, resource) MUST NOT gain
  exporter-specific semantics. If a core module must change on the exporter's behalf, the
  change MUST be limited to a single optional-chained engine seam (`engine._x?.()`) whose
  meaning lives entirely in the exporter's own module.
- **REQ-SIZE-9** — This feature MUST NOT add **any** new dependency — runtime, dev, or peer — to
  `packages/babylon-lite/package.json` or to the workspace root.
  `@khronos-group/gltf-validator` is explicitly **rejected**. Structural conformance is proven by
  assertions this repository owns (REQ-GLB-8), written directly against the emitted JSON and
  binary layout, with no third-party package involved.
- **REQ-SIZE-10** — Existing behaviour MUST be preserved: the glTF **loader** MUST continue to
  function unchanged, all existing parity specs MUST pass at their current MAD thresholds, and
  no existing golden reference image under `reference/lite/**` MAY be regenerated for this
  feature. New exporter-specific BJS references required by REQ-TEST-16 through REQ-TEST-18 are
  additive and MUST follow the repository reference-image convention.
- **REQ-SIZE-11** — Only existing per-scene bundle manifests for scenes actually affected by the
  change MAY be regenerated and committed. If no existing scene imports or calls the exporter and
  its fetched bytes do not change, no existing per-scene manifest MAY change. Unrelated manifests
  MUST remain untouched, and the aggregate `lab/public/bundle/manifest.json` MUST NOT be committed
  (GUIDANCE §0c). The required demo entry in `lab/public/bundle/demos-manifest.json` is separate
  from the per-scene manifest set (REQ-DELIV-3, REQ-DELIV-6).

---

## 8. Testing (`REQ-TEST`)

- **REQ-TEST-1** — Pure logic MUST be covered by Vitest unit tests in
  [tests/lite/unit/](tests/lite/unit), requiring no engine and no WebGPU: accessor packing,
  min/max computation, TRS extraction and default omission, 4-byte alignment and padding,
  GLB chunk framing, and left-to-right handed conversion.
- **REQ-TEST-2** — Structural conformance MUST be verified by a Node-hosted test applying the
  hand-rolled assertions of REQ-GLB-8 to exported output. The assertion set MUST be reusable, so
  that any test producing a `.glb` can assert structural correctness on it. Its documentation MUST
  state that it proves structure and internal consistency, not specification conformance.
- **REQ-TEST-3** — End-to-end behaviour MUST be covered by a Playwright plumbing test in
  [tests/lite/plumbing/](tests/lite/plumbing) that loads a real `.glb`, leaves the returned
  `AssetContainer` unregistered, exports it successfully, and asserts both JSON shape and the
  REQ-GLB-8 structural checks. This is the explicit never-added-container contract of REQ-API-13.
- **REQ-TEST-4** — A round-trip test (export → re-import) MUST exist as a sanity signal. An
  attached-container case MUST modify a transform while attached, observe that live change in the
  export, await export completion, remove the source from its final scene, and successfully
  re-import the output. The test MUST be documented as proving _symmetry only_, not conformance,
  and MUST NOT be presented as the primary correctness gate; REQ-TEST-2 is.
- **REQ-TEST-5** — A test MUST assert node-depth stability across two successive load→export
  cycles (REQ-NODE-5).
- **REQ-TEST-6** — A test MUST assert byte-identical output across two exports of the same stable,
  unmodified live input (REQ-API-14, REQ-API-16).
- **REQ-TEST-7** — A test MUST assert that a scene mixing glTF-loaded and procedurally created
  meshes exports both correctly (REQ-HAND-4).
- **REQ-TEST-8** — Tests MUST assert the error and warning contract: **all four** conditions in
  REQ-ERR-3 throw before any partial result is returned, including an observably disposed mesh,
  and each condition in REQ-ERR-6 produces the expected warning code without aborting. Entity
  errors MUST assert the identity required by REQ-ERR-4. No test MAY assert a material-type error,
  since none exists.
- **REQ-TEST-9** — No Babylon.js test code MAY be copied. The Babylon.js exporter tests MAY be
  used only as a behavioural checklist from which Lite-native tests are derived (GUIDANCE
  Pillar 4). The three named BJS suites are in any case unportable: `sideEffects.test.ts`
  asserts on a module-level static registry GUIDANCE forbids, `glTFMaterialExporter.test.ts`
  needs a rendering `NullEngine` Lite deliberately does not have, and `glTFSerializer.test.ts`
  drives a `window.BABYLON` UMD global that ESM-only Lite does not ship.
- **REQ-TEST-10** — Existing tree-shaking coverage MUST be **extended**, not duplicated, to
  cover the exporter export (REQ-SIZE-3, REQ-SIZE-5).
- **REQ-TEST-11** — A **lab demo page** MUST be delivered: it builds or loads scene content,
  invokes the exporter, and offers a **download button**, so a human can open the result in an
  external viewer (REQ-GLB-10). It is explicitly **not** a numbered parity scene and MUST remain
  distinct from the dedicated BJS/Lite exporter parity fixtures in REQ-TEST-16 through
  REQ-TEST-18. The demo itself MUST NOT receive a `maxMad`/`maxRegionMad` threshold, a
  `scene-config.json` entry, or serve as the visual oracle fixture. Its catalog registration and
  demo thumbnail are required separately by REQ-DELIV-2.
- **REQ-TEST-12** — Agents MUST NOT run the all-scene suite, full parity, unfiltered bundle
  builds, or `pnpm test:perf` while validating this feature. Because the user explicitly requires
  exporter visual comparisons, validation MUST include only the focused exporter parity specs
  from REQ-TEST-16 and REQ-TEST-17, together with affected unit/plumbing tests, filtered bundle
  work, demo smoke checks, and lint/typecheck (AGENTS.md guardrails).
- **REQ-TEST-13** — The demo page's download and DOM behaviour MUST live in lab code only. No
  `Blob`, object URL, anchor click, or other DOM API introduced by this feature MAY appear under
  `packages/babylon-lite/src/`, and the exporter result MUST remain DOM-free (REQ-API-11). This is
  verifiable by inspection of the package source and its emitted `.d.ts`.
- **REQ-TEST-14** — Tests MUST cover topology error detection across **both** mesh populations
  (REQ-GEOM-8): one procedurally created non-triangle mesh using `Mesh._topology` and one
  glTF-loaded non-triangle mesh using loader-applied `_primitive` / `_primitiveFeatures` state
  MUST each produce the coded error, identify the mesh by name, and return no partial `.glb`.
  A normal topology-less triangle mesh MUST succeed, emit TRIANGLES with `primitive.mode` omitted
  or set to `4`, and produce no topology warning (REQ-GEOM-14).
- **REQ-TEST-15** — A test MUST assert that exported JSON contains no `materials`, `textures`,
  `images`, or `samplers` array and that no primitive carries a `material` property
  (REQ-GEOM-16, REQ-GLB-11), including for input meshes that do carry Lite materials.
- **REQ-TEST-16** — Focused BJS-vs-Lite visual parity scenarios MUST be independently derived
  from the behaviours demonstrated by Babylon.js playgrounds `KX53VK#88` and `UK7FLI#1`, with
  those IDs retained for traceability. The first MUST cover Lite-authored procedural LH content
  under ordinary and negative-scale parents through **two** export/re-import cycles; the second
  MUST cover varied parent/child quaternion hierarchies. Each Lite fixture MUST export while its
  source `AssetContainer` is live, await the export, then remove the source and re-import the
  output before rendering.
- **REQ-TEST-17** — The shared-geometry conversion behaviour derived from `KX53VK#85` MUST be
  covered either by its own focused visual fixture or within one of the fixtures in REQ-TEST-16.
  Coverage MUST include structural assertions that one shared source geometry is converted once
  without mutating the input and rendered BJS-vs-Lite parity after re-import.
- **REQ-TEST-18** — The fixtures in REQ-TEST-16 and REQ-TEST-17 MUST reuse only the upstream
  behaviours, never Babylon.js playground source or existing upstream PNGs. Because the upstream
  outputs contain materials and the first two rely on vertex colours, their goldens MUST NOT be
  treated as expected output for material-free v1. After re-import, both BJS and Lite sides MUST
  receive equivalent **test-only** materials so parity isolates geometry, hierarchy, and winding.
  New BJS reference images MUST be generated through this repository's parity harness.

---

## 9. Delivery completeness (`REQ-DELIV`)

- **REQ-DELIV-1** — [docs/lite/architecture/53-gltf-exporter.md](docs/lite/architecture)
  MUST specify the exact experimental public API; the `AssetContainer` adapter and lifetime
  contract; the private neutral serializer-model boundary; live-state and disposed-mesh
  preconditions; geometry, hierarchy, handedness, GLB, and error contracts; a Babylon.js
  equivalence/deferred table; test and bundle strategies; and a complete file manifest.
- **REQ-DELIV-2** — The unnumbered export/download demo MUST be registered in
  [demos-config.json](demos-config.json), have a representative JPG thumbnail at
  `lab/public/thumbnails/demo-gltf-exporter.jpg`, and be present in the generated demo site. It
  MUST remain distinct from the BJS/Lite parity fixtures in REQ-TEST-16 through REQ-TEST-18.
- **REQ-DELIV-3** — The demo's fetched JavaScript raw and gzip sizes MUST be measured and recorded
  in `lab/public/bundle/demos-manifest.json`. [scripts/bundle-demos-core.ts](scripts/bundle-demos-core.ts)
  MAY change only if dedicated runtime assets require copy plumbing. No new third-party asset is
  required; if one is added, its provenance and licence MUST be documented and the asset MUST be
  local and reproducible.
- **REQ-DELIV-4** — Public API/type coverage MUST verify the single package-root export, the
  experimental public TSDoc, the absence of leaked `@internal` or GPU types, and the shape of the
  emitted public `.d.ts`.
- **REQ-DELIV-5** — The eventual PR body MUST contain a concrete validation record naming the
  exact focused unit, plumbing, parity, typecheck, and lint commands and their results; demo
  readiness and download-smoke results; structural GLB checks; one independent-consumer smoke
  result reporting Babylon.js import counts; demo raw/gzip bytes; and proof that unrelated scene
  fetched bytes and manifests did not move. The record MUST NOT claim a pass before that command
  or check has run.
- **REQ-DELIV-6** — PR #534's 124 per-scene manifest edits MUST NOT be copied as generic churn.
  Only affected per-scene manifests required by GUIDANCE §0c MAY change. If no existing scene
  imports or calls the exporter and fetched bytes remain unchanged, no existing per-scene manifest
  SHOULD change. The demo manifest is separate and MUST change as required by REQ-DELIV-3.

---

## 10. Out of Scope (v1)

The following are explicitly **not** delivered in v1. Each MUST be absent from the output and,
where the corresponding state is observable in the scene, MUST raise a lossiness warning
(REQ-ERR-6) or a coded error (REQ-ERR-3) as specified above.

**Lifecycle precondition, not snapshot semantics.** An `AssetContainer` is a set of live
references. Never-added containers are supported, but callers with scene-owned content must obey
REQ-API-16 and export before final removal. The exporter rejects `_disposed === true` meshes, but
deferred retirement creates a window after final removal and before that observable flag is set;
detecting that window for non-mesh nodes or unstamped meshes is not promised in v1.

| Excluded                                                                                                   | Disposition in v1                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Materials of any kind**                                                                                  | Warning; primitives emitted with no `material` (REQ-GEOM-16, REQ-GLB-11, REQ-ERR-6). No error path                                                                                 |
| Textures, images, samplers                                                                                 | Warning, folded into the material warning; arrays never declared (REQ-GLB-11)                                                                                                      |
| All `KHR_*` / `EXT_*` extensions                                                                           | Never emitted (REQ-GLB-7)                                                                                                                                                          |
| Animations / animation groups                                                                              | Warning (REQ-ERR-6)                                                                                                                                                                |
| Skinning, `JOINTS_0`, `WEIGHTS_0`                                                                          | Warning; never CPU-retained by Lite (REQ-GEOM-9, REQ-GEOM-10)                                                                                                                      |
| Morph targets                                                                                              | Warning (REQ-GEOM-10)                                                                                                                                                              |
| Cameras                                                                                                    | Warning; excluded (REQ-NODE-9). Cheapest next addition — deferred, not blocked                                                                                                     |
| Lights and subtrees rooted beneath `LightBase` entries                                                     | Warning; excluded (REQ-NODE-9). Needs `KHR_lights_punctual`; Lite's hemispheric has no glTF equivalent                                                                             |
| `.gltf` + `.bin` output                                                                                    | Not produced (REQ-GLB-1). Additive later                                                                                                                                           |
| `TANGENT`, `TEXCOORD_1`, `COLOR_0`                                                                         | Warning (REQ-GEOM-9)                                                                                                                                                               |
| Points, lines, line strips, triangle strips, `LINE_LOOP`, `TRIANGLE_FAN`, and all other non-triangle modes | **Rejected in v1.** A named coded error aborts the whole export before any partial `.glb` is returned (REQ-GEOM-8, REQ-ERR-3)                                                      |
| `@khronos-group/gltf-validator`                                                                            | **Rejected.** No new dependency; structural checks are hand-rolled (REQ-SIZE-9, REQ-GLB-8)                                                                                         |
| Lab demo as a numbered parity fixture                                                                      | Not added; the unnumbered demo has its own catalog thumbnail, while dedicated exporter fixtures own new BJS references (REQ-TEST-11, REQ-TEST-16 through REQ-TEST-18, REQ-DELIV-2) |
| Upstream BJS playground source or PNGs                                                                     | Never copied; only behaviours are independently adapted and new references generated (REQ-TEST-18)                                                                                 |
| USDZ, BVH, `.babylon` serialization                                                                        | Not in scope                                                                                                                                                                       |
| Draco compression                                                                                          | Not in scope                                                                                                                                                                       |
| GPU readback of geometry or textures                                                                       | Impossible without a footprint change (REQ-GEOM-2)                                                                                                                                 |
| `SceneContext` or `SceneNode[]` as export input                                                            | No v1 public adapter or convenience; only `AssetContainer` is accepted (REQ-API-6 through REQ-API-8)                                                                               |
| DOM download / `Blob` / multi-file result                                                                  | Not in the result type (REQ-API-11); the demo page's download lives in lab code (REQ-TEST-13)                                                                                      |
| `metadata` / `extras`                                                                                      | Warning; never round-tripped (REQ-NODE-10)                                                                                                                                         |
| `@babylonjs/lite-gl` support                                                                               | Not applicable — no scene graph, no PBR, no glTF loader to invert                                                                                                                  |

---

## 11. Acceptance Criteria Summary

| ID          | Requirement (abbrev.)                                          | MUST/SHOULD | Verified by                                    |
| ----------- | -------------------------------------------------------------- | ----------- | ---------------------------------------------- |
| REQ-API-1   | One named root export, no subpath                              | MUST        | `public-api-types.test.ts`                     |
| REQ-API-2   | Standalone function, no methods on public types                | MUST        | API-shape unit test + type check               |
| REQ-API-3   | No engine/GPU handle in signature or types                     | MUST        | Type check + public d.ts review                |
| REQ-API-4   | Returns a Promise                                              | MUST        | Unit test                                      |
| REQ-API-5   | No mutation of input                                           | MUST        | Unit test (deep snapshot before/after)         |
| REQ-API-6   | Accepts exactly `AssetContainer`; traverses all node entries   | MUST        | Unit test + public type check                  |
| REQ-API-7   | Private neutral model behind first public adapter              | MUST        | Architecture review + focused unit test        |
| REQ-API-8   | No `SceneContext` or `SceneNode[]` public input                | MUST        | Type check + public d.ts review                |
| REQ-API-9   | Empty/no-exportable-entity container → valid GLB               | MUST        | Unit test + structural checks                  |
| REQ-API-10  | Options optional                                               | MUST        | Unit test                                      |
| REQ-API-11  | Single binary result; no files map, no DOM helper              | MUST        | Type check + public d.ts review                |
| REQ-API-12  | Warnings collection always present                             | MUST        | Unit test                                      |
| REQ-API-13  | Reads live state; never-added container succeeds               | MUST        | Plumbing test (REQ-TEST-3)                     |
| REQ-API-14  | Byte-identical repeat export                                   | MUST        | Unit test (REQ-TEST-6)                         |
| REQ-API-15  | Declared experimental, not semver-stable                       | MUST        | Doc + TSDoc review                             |
| REQ-API-16  | Await export before final removal; input stable while pending  | MUST        | Plumbing test + architecture review            |
| REQ-API-17  | Observable disposed mesh aborts preflight, named               | MUST        | Unit/plumbing test (REQ-TEST-8)                |
| REQ-GEOM-1  | Required triangle attributes and indices emitted               | MUST        | Unit test + structural checks                  |
| REQ-GEOM-2  | No GPU readback                                                | MUST        | Code review + no `COPY_SRC` change             |
| REQ-GEOM-3  | One Mesh → one mesh, one primitive                             | MUST        | Unit test                                      |
| REQ-GEOM-4  | Accessor count/type/min/max correct                            | MUST        | Unit test + structural checks                  |
| REQ-GEOM-5  | Correct component types                                        | MUST        | Unit test + structural checks                  |
| REQ-GEOM-6  | 4-byte accessor alignment                                      | MUST        | Unit test + structural checks                  |
| REQ-GEOM-7  | Any missing required CPU geometry → coded error                | MUST        | Unit test                                      |
| REQ-GEOM-8  | Non-triangle topology → named coded error, both carriers       | MUST        | Unit test (REQ-TEST-14)                        |
| REQ-GEOM-9  | Out-of-scope attributes dropped **with warning**               | MUST        | Unit test                                      |
| REQ-GEOM-10 | Instancing/skin/VAT/morph → base geometry + warning            | MUST        | Unit test                                      |
| REQ-GEOM-11 | Shared geometry deduplicated                                   | SHOULD      | Unit test (buffer length assertion)            |
| REQ-GEOM-12 | No re-authoring beyond handedness                              | MUST        | Unit test (value equality)                     |
| REQ-GEOM-14 | No topology marker → TRIANGLES, no warning                     | MUST        | Unit test (REQ-TEST-14)                        |
| REQ-GEOM-16 | No `material` property on any primitive                        | MUST        | Unit test (REQ-TEST-15)                        |
| REQ-NODE-1  | Mesh-less nodes preserved                                      | MUST        | Unit test                                      |
| REQ-NODE-2  | Parent/child relationships preserved                           | MUST        | Unit test                                      |
| REQ-NODE-3  | TRS vs `matrix` emission, defaults omitted                     | MUST        | Unit test                                      |
| REQ-NODE-4  | Names preserved; empty name omitted                            | MUST        | Unit test                                      |
| REQ-NODE-5  | Depth stable across repeat load→export                         | MUST        | Plumbing test (REQ-TEST-5)                     |
| REQ-NODE-6  | Cycle-safe traversal                                           | MUST        | Unit test                                      |
| REQ-NODE-7  | Deterministic node order                                       | MUST        | Unit test                                      |
| REQ-NODE-8  | Invisible nodes exported + warning                             | MUST        | Unit test                                      |
| REQ-NODE-9  | Camera/light roots and light-rooted subtrees excluded + warned | MUST        | Unit test                                      |
| REQ-NODE-10 | Metadata dropped + warning                                     | MUST        | Unit test                                      |
| REQ-HAND-1  | Output is RH / Y-up / glTF convention                          | MUST        | Round-trip + plumbing test + manual viewer     |
| REQ-HAND-2  | `__root__` flip node removed, not emitted                      | MUST        | Unit test (no `[-1,1,1]` node in output)       |
| REQ-HAND-3  | Procedural triangle lists converted LH→RH in lockstep          | MUST        | Unit test                                      |
| REQ-HAND-4  | Mixed populations in one export                                | MUST        | Plumbing test (REQ-TEST-7)                     |
| REQ-HAND-5  | No unmatched negative-determinant transform                    | MUST        | Unit test                                      |
| REQ-HAND-6  | Round-trip world positions within tolerance                    | MUST        | Plumbing test                                  |
| REQ-HAND-7  | Conversion unit-testable without GPU                           | MUST        | Unit test exists                               |
| REQ-GLB-1   | `.glb` only, no external URI                                   | MUST        | Unit test + structural checks                  |
| REQ-GLB-2   | Header magic/version/length correct                            | MUST        | Unit test                                      |
| REQ-GLB-3   | Exactly two chunks, JSON then BIN                              | MUST        | Unit test                                      |
| REQ-GLB-4   | Chunk lengths + 4-byte padding correct                         | MUST        | Unit test + structural checks                  |
| REQ-GLB-5   | Single buffer, no `uri`, matching `byteLength`                 | MUST        | Unit test + structural checks                  |
| REQ-GLB-6   | `asset.version` `"2.0"` + generator string                     | MUST        | Unit test                                      |
| REQ-GLB-7   | No `extensionsUsed` / `extensionsRequired`                     | MUST        | Unit test                                      |
| REQ-GLB-8   | Hand-rolled structural conformance (8 checks)                  | MUST        | Structural test suite (REQ-TEST-2)             |
| REQ-GLB-9   | All nodes reachable from default scene                         | MUST        | Structural test                                |
| REQ-GLB-10  | Opens in an independent consumer                               | MUST        | **Manual** — lab demo page + external viewer   |
| REQ-GLB-11  | No `materials`/`textures`/`images`/`samplers` arrays           | MUST        | Unit test (REQ-TEST-15)                        |
| REQ-ERR-1   | Coded-error path, decodable                                    | MUST        | Unit test with `decodeError`                   |
| REQ-ERR-2   | No `console.*` as a channel                                    | MUST        | ESLint + code review                           |
| REQ-ERR-3   | **Four** enumerated abort conditions throw                     | MUST        | Unit test (REQ-TEST-8)                         |
| REQ-ERR-4   | Errors name the offending entity                               | MUST        | Unit test                                      |
| REQ-ERR-5   | Structured warnings with stable codes                          | MUST        | Unit test                                      |
| REQ-ERR-6   | Enumerated lossy conditions each warn, incl. materials         | MUST        | Unit test (REQ-TEST-8)                         |
| REQ-ERR-7   | Warning codes stable across releases                           | MUST        | Snapshot test on the code set                  |
| REQ-ERR-8   | Lossy export still valid                                       | MUST        | Structural test on a lossy fixture             |
| REQ-ERR-9   | No silent degradation                                          | MUST        | Unit test coverage audit                       |
| REQ-ERR-10  | Interpolated values passed as args                             | MUST        | Code review + bundle content check             |
| REQ-SIZE-1  | Zero byte growth in non-using scenes                           | MUST        | Filtered `build-bundle-scenes` + manifest diff |
| REQ-SIZE-2  | No ceiling / threshold changes                                 | MUST        | `git diff` on `scene-config.json`              |
| REQ-SIZE-3  | Barrel import pulls in nothing                                 | MUST        | Extended treeshake tests (REQ-TEST-10)         |
| REQ-SIZE-4  | No previously-shaken chunk becomes fetched                     | MUST        | Per-scene bundle manifests                     |
| REQ-SIZE-5  | Zero module-level side effects                                 | MUST        | `treeshake-rollup` / `treeshake-webpack`       |
| REQ-SIZE-6  | Root-only export map intact                                    | MUST        | `public-api-types.test.ts`                     |
| REQ-SIZE-7  | No `@internal` in public d.ts                                  | MUST        | d.ts inspection                                |
| REQ-SIZE-8  | Core modules carry no exporter semantics                       | MUST        | Code review + REQ-SIZE-1                       |
| REQ-SIZE-9  | No new dependency of any kind                                  | MUST        | `package.json` + lockfile diff                 |
| REQ-SIZE-10 | Loader/existing goldens unchanged; new exporter refs additive  | MUST        | Focused parity + reference diff review         |
| REQ-SIZE-11 | Only affected scene manifests; demo manifest separate          | MUST        | Manifest and fetched-byte diff                 |
| REQ-TEST-1  | Vitest unit coverage of pure builders                          | MUST        | Suite exists and passes                        |
| REQ-TEST-2  | Structural conformance test suite                              | MUST        | Suite exists and passes                        |
| REQ-TEST-3  | Unregistered-container Playwright plumbing test                | MUST        | Suite exists and passes                        |
| REQ-TEST-4  | Live transform + await/remove/re-import symmetry test          | MUST        | Test + doc comment                             |
| REQ-TEST-5  | Depth-stability test                                           | MUST        | Test exists                                    |
| REQ-TEST-6  | Determinism test                                               | MUST        | Test exists                                    |
| REQ-TEST-7  | Mixed-population test                                          | MUST        | Test exists                                    |
| REQ-TEST-8  | Four-error/warning contract, including disposed mesh           | MUST        | Test exists                                    |
| REQ-TEST-9  | No Babylon.js test code copied                                 | MUST        | Code review                                    |
| REQ-TEST-10 | Treeshake coverage extended, not duplicated                    | MUST        | Diff of existing build tests                   |
| REQ-TEST-11 | Unnumbered lab demo distinct from parity fixtures              | MUST        | Demo and parity inventory review               |
| REQ-TEST-12 | Scoped validation, including focused exporter parity           | MUST        | Recorded commands/results                      |
| REQ-TEST-13 | Download/DOM code confined to lab                              | MUST        | Package source + d.ts inspection               |
| REQ-TEST-14 | Topology errors cover both carriers; default succeeds          | MUST        | Test exists                                    |
| REQ-TEST-15 | Output carries no material constructs                          | MUST        | Test exists                                    |
| REQ-TEST-16 | `KX53VK#88` + `UK7FLI#1` focused BJS visual parity             | MUST        | Focused parity specs + new references          |
| REQ-TEST-17 | `KX53VK#85` shared-geometry structure + visual parity          | MUST        | Structural assertion + focused parity spec     |
| REQ-TEST-18 | No upstream copying; normalized test materials/new refs        | MUST        | Fixture/reference review + focused parity      |
| REQ-DELIV-1 | Complete numbered architecture contract                        | MUST        | Architecture-doc review                        |
| REQ-DELIV-2 | Registered demo, JPG thumbnail, generated site                 | MUST        | Demo config/build inspection                   |
| REQ-DELIV-3 | Demo raw/gzip manifest; asset plumbing only if needed          | MUST/MAY    | Demo bundle measurement + diff                 |
| REQ-DELIV-4 | Public API/TSDoc/emitted d.ts coverage                         | MUST        | Build/type tests + emitted d.ts inspection     |
| REQ-DELIV-5 | Evidence-based PR validation record                            | MUST        | Eventual PR-body review                        |
| REQ-DELIV-6 | No #534-style unrelated manifest churn                         | MUST/SHOULD | Scene/demo manifest and fetched-byte diff      |

---

## 12. Resolved Decisions

Every question this document previously carried as an open marker is decided. **No open question
remains.** Reopening one is a scope change, not a clarification.

| #   | Question                                                       | Decision                                                                                                                                                                  | Affects                                                     |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1   | Which materials does v1 export?                                | **None.** Materials of any kind are out of scope; primitives carry no `material`                                                                                          | REQ-GEOM-16, REQ-GLB-11, REQ-ERR-3, REQ-ERR-6               |
| 2   | Clamp pre-multiplied emissive, or emit `>1`?                   | **Moot** — no material data is emitted, so the clamp problem does not arise                                                                                               | _(former material requirement deleted)_                     |
| 3   | Standard materials: coded error?                               | **No error.** The exporter never inspects material type                                                                                                                   | REQ-ERR-3                                                   |
| 4   | Non-triangle topology: error, or emit as glTF primitive modes? | **Reject.** Both carrier populations are detected; a named coded error aborts export. No marker means TRIANGLES                                                           | REQ-GEOM-8, REQ-GEOM-14, REQ-HAND-3, REQ-ERR-3, REQ-TEST-14 |
| 5   | Approve `@khronos-group/gltf-validator` as a devDependency?    | **Rejected.** No new dependency; structural checks are hand-rolled                                                                                                        | REQ-SIZE-9, REQ-GLB-8, REQ-TEST-2                           |
| 6   | Any lab demo page for manual verification?                     | **Yes** — required and unnumbered; dedicated BJS/Lite parity fixtures are separate                                                                                        | REQ-TEST-11, REQ-TEST-13, REQ-DELIV-2, REQ-GLB-10           |
| 7   | Which public input adapters ship in v1?                        | **`AssetContainer` only.** It is the first adapter into a private neutral serializer model; no `SceneContext` or `SceneNode[]` convenience                                | REQ-API-6 through REQ-API-8                                 |
| 8   | What readiness and lifetime states are supported?              | Never-added containers are valid; scene-owned content must be exported and awaited before final removal; observable disposed meshes abort                                 | REQ-API-13, REQ-API-16, REQ-API-17                          |
| 9   | Is the v1 surface semver-stable or explicitly experimental?    | **Experimental**, like the headless null engine                                                                                                                           | REQ-API-15                                                  |
| 10  | Invisible nodes: export with warning, or omit?                 | **Export with a warning** — omission is unrecoverable                                                                                                                     | REQ-NODE-8                                                  |
| 11  | Round-trip `metadata.gltf.extras`?                             | **No**, not in v1                                                                                                                                                         | REQ-NODE-10                                                 |
| 12  | Does exporter correctness have a Babylon.js visual oracle?     | **Yes.** Dedicated fixtures independently derive the behaviours in `KX53VK#88`, `KX53VK#85`, and `UK7FLI#1`; upstream source/PNGs are not copied                          | REQ-TEST-16 through REQ-TEST-18                             |
| 13  | Which PR #534 completion patterns apply?                       | API/type exports, focused tests, architecture, demo/catalog/thumbnail, demo measurement, scoped evidence, and zero unrelated scene-byte churn; not its 124 manifest edits | REQ-DELIV-1 through REQ-DELIV-6, REQ-SIZE-11                |

### Requirement counts for this revision

| Group       | Before | After   | Change                                      |
| ----------- | ------ | ------- | ------------------------------------------- |
| `REQ-API`   | 15     | 17      | +2 (live ownership/disposal contract)       |
| `REQ-GEOM`  | 14     | 14      | unchanged                                   |
| `REQ-NODE`  | 10     | 10      | unchanged                                   |
| `REQ-MAT`   | 0      | 0       | group remains deleted                       |
| `REQ-HAND`  | 7      | 7       | unchanged                                   |
| `REQ-GLB`   | 11     | 11      | unchanged                                   |
| `REQ-ERR`   | 10     | 10      | unchanged; disposed mesh added to REQ-ERR-3 |
| `REQ-SIZE`  | 11     | 11      | unchanged; manifest rules reconciled        |
| `REQ-TEST`  | 15     | 18      | +3 (BJS-derived visual coverage)            |
| `REQ-DELIV` | 0      | 6       | +6 (feature-completion evidence)            |
| **Total**   | **93** | **104** | **+11**                                     |
