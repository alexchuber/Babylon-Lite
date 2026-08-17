# Implementation Plan — glTF Exporter (v1)

**Status:** Approved milestone plan

**Source PRD:** [prd.md](prd.md); **Source requirements:**
[requirements.md](requirements.md) — 63 requirements
**Governing constraints:** [GUIDANCE.md](../../GUIDANCE.md)

## Delivery model

All work lands on one feature branch and is integrated as one feature. The
milestones below are implementation checkpoints, not independently releasable
partial features. Except for documentation and repository evidence, acceptance
is observed by calling the public
`exportSceneGLB(scene: SceneContext): Promise<Blob>` seam and inspecting its
`Blob` bytes or thrown coded errors. No test reaches into the private collected
type or serializer.

```text
1 Architecture contract
  -> 2 Private GLB writer and emitted-subset helper
    -> 3 Scene collector and mesh-ancestor hierarchy
      -> 4 CPU geometry collection, topology, and identity deduplication
        -> 5 Handedness states, conversion-root removal, and GLB serialization
          -> 6 Public integration, errors, re-import, and tree-shaking
            -> 7 One combined numbered visual parity scene
              -> 8 Download demo, catalog, measurement, manual gate, evidence
```

## Shared rules

- Read `GUIDANCE.md` and the four planning documents before implementation.
- Keep the exact public contract, with no options, alternate input, download
  side effect, or exporter-specific label.
- Keep collection synchronous and serialization asynchronous. Use ordinary
  static imports and no GPU readback.
- Treat the scene graph as a well-formed tree or forest. Do not add graph
  repair or collapse mesh wrappers. Remove only roots that pass the
  Babylon.js-equivalent structural no-op coordinate-conversion test.
- Preserve source state. Do not mutate or dispose nodes, meshes, or referenced
  CPU arrays while an export is pending. Existing lazy interleaved getters may
  materialize their normal de-strided cache when read.
- Add no dependency, package subpath, threshold, ceiling, golden, or unrelated
  scene-manifest churn.
- Keep the test helper limited to the emitted subset and do not describe it as
  full glTF conformance validation.
- Use focused local validation only. CI owns full scene coverage and no
  all-scene, unfiltered bundle, or performance run is part of this work.

## Milestone 1 — Architecture contract

**Purpose:** Write the one-shot architecture document before implementation.

**Work:**

1. Create `docs/lite/architecture/53-gltf-exporter.md` with the exact public
   signature and MIME contract.
2. Specify the private `collectSceneForGltf` and `serializeGlb` phases and their
   purpose-built collected type.
3. Specify ancestor-closure selection, deterministic ordering, geometry
   policy, Babylon.js-equivalent handedness states and root sniffing, GLB
   layouts, omission policy, and coded-error policy.
4. Add the Babylon.js equivalence map: core behavior rows individually;
   exporter extensions grouped as deferred.
5. Record the test seams, focused validation, bundle strategy, and file
   manifest.

**Acceptance:**

- The architecture contract matches `REQ-API-1..REQ-API-8`,
  `REQ-SCENE-1..REQ-SCENE-8`, and `REQ-DELIV-1..REQ-DELIV-3`; its promised
  runtime behavior is later observable through the public Blob/error seam.
- It explicitly records the JSON-only empty GLB and one-BIN geometry GLB from
  `REQ-GLB-1..REQ-GLB-8`.
- It records the no-warning, non-exhaustive coded-error policy in
  `REQ-ERR-1..REQ-ERR-5`, without inventing a fixed error count.
- It contains no rejected input adapter, dynamic-import requirement,
  name-based root detection, universal alignment rule, or stale
  review-document link (`REQ-DELIV-6`).

**Validation:** Architecture-document review only.

## Milestone 2 — Private GLB writer and emitted-subset test helper

**Purpose:** Establish byte-level GLB construction before scene traversal.

**Work:**

1. Implement the private writer for glTF 2.0 header, UTF-8 JSON, chunk lengths,
   JSON space padding, and binary zero padding.
2. Support the two required layouts: JSON-only empty output and JSON plus one
   BIN chunk with one URI-less buffer for geometry.
3. Add the test-side parser/assertion helper for the emitted subset. It checks
   framing, padding, reachability, component alignment, accessor shapes,
   position bounds, triangle indices, and default-scene reachability.
4. Keep alignment component-aware; do not apply a universal four-byte
   component rule.

**Acceptance:**

- A future public-seam call with an empty `SceneContext` can yield the
  JSON-only structure required by `REQ-GLB-2`, `REQ-GLB-3`, and `REQ-GLB-5`.
- A future public-seam geometry call can yield one BIN and one URI-less buffer
  with correct references under `REQ-GLB-4..REQ-GLB-7`.
- The helper validates only the emitted subset, has no validator dependency,
  and is suitable for every later public-seam Blob test (`REQ-GLB-8`,
  `REQ-TEST-1`, `REQ-TEST-2`, `REQ-SIZE-3`).
- No writer import performs work or creates mutable module state
  (`REQ-API-8`, `REQ-SIZE-1`, `REQ-SIZE-2`).

**Validation:** Once the public seam exists, run the helper against public
Blob fixtures; do not add production tests against writer internals.

## Milestone 3 — Scene collector and mesh-ancestor hierarchy

**Purpose:** Build the synchronous scene-first collection phase.

**Work:**

1. Seed collection from `scene.meshes`.
2. Walk each seed's live `SceneNode` ancestors and retain the closure,
   including transform-only ancestors and loader-created roots, stopping at a
   non-`SceneNode` world-matrix provider.
3. Preserve mesh wrappers. For each selected graph root, apply the
   Babylon.js-equivalent no-op coordinate-conversion test; remove matching
   transform-only roots and promote their children without using the root name.
4. Stop at an out-of-scope non-`SceneNode` parent and snapshot the selected
   child root's current world matrix, preserving placement without exporting
   light/camera semantics.
5. Emit each remaining included node once, preserve names and relationships,
   omit unrelated empty/unindexed nodes, and establish deterministic order.
6. Snapshot inexpensive node state and record the root conversion state and
   work needed by serialization.
7. Keep malformed graph behavior undefined rather than adding repair or a
   general validation pass.

**Acceptance:**

- Public-seam Blob JSON proves the selected closure, one-to-one hierarchy after
  root normalization, names, transform-only ancestors, promoted root children,
  and default-scene reachability (`REQ-SCENE-1..REQ-SCENE-4`,
  `REQ-SCENE-7`).
- Public-seam fixtures prove visibility and metadata do not add output or
  warning behavior, mesh wrappers remain, and only structurally matching
  conversion roots disappear (`REQ-SCENE-5`, `REQ-SCENE-7`).
- Repeated calls on unchanged live state produce deterministic node and
  reference order (`REQ-SCENE-4`, `REQ-SCENE-8`, `REQ-TEST-2`).
- Collection finishes before `serializeGlb` begins and does not mutate source
  graph state (`REQ-API-6`, `REQ-API-7`).

**Validation:** Focused public-seam JSON assertions and immutability checks.

## Milestone 4 — CPU geometry collection, topology policy, and identity deduplication

**Purpose:** Attach current retained CPU base geometry to collected nodes.

**Work:**

1. Read retained positions, normals, indices, and optional UVs. Do not read
   back from the GPU. Treat a loader-created zero-filled retained UV array as
   current UV geometry.
2. Reject currently marked non-triangle topology using existing coded errors;
   treat unmarked triangle-list data as the normal case.
3. Preserve current values and choose an index component type wide enough for
   the vertex count.
4. Deduplicate only explicit shared live geometry identity, keyed with the
   coordinate-conversion state and final winding mode. Do not byte-compare
   unrelated arrays.
5. Emit base geometry only for skeleton, morph, VAT, and thin-instance meshes.
   Omit tangents, UV2, colors, joints, weights, and other unsupported
   attributes without a warning channel.

**Acceptance:**

- Public-seam Blob accessors prove required CPU attributes, optional UV0,
  one mesh/one primitive, faithful values, and suitable index width
  (`REQ-GEOM-1`, `REQ-GEOM-4`, `REQ-GEOM-5`).
- A public-seam topology fixture throws an existing coded error for a current
  non-triangle marker, while ordinary unmarked triangle data succeeds
  (`REQ-GEOM-2`, `REQ-ERR-1`, `REQ-ERR-2`).
- No general runtime mesh validity audit is introduced
  (`REQ-GEOM-3`); emitted-subset assertions may check bounds
  (`REQ-GLB-8`).
- Public-seam Blob bytes prove shared identity deduplication and component-aware
  alignment without unrelated byte comparison (`REQ-GEOM-6`, `REQ-GEOM-7`,
  `REQ-TEST-2`).
- Deformation and unsupported attributes remain omitted without warnings or
  expansion (`REQ-GEOM-8`, `REQ-GEOM-9`, `REQ-ERR-3`, `REQ-GLB-6`).

**Validation:** Focused public-seam Blob/error assertions; no GPU or all-scene
validation.

## Milestone 5 — Handedness states, conversion-root removal, and GLB serialization

**Purpose:** Reproduce Babylon.js exporter handedness behavior for ordinary
Lite roots and removable loader conversion roots, then finish serialization.

**Work:**

1. Give each selected root one Babylon.js-equivalent export state: ordinary
   Lite roots convert LH-to-RH; children promoted from a sniffed no-op
   conversion root use the already-RH path.
2. Convert transforms, positions, and normals according to that state.
   Normalize emitted quaternions in both states; apply Babylon.js's
   deterministic canonical sign rule only on the converted path.
3. Map `_authoredSign ?? 1` to the retained geometry's base orientation (the
   same baseline used by Lite's mirrored-mesh support), then apply the
   equivalent of Babylon.js's removed-root winding compensation.
   `_authoredSign` does not select the coordinate-conversion state; the live
   determinant remains encoded in the emitted transforms and does not
   independently reverse indices.
4. Preserve negative scales and mesh wrappers.
5. Keep conversion private and deterministic, then pack converted data into the
   writer's component-aware buffer regions.
6. Ensure empty and geometry-bearing outputs have the exact GLB layouts and
   MIME required by the public contract.

**Acceptance:**

- Public-seam Blob JSON and binary data prove ordinary LH-to-RH conversion and
  the already-RH path for promoted conversion-root children
  (`REQ-HAND-1`, `REQ-HAND-2`).
- The public-seam combined fixture accepts ordinary and negative scales without
  mirrored or inside-out faces (`REQ-HAND-3`, `REQ-TEST-4`).
- Root sniffing matches Babylon.js behavior without relying on `__root__` as a
  name, and winding matches Babylon.js effective-orientation behavior for
  procedural/loaded authored baselines, promoted roots, and negative-scale
  transforms (`REQ-HAND-4`,
  `REQ-SCENE-7`).
- The returned Blob has correct GLB framing, chunk layout, and
  `model/gltf-binary` type (`REQ-GLB-1..REQ-GLB-5`, `REQ-API-5`).
- The output contains no omitted v1 constructs or extension declarations
  (`REQ-GLB-6`, `REQ-GLB-7`, `REQ-ERR-3`).

**Validation:** Direct public-seam GLB assertions and focused handedness
fixtures.

## Milestone 6 — Public integration, coded errors, re-import smoke, and tree-shaking proof

**Purpose:** Expose the completed pipeline and prove package behavior.

**Work:**

1. Re-export exactly `exportSceneGLB` from the package root.
2. Call synchronous collection first, then await asynchronous serialization.
3. Keep the public function free of options, alternate inputs, runtime nominal
   checks, disposal checks, and download behavior.
4. Route failures through existing coded thrown errors; do not add a warning
   collection or logging channel.
5. Add the single re-import smoke test and extend existing tree-shaking tests.

**Acceptance:**

- Public type and runtime tests observe exactly
  `exportSceneGLB(scene: SceneContext): Promise<Blob>` and the required MIME,
  with no overload or side effect (`REQ-API-1..REQ-API-5`).
- Public-seam tests prove no source mutation and no runtime nominal or
  disposal-flag check (`REQ-API-6`, `REQ-API-7`, `REQ-ERR-4`).
- Missing required CPU data and current non-triangle topology produce existing
  coded errors with no partial Blob; further valid-output failures remain
  possible and are not constrained to a fixed count
  (`REQ-GEOM-1`, `REQ-GEOM-2`, `REQ-ERR-1`, `REQ-ERR-2`).
- No warning value or console channel is present for v1 omissions
  (`REQ-ERR-3`, `REQ-ERR-5`).
- One re-import smoke succeeds and is documented as a smoke signal rather than
  a source-preserving round-trip promise (`REQ-TEST-3`).
- Consumers that do not call the function retain no exporter runtime bytes;
  package maps, dependencies, and core modules remain unchanged
  (`REQ-SIZE-1..REQ-SIZE-4`).

**Validation:** Focused unit/plumbing/type/tree-shaking checks and filtered
representative bundle builds. Do not run all-scene or performance commands.

## Milestone 7 — One combined numbered visual parity scene

**Purpose:** Add one visual oracle for the highest-risk conversion behavior.

**Work:**

1. Independently derive one numbered scene from Babylon.js behavior.
2. Make it asymmetric so mirrored geometry is visible.
3. Include ordinary-scale and negative-scale parents, a quaternion hierarchy,
   and content exported through a sniffed no-op conversion root.
4. Keep shared-geometry deduplication as a direct GLB byte assertion rather than
   creating a second visual fixture.
5. Generate the Babylon.js golden once. Runtime parity opens only the Lite
   scene, and no upstream source or image is copied.

**Acceptance:**

- The combined numbered scene exercises the public Blob seam and covers
  asymmetric geometry, ordinary/negative scale, quaternion hierarchy, and both
  root conversion states (`REQ-TEST-4`, `REQ-HAND-1..REQ-HAND-4`).
- Direct public-seam assertions cover shared identity deduplication and
  deterministic output (`REQ-GEOM-6`, `REQ-TEST-2`).
- The parity fixture uses an independently generated golden, changes no
  existing golden or threshold, and does not become the download demo
  (`REQ-TEST-5`, `REQ-TEST-6`, `REQ-SIZE-5`).
- Focused parity results are recorded for CI without expanding local
  validation to the full scene suite (`REQ-TEST-8`, `REQ-SIZE-6`).

**Validation:** The focused parity check is a CI/user gate; local work remains
limited to the explicitly affected non-visual checks.

## Milestone 8 — Download demo, catalog, measurement, manual gate, and PR evidence

**Purpose:** Provide the separate human-facing verification and completion
record.

**Work:**

1. Add a cataloged demo that calls the public function and downloads the
   returned Blob from lab code only.
2. Add a representative JPG thumbnail and generated demo-site entry.
3. Record raw and gzip demo bundle sizes without touching unrelated scene
   manifests.
4. Open a downloaded result in an independent external viewer and record the
   manual judgment.
5. Prepare evidence for the eventual PR: focused commands and results,
   re-import, parity, tree-shaking, bundle bytes, demo readiness, and the
   manual gate.

**Acceptance:**

- The demo calls only the public Blob seam; package code remains free of DOM
  download behavior (`REQ-API-5`, `REQ-TEST-6`, `REQ-DELIV-4`).
- Catalog, JPG thumbnail, generated site, and raw/gzip measurement are present
  with no unrelated scene-manifest churn (`REQ-TEST-6`, `REQ-DELIV-4`,
  `REQ-SIZE-5`).
- The external-viewer result is recorded explicitly as a manual judgment, not
  as proof supplied by the emitted-subset helper (`REQ-TEST-7`, `REQ-GLB-8`).
- The eventual PR evidence names actual focused checks and does not claim
  unrun checks (`REQ-DELIV-5`, `REQ-TEST-8`).
- A final audit confirms all four planning documents use the same contract,
  counts, IDs, milestone order, and links (`REQ-DELIV-6`).

**Validation:** Demo smoke, static inspection, focused measurement, and manual
viewer gate only; no all-scene or performance run.

## Completion checklist

- [ ] One feature branch contains all eight milestones; no partial milestone is
      presented as an independently releasable feature.
- [ ] The public seam and Blob/error behavior satisfy `REQ-API`,
      `REQ-GLB`, and `REQ-ERR`.
- [ ] Scene closure, CPU geometry, deduplication, and handedness-state conversion satisfy
      `REQ-SCENE`, `REQ-GEOM`, and `REQ-HAND`.
- [ ] Direct GLB assertions, one re-import smoke, one combined parity scene,
      and the separate demo/manual gate satisfy `REQ-TEST`.
- [ ] Tree-shaking, dependency, threshold, golden, and manifest constraints
      satisfy `REQ-SIZE`.
- [ ] Architecture, equivalence map, demo evidence, PR record, and
      contradiction audit satisfy `REQ-DELIV`.
