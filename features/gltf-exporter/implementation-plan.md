# Implementation Plan — glTF Exporter (v1)

**Status:** Ready to implement
**Source PRD:** [prd.md](prd.md)
**Source requirements:** [requirements.md](requirements.md) — 104 numbered requirements, acceptance matrix, 13 resolved decisions
**Governing constraints:** [GUIDANCE.md](../../GUIDANCE.md) (immutable), [AGENTS.md](../../AGENTS.md), [CONTRIBUTING.md](../../CONTRIBUTING.md), [TESTING.md](../../TESTING.md)

> This document decomposes the exporter into eight independently-grabbable slices.
> It does not replace `requirements.md`, which remains the normative, traceable
> requirement set. Every acceptance criterion below cites the REQ-\* IDs it satisfies.

---

## 0. How to use this document

Each slice is a thin vertical slice that is verifiable on its own. An agent picks up
exactly one slice, implements it against the architecture contract from Slice 0, and
validates only that slice's scope.

Slices stack because they share a serializer core:

- **Nodes land before geometry** because a mesh needs a node to hang from, not the other way round.
- **The glTF-loaded population lands after procedural** because both must be simultaneously correct in one output file.

```
Slice 0  architecture contract          ← start here, blocks everything
   └── Slice 1  public seam + GLB writer + empty export
          └── Slice 2  node hierarchy + transforms + traversal warnings
                 └── Slice 3  mesh geometry + accessors + procedural handedness
                        └── Slice 4  glTF-loaded population + flip-root removal
                               ├── Slice 5  lifetime preflight + error/warning contract
                               ├── Slice 6  BJS-vs-Lite visual parity fixtures
                               └── Slice 7  lab demo + catalog + measurement
```

Once Slice 4 lands, the final three run in parallel.

Slice 0 blocks everything because GUIDANCE §4 (documentation-driven architecture, the
One-Shot Rule) makes the architecture doc a prerequisite for code rather than a parallel
deliverable. It is also what makes the later slices independently grabbable: an agent
picking one up implements against the contract instead of re-deriving it.

### Slice index

| Slice | Blocked by | Covers |
| --- | --- | --- |
| [0 — architecture contract](#slice-0--architecture-contract) | none | REQ-DELIV-1, API-7/15, ERR-3/7, GEOM-8 carrier decoding |
| [1 — public seam, GLB writer, empty export](#slice-1--public-seam-glb-container-writer-and-empty-container-export) | 0 | REQ-API-1..4/9..12/15, GLB-1..9/11, SIZE-1/3..7/9, TEST-2/10, DELIV-4 |
| [2 — node hierarchy and transforms](#slice-2--node-hierarchy-transforms-and-traversal-warnings) | 1 | REQ-NODE-1..4/6..10, API-5/14, HAND-1/5, GLB-9, TEST-6 |
| [3 — geometry and procedural handedness](#slice-3--mesh-geometry-accessors-and-procedural-handedness-conversion) | 2 | REQ-GEOM-1..16, HAND-3/7, ERR-6, TEST-14/15 |
| [4 — glTF-loaded population](#slice-4--gltf-loaded-population-flip-root-removal-and-mixed-population-export) | 3 | REQ-HAND-1/2/4/6, NODE-5, GEOM-8/14, TEST-3/5/7 |
| [5 — lifetime and error contract](#slice-5--lifetime-preflight-and-complete-errorwarning-contract) | 4 | REQ-API-13/16/17, ERR-1..10, TEST-4/8/9 |
| [6 — visual parity fixtures](#slice-6--focused-bjs-vs-lite-visual-parity-fixtures) | 4 | REQ-TEST-16/17/18, SIZE-2/10 |
| [7 — lab demo and measurement](#slice-7--lab-demo-with-download-catalog-entry-and-bundle-measurement) | 4 | REQ-TEST-11/13, GLB-10, DELIV-2/3/6 |

---

## 1. What is being built

One experimental root export, `exportGltf(container, options?)`, taking an `AssetContainer`
and asynchronously returning a self-contained `.glb` binary plus a list of structured
lossiness warnings.

This is **export-for-interchange, not round trip**. Lite retains no source JSON, buffer
views, accessor layouts, image bytes, sampler indices, or extension objects — everything
written out is re-derived. The promise is narrow and honest: a conformant third-party
viewer renders the output with the same geometry, hierarchy, orientation, chirality, and
face visibility that Lite renders. Anything Lite can observe but v1 cannot represent is
reported as a coded warning, never silently dropped.

V1 covers `POSITION`, `NORMAL`, `TEXCOORD_0` and indices for triangle-list meshes, the
full node hierarchy including mesh-less pivots, and correct handedness for **both** mesh
populations in one file — glTF-loaded subtrees (which export by deleting Lite's synthetic
flip root, with zero per-vertex work) and procedural meshes (which need a genuine
left-to-right handed conversion with positions, normals, and winding flipped in lockstep).

**Materials are out of v1.** glTF's `materials` array is optional and a primitive with no
`material` is fully conformant, so viewers fall back to their own default. Cutting materials
removes all material type checking, so mixed Standard/PBR scenes need no special handling
and no error path.

The feature must cost **zero bytes** for every scene that does not call it.

---

## 2. Ground rules for every slice

These apply to all slices and are not repeated in each one.

- Read `GUIDANCE.md` first. It is the single source of truth and is immutable.
- Zero module-level side effects in every new module. No `register*()` calls, no `globalThis` mutation, no module-level `new Map()`/`new Set()`/`new WeakMap()`.
- No new runtime, dev, or peer dependency — not to the package, not to the workspace root. A glTF validator package is explicitly rejected; structural conformance is proven by assertions this repository owns.
- Never change a `maxRawKB` ceiling or a `maxMad` threshold, and never regenerate an existing golden reference. A bundle-size regression in a scene that does not export is a design defect to fix, not a new baseline.
- Core modules gain no exporter-specific semantics. If a core module must change on the exporter's behalf, the change is confined to a single optional-chained engine seam whose meaning lives entirely in exporter-owned code.
- Scoped validation only: focused unit and plumbing tests, the focused exporter parity specs, filtered bundle builds, demo smoke checks, lint and typecheck. Never the all-scene suite, never a full or unfiltered parity or bundle run, never `pnpm test:perf`.
- No Babylon.js source or test code is copied. Upstream is a behavioural checklist only.
- Conventional Commit messages. A breaking change needs an explicit marker in the PR title or body.

---

## 3. Known risks

- **Bundle size is the most likely way this fails, not correctness.** Ceilings span roughly 14.8 KB to 161.3 KB across 234 scenes. Verify against the smallest ceilings early rather than at the end.
- **The procedural handedness conversion is the largest single piece of v1 work**, not the GLB writing. Winding, normals, and positions all have to move in lockstep, and one export must handle two populations simultaneously.
- **Depth doubling is easy to miss and trivial to catch.** The loader attaches each mesh as a child of its source node, so without the collapse every load→export cycle adds a level. A two-cycle test catches it immediately.
- **The round-trip test is weaker than it looks.** Export → re-import passes trivially for any self-consistent error. It proves symmetry, not conformance. The structural checks and the manual external-viewer gate are what actually constrain correctness.

---

## Slice 0 — Architecture contract

**Blocked by:** nothing — can start immediately.
**Deliverable:** `docs/lite/architecture/53-gltf-exporter.md`

### What to build

The one-shot architecture document for the glTF exporter, written **before** any
implementation code. GUIDANCE §4 ("Documentation-Driven Architecture", the One-Shot Rule)
makes this a hard prerequisite rather than a nicety: the doc is the formal specification
and code is its implementation.

Work from `prd.md` and `requirements.md`. Both are complete and normative, with all 13
questions resolved. This slice turns them into the repo's own architecture contract, using
the numbered module template at the end of `GUIDANCE.md`. Doc slot 53 under
`docs/lite/architecture/` is free.

Two things the requirements deliberately left to architecture must be decided here:

1. **Non-triangle topology carrier decoding.** Procedurally created meshes and glTF-loaded meshes record topology in different places, and absence must be established across every applicable carrier before a mesh may be treated as a triangle list. Decide the exact decoding for both populations.
2. **The private neutral export representation.** `AssetContainer` is v1's only public input and is the *first adapter*, not the serializer's permanent schema. Specify the container-neutral representation it feeds, so a future adapter can feed the same GLB-writing and geometry-conversion behaviour without a rewrite.

No implementation code lands in this slice.

### Acceptance criteria

- [ ] `docs/lite/architecture/53-gltf-exporter.md` exists and follows the one-shot module template from `GUIDANCE.md` (Purpose, Public API Surface, Internal Architecture, Pipeline Configuration, Shader Logic, State Machine / Lifecycle, Babylon.js Equivalence Map, Dependencies, Test Specification, File Manifest), omitting sections that genuinely do not apply and saying so.
- [ ] Specifies the exact experimental public API with full signatures: the exported function, its options type, its result type, and its warning type. No exported type carries a method, and no exported type mentions a raw WebGPU handle (REQ-API-2, REQ-API-3).
- [ ] Declares the surface **experimental** and not semver-stable, in the same manner as the headless null engine (REQ-API-15).
- [ ] Specifies the `AssetContainer` adapter and the private container-neutral serializer representation it feeds; states that the representation is never public and that a future input adapter can feed it without changing GLB-writing or geometry-conversion behaviour (REQ-API-7).
- [ ] States why `SceneContext` and bare node arrays are excluded as v1 inputs, so the exclusion reads as a decision rather than an omission (REQ-API-8).
- [ ] Specifies the lifetime contract: the container is live references and not a snapshot; no `registerScene`, build, or rendered frame is required or triggered; the caller exports and awaits before final scene removal; preflight rejects observably disposed meshes and invents no equivalent bit for non-mesh nodes (REQ-API-13, REQ-API-16, REQ-API-17).
- [ ] Specifies the geometry, node-hierarchy, handedness, GLB-container, and error/warning contracts in enough detail to implement without re-deriving them from the requirements.
- [ ] Enumerates the complete warning-code table with stable machine-readable codes, and states the stability policy: adding a code is additive, changing an existing code's meaning is breaking (REQ-ERR-5, REQ-ERR-7).
- [ ] Enumerates exactly **four** abort conditions, notes that there is deliberately no material-related abort, and states that any further abort condition is a scope change (REQ-ERR-3).
- [ ] Decides and documents how non-triangle topology is detected on **both** carrier forms, and states that these carriers feed error detection only — the exporter never emits a non-triangle primitive mode (REQ-GEOM-8, REQ-GEOM-14).
- [ ] Contains a Babylon.js equivalence table marking each upstream exporter extension as implemented, deferred, or unrepresentable-in-Lite, so scope is reviewable rather than argued (REQ-DELIV-1).
- [ ] Documents the test strategy and the bundle/footprint strategy, including the dynamic-import boundary and the rule that no options object whose properties gate a dynamic import may be handed to an unknown callee.
- [ ] States that the structural conformance checks prove structure and internal consistency, **not** glTF 2.0 specification conformance, and that neither the doc nor any test may claim otherwise (REQ-GLB-8, REQ-TEST-2).
- [ ] States plainly, without hedging, that this is a re-derivation from live scene state rather than a round trip, and why the data model cannot honour a lossless round trip.
- [ ] Contains a complete file manifest for the feature.
- [ ] Doc-only change: no source under `packages/` is modified, so no bundle, parity, or scene validation is required.

---

## Slice 1 — Public seam, GLB container writer, and empty-container export

**Blocked by:** Slice 0.

### What to build

The walking skeleton: the single public entry point, the GLB container writer beneath it,
and the reusable structural-conformance assertion set that every later slice uses as its
correctness gate.

At the end of this slice, calling the exporter with a container that holds no exportable
entity returns a structurally valid, empty `.glb` — and a consumer who never calls it pays
zero bytes. There is deliberately no geometry and no node emission yet. The point is to
prove the two things most likely to sink the feature before any of the interesting work
depends on them: the byte-isolation story (an async entry point whose implementation modules
are all dynamic-imported, tree-shaken away entirely for every scene that does not call it)
and the container framing.

An empty container producing a valid file is a real requirement, not a degenerate
placeholder — batch pipelines must not need a special-case branch.

One of the four abort conditions belongs here: a first argument that is not an
`AssetContainer`. It establishes the coded-error pattern for the whole feature — errors
written so the build's message-extraction pass moves the text out of shipped bundles, with
interpolated runtime values passed as arguments rather than concatenated into the message.

The structural assertion set must be usable by any test that produces a `.glb`, since every
later slice asserts through it. Its documentation must state that it proves structure and
internal consistency, not specification conformance. Nothing in the tests or the docs may
over-claim.

### Acceptance criteria

- [ ] Exactly one named export is added to the package root; no package subpath export is introduced, and the `exports` map stays root-only in both source and emitted package metadata (REQ-API-1, REQ-SIZE-6).
- [ ] The public surface is a standalone async function taking the container as its first argument and an optional options object second; calling it with only the container produces a valid export; no exported type carries a method (REQ-API-2, REQ-API-4, REQ-API-10).
- [ ] No `EngineContext`, `GPUDevice`, or any raw WebGPU type appears in the signature or in any exported type (REQ-API-3).
- [ ] The result exposes the complete `.glb` as a single binary value plus a readonly warnings collection that is present and empty rather than absent when the export was lossless. No files map keyed by filename, no `Blob`, no object URL, no DOM helper of any kind (REQ-API-11, REQ-API-12, REQ-TEST-13).
- [ ] A container whose `entities` array is empty, or contains no exportable node, produces a structurally valid empty `.glb` rather than throwing (REQ-API-9).
- [ ] Output is `.glb` only, with no external URI and no sidecar file (REQ-GLB-1).
- [ ] The output begins with a 12-byte header carrying the correct magic, version `2`, and a total length equal to the exact byte length of the output (REQ-GLB-2).
- [ ] Exactly two chunks are emitted, JSON then binary, each declared length equal to its payload length, JSON space-padded and binary zero-padded to a 4-byte boundary (REQ-GLB-3, REQ-GLB-4).
- [ ] Exactly one buffer is declared, with no `uri`, whose `byteLength` matches the binary chunk payload length (REQ-GLB-5).
- [ ] `asset.version` is `"2.0"` and `asset.generator` identifies Babylon Lite and its version (REQ-GLB-6).
- [ ] Neither `extensionsUsed` nor `extensionsRequired` is declared (REQ-GLB-7).
- [ ] No `materials`, `textures`, `images`, or `samplers` array is declared — not even empty (REQ-GLB-11).
- [ ] A default scene is emitted, and no exported node is left unreachable from it (REQ-GLB-9).
- [ ] A reusable structural-conformance assertion set covers all eight checks of REQ-GLB-8 — chunk framing, padding rules, bufferView/accessor/attribute reachability, no dangling indices, index values within the referenced position accessor's count, required fields present, accessor `min`/`max` equal to the true component-wise extrema, and 4-byte alignment — applicable to any produced `.glb` and hand-rolled with no validator dependency (REQ-GLB-8, REQ-SIZE-9, REQ-TEST-2).
- [ ] The assertion set's documentation states that it proves structure and internal consistency, **not** glTF 2.0 specification conformance; no test or doc claims otherwise (REQ-GLB-8, REQ-TEST-2).
- [ ] A first argument that is not an `AssetContainer` throws a coded error identifying the first argument as the invalid subject, and the caught error decodes to the expected message (REQ-ERR-1, REQ-ERR-3, REQ-ERR-4).
- [ ] Error text is not assembled by string concatenation that defeats build-time message extraction; interpolated runtime values are passed as arguments (REQ-ERR-10).
- [ ] No `console` method is used as an error or warning channel (REQ-ERR-2).
- [ ] Public TSDoc declares the surface experimental and not semver-stable (REQ-API-15).
- [ ] Vitest unit coverage, requiring no engine and no WebGPU, for GLB chunk framing, chunk padding, and 4-byte alignment (REQ-TEST-1).
- [ ] The existing tree-shaking tests are **extended, not duplicated**, to prove the new export tree-shakes away when unreferenced; the existing side-effect tests pass unmodified (REQ-SIZE-3, REQ-SIZE-5, REQ-TEST-10).
- [ ] No module introduced by this slice executes code at import time (REQ-SIZE-5).
- [ ] The public-API/type test passes without being weakened or bypassed, and no `@internal` member appears in the emitted public `.d.ts` after the trim pass (REQ-SIZE-6, REQ-SIZE-7, REQ-DELIV-4).
- [ ] No new runtime, dev, or peer dependency is added to the package or the workspace root (REQ-SIZE-9).
- [ ] Core modules gain no exporter-specific semantics (REQ-SIZE-8).
- [ ] A filtered per-scene bundle build against the **smallest** ceilings shows zero runtime-byte growth and no chunk that a scene previously tree-shook becoming runtime-fetched. No unrelated per-scene manifest is modified, and the aggregate scene manifest is not committed (REQ-SIZE-1, REQ-SIZE-4, REQ-SIZE-11).

---

## Slice 2 — Node hierarchy, transforms, and traversal warnings

**Blocked by:** Slice 1.

### What to build

Emit the node tree. After this slice, a container of procedurally created nodes — pivots,
attachment points, named nulls, empty groups, nested children, transformed parents —
exports as a glTF node hierarchy that matches the input, right-handed and Y-up, with no
geometry involved yet.

Nodes land before geometry because a mesh needs a node to hang from, not the other way
round. This ordering also keeps the two hardest hierarchy problems isolated from vertex work.

Handedness in this slice is the **transform** side of the conversion. Lite authors
procedural content in a left-handed space, so emitted node transforms must be genuinely
converted rather than left as a negative-determinant scale for a downstream viewer to
absorb. Per-vertex position/normal/winding conversion belongs to Slice 3, and glTF-loaded
content's synthetic flip root belongs to Slice 4. Do not pre-empt either, but leave a seam
they slot into.

This slice also owns every warning produced while walking the container, because it is the
slice that walks it: invisible nodes, node metadata, excluded lights and cameras, and
dropped animation groups. Invisible nodes are exported *with* a warning rather than omitted —
omission would be unrecoverable, since the geometry would simply not exist in the file,
whereas an exported-but-warned node loses only a flag the caller can reapply.

Determinism matters more than it looks. Node, accessor, and buffer-view ordering must derive
from traversal order and never from map or set iteration over object identities, so that two
exports of the same unmodified input are byte-identical and callers can content-hash, cache,
and diff exported assets.

### Acceptance criteria

- [ ] Every `SceneNode` entry in `entities` is traversed, including entries after the first, so multi-root containers export completely (REQ-API-6).
- [ ] The full tree reachable from each entry is emitted, including nodes that carry no mesh and have no mesh descendant (REQ-NODE-1).
- [ ] Node parent/child relationships in the output match the input relationships (REQ-NODE-2).
- [ ] A node whose local transform is a TRS triple emits `translation`, `rotation`, and `scale`, omitting any component equal to its glTF default; a node whose local transform is a raw local matrix emits `matrix`; no node emits both forms (REQ-NODE-3).
- [ ] Node names are preserved, and a node with an empty name omits `name` rather than emitting an empty string (REQ-NODE-4).
- [ ] Traversal is cycle-safe and visits a node reachable by more than one path exactly once; malformed input cannot cause unbounded recursion (REQ-NODE-6).
- [ ] Node ordering is a deterministic function of input traversal order, never of map or set iteration over object identities (REQ-NODE-7, REQ-API-14).
- [ ] Two exports of the same unmodified live input are byte-identical (REQ-API-14, REQ-TEST-6).
- [ ] Every emitted node is reachable from the default scene (REQ-GLB-9).
- [ ] Emitted transforms are right-handed and Y-up per the glTF 2.0 convention (REQ-HAND-1).
- [ ] No emitted node is left with a net negative-determinant transform that has no matching winding flip (REQ-HAND-5).
- [ ] The exporter mutates nothing it is given, verified by a deep snapshot of the input taken before and compared after (REQ-API-5).
- [ ] A node marked not visible is exported with its subtree intact and raises a lossiness warning rather than being omitted (REQ-NODE-8).
- [ ] Node metadata, including loader-populated glTF extras, is not emitted and raises a lossiness warning (REQ-NODE-10).
- [ ] Non-`SceneNode` light entries, the container's single camera, and its camera list are excluded, each raising a lossiness warning; a subtree rooted beneath an excluded light is excluded with that root, and its children are not promoted and no replacement transform node is synthesized (REQ-API-6, REQ-NODE-9).
- [ ] Animation groups carried on the container are not emitted and raise a lossiness warning (REQ-ERR-6).
- [ ] Every warning carries a stable machine-readable code and the identity of the affected entity, never aborts the export, and is never written to the console (REQ-ERR-5, REQ-ERR-2).
- [ ] Vitest unit coverage, requiring no engine and no WebGPU, for TRS extraction with default omission and for the handed transform conversion (REQ-TEST-1, REQ-HAND-7).
- [ ] All emitted output still passes the reusable structural-conformance assertion set from Slice 1 (REQ-GLB-8).
- [ ] No module introduced executes code at import time, and no new dependency is added (REQ-SIZE-5, REQ-SIZE-9).
- [ ] A filtered per-scene bundle build shows zero runtime-byte growth in scenes that do not call the exporter, and no previously tree-shaken chunk becoming fetched. No unrelated per-scene manifest is modified (REQ-SIZE-1, REQ-SIZE-4, REQ-SIZE-11).

---

## Slice 3 — Mesh geometry, accessors, and procedural handedness conversion

**Blocked by:** Slice 2.

### What to build

Attach geometry to the node tree. After this slice, a scene built with `createBox` and
friends exports to a `.glb` that opens in an external viewer with the right shape, the right
orientation, and faces that are neither inside-out nor lit backwards.

Geometry comes exclusively from Lite's retained CPU mirrors. GPU readback is off the table:
vertex and index buffers are allocated without copy-source usage, and adding it would change
footprint across every scene, including the ones that never export. Each mesh becomes exactly
one glTF mesh with exactly one primitive — `Mesh` has no submesh concept, so there is never a
second primitive to emit.

No primitive carries a `material`. Materials are out of v1 entirely, a primitive with no
material is fully conformant glTF 2.0, and viewers fall back to their own default. Because
the exporter never inspects a material, there is no material type check and no material error
path; a scene mixing Standard and PBR materials needs no special handling at all. Every mesh
that *does* carry a Lite material raises the material-loss warning once, since it is the
largest single loss in v1.

This is the slice that performs the genuine left-to-right handed conversion for procedurally
authored content, which the PRD calls the largest single piece of v1 work. Positions, normals,
and triangle winding must move in lockstep so the result is self-consistent — a conversion
that flips positions but not winding produces an asset that is correctly shaped and wrongly
lit. The conversion is a pure function of vertex data and must be unit-testable with no GPU.

Two of the four abort conditions land here: a mesh whose required CPU geometry is not
retained, and a **procedurally created** mesh whose topology is known to be non-triangle. The
loaded-mesh topology carrier is Slice 4's job, and this slice must not guess at it.

### Acceptance criteria

- [ ] `POSITION`, `NORMAL`, `TEXCOORD_0`, and indices are emitted for every exported mesh (REQ-GEOM-1).
- [ ] Geometry is sourced from retained CPU mirrors only. No GPU readback is attempted, and no buffer usage flag anywhere in the engine changes (REQ-GEOM-2).
- [ ] Each mesh maps to exactly one glTF mesh containing exactly one primitive (REQ-GEOM-3).
- [ ] Every emitted accessor declares a `count`, `componentType`, and `type` consistent with the data it describes, and the position accessor additionally declares `min` and `max` equal to the true component-wise extrema (REQ-GEOM-4).
- [ ] Component types are position FLOAT/VEC3, normal FLOAT/VEC3, and texcoord FLOAT/VEC2, with an unsigned integer index component type wide enough for the mesh's vertex count so large meshes are never silently truncated (REQ-GEOM-5).
- [ ] Every accessor `byteOffset` satisfies the 4-byte alignment rule relative to the start of the binary buffer, with padding inserted as required (REQ-GEOM-6).
- [ ] Procedurally created triangle-list meshes are genuinely converted from Lite's left-handed space, with vertex positions, vertex normals, and triangle winding converted in lockstep so the result is self-consistent (REQ-HAND-3).
- [ ] The handed conversion is a pure function exercised by Vitest unit tests requiring no GPU (REQ-HAND-7, REQ-TEST-1).
- [ ] Exported vertex data is numerically equal to the retained CPU data up to the handedness transform: no quantizing, re-indexing, welding, or other re-authoring (REQ-GEOM-12).
- [ ] Meshes sharing the same underlying geometry emit that geometry once and reference it from several nodes rather than duplicating buffer data, asserted by buffer length (REQ-GEOM-11).
- [ ] A mesh from which any required geometry cannot be obtained aborts the export with a coded error naming the mesh; it is never silently skipped and no partial file is returned (REQ-GEOM-7, REQ-ERR-3, REQ-ERR-4).
- [ ] A procedurally created mesh whose topology is known to be non-triangle aborts the whole export before any partial `.glb` is returned, with a coded error naming the mesh and stating that triangle-list is the only topology supported in v1 (REQ-GEOM-8, REQ-ERR-3, REQ-TEST-14).
- [ ] A mesh with no topology marker on any applicable carrier exports as TRIANGLES with `primitive.mode` omitted or set to `4`, raising neither a warning nor an error (REQ-GEOM-14, REQ-TEST-14).
- [ ] The exporter never emits a non-triangle `primitive.mode`; topology carriers feed error detection only (REQ-GEOM-8).
- [ ] No emitted primitive carries a `material` property, including for input meshes that do carry a Lite material (REQ-GEOM-16, REQ-TEST-15).
- [ ] Tangents, second UV sets, vertex colours, joints, and weights are not emitted, and their presence raises a lossiness warning rather than being dropped silently (REQ-GEOM-9).
- [ ] A mesh carrying thin-instance, skeleton, VAT, or morph-target data exports its base geometry with a lossiness warning naming the dropped feature, and does not error (REQ-GEOM-10).
- [ ] Every mesh carrying a Lite material raises the material-loss warning exactly once (REQ-ERR-6).
- [ ] Vitest unit coverage for accessor packing, min/max computation, and alignment and padding (REQ-TEST-1).
- [ ] All emitted output passes the reusable structural-conformance assertion set, including its index-bounds and min/max checks (REQ-GLB-8).
- [ ] No module introduced executes code at import time, and no new dependency is added (REQ-SIZE-5, REQ-SIZE-9).
- [ ] A filtered per-scene bundle build shows zero runtime-byte growth in scenes that do not call the exporter, and no previously tree-shaken chunk becoming fetched. No unrelated per-scene manifest is modified (REQ-SIZE-1, REQ-SIZE-4, REQ-SIZE-11).

---

## Slice 4 — glTF-loaded population, flip-root removal, and mixed-population export

**Blocked by:** Slice 3.

### What to build

Make glTF-loaded content exportable, and make a single file containing **both** mesh
populations correct at once.

Lite hangs glTF-loaded subtrees under a synthetic flip root whose scale negation is exactly
the inverse of what glTF wants. That population exports by **removing** the flip node and
reparenting its children to the exported scene roots, with zero per-vertex work —
re-exporting a loaded asset should cost nothing per vertex. Procedurally created meshes still
take the genuine per-vertex conversion delivered by Slice 3. Both must be simultaneously
correct in one output file, so that a scene combining an imported asset with generated
geometry exports without either population being mirrored.

The loader also attaches each mesh as a *child* of its source glTF node, so Lite's graph sits
one level deeper than the source asset. That pairing must be collapsed. Without it, every
load→export cycle adds a level and node depth grows without bound across repeated cycles.
This is easy to miss and trivial to catch: a two-cycle test is the acceptance test for it.

The remaining topology carrier lands here. glTF-loaded meshes record non-triangle topology
through loader-applied primitive state rather than the numeric field procedural meshes use,
and absence must be established across *all* applicable carriers before a mesh is treated as
a triangle list — an unset procedural field alone does not make a loaded mesh topology-less.

This slice also delivers the never-added-container contract end to end: load a real `.glb`,
never register it, export it successfully.

### Acceptance criteria

- [ ] The synthetic flip root is removed rather than emitted, and its children are reparented to the exported scene roots (REQ-HAND-2).
- [ ] No per-vertex work is performed for the glTF-loaded population (REQ-HAND-2).
- [ ] No node carrying the flip root's negating scale appears anywhere in the output (REQ-HAND-2).
- [ ] Exported content is right-handed, Y-up, +Z toward the viewer, per the glTF 2.0 coordinate convention (REQ-HAND-1).
- [ ] A single export containing both glTF-loaded subtrees and procedurally created meshes orients and winds every mesh correctly in the same output file (REQ-HAND-4, REQ-TEST-7).
- [ ] No emitted mesh has a net negative-determinant world transform without a corresponding winding flip (REQ-HAND-5).
- [ ] The loader's mesh-under-node pairing is collapsed, and node depth after two successive load→export cycles equals depth after one (REQ-NODE-5, REQ-TEST-5).
- [ ] A glTF-loaded mesh whose topology is known to be non-triangle aborts the whole export with a coded error naming the mesh, returning no partial `.glb` (REQ-GEOM-8, REQ-ERR-3, REQ-TEST-14).
- [ ] Topology absence is established across every applicable carrier before a mesh is treated as a triangle list (REQ-GEOM-14).
- [ ] A Playwright plumbing test loads a real `.glb`, leaves the returned container **unregistered and never added to a scene**, exports it successfully, and asserts both the JSON shape and the reusable structural-conformance checks (REQ-API-13, REQ-TEST-3).
- [ ] Exporting a glTF-loaded asset and re-importing the result reproduces every mesh's world-space vertex positions within floating-point tolerance of the original import (REQ-HAND-6).
- [ ] The glTF loader continues to function unchanged: all existing parity specs pass at their current MAD thresholds, and no existing golden reference under `reference/lite/**` is regenerated (REQ-SIZE-10).
- [ ] Core modules gain no exporter-specific semantics. Any unavoidable core change is confined to a single optional-chained engine seam whose meaning lives entirely in exporter-owned code (REQ-SIZE-8).
- [ ] No module introduced executes code at import time, and no new dependency is added (REQ-SIZE-5, REQ-SIZE-9).
- [ ] A filtered per-scene bundle build shows zero runtime-byte growth in scenes that do not call the exporter, and no previously tree-shaken chunk becoming fetched. No unrelated per-scene manifest is modified (REQ-SIZE-1, REQ-SIZE-4, REQ-SIZE-11).
- [ ] Validation stays scoped: focused unit and plumbing tests, the loader's own focused parity specs, filtered bundle builds, lint and typecheck. No all-scene suite, no unfiltered bundle build, no perf run (REQ-TEST-12).

---

## Slice 5 — Lifetime preflight and complete error/warning contract

**Blocked by:** Slice 4.

### What to build

Close out the failure surface. The earlier slices each added the warnings and aborts they
created; this slice adds the last abort, proves the contract is exactly what it claims to be,
and locks the warning codes so callers can filter on them.

The last abort is the lifetime one. The container is a set of live references, not a snapshot,
so a caller who removes content from its final owning scene before awaiting the export is in
undefined territory. Preflight must reject any reachable mesh **observably** marked disposed,
abort before returning a partial result, and name that mesh so a lifetime mistake is loud
rather than a corrupt file.

The guard is deliberately limited to observable state. Non-mesh nodes expose no equivalent
disposed bit and none may be invented. Because final-removal teardown is deferred, the
exporter must not claim it can always detect a just-removed mesh before retirement stamps it —
the caller contract is still "export and await before final removal, and keep every reachable
entity stable until the promise settles."

The rest of this slice is proof rather than new behaviour: exactly four abort conditions and
no more, every entity error naming its entity, every lossy condition warning with a stable
code, a lossy export still being a valid `.glb`, and nothing degrading silently. No test may
assert a material-type error, because none exists.

### Acceptance criteria

- [ ] Preflight rejects any reachable mesh observably marked disposed, aborts before returning a partial result, and raises a coded error naming that mesh (REQ-API-17).
- [ ] No disposed-equivalent bit is invented or inferred for non-mesh nodes (REQ-API-17).
- [ ] All four abort conditions — missing CPU geometry, a first argument that is not an `AssetContainer`, known non-triangle topology, and an observably disposed mesh — throw before any partial result is returned, and each is covered by a test (REQ-ERR-3, REQ-TEST-8).
- [ ] No fifth abort condition exists, and no test asserts a material-type error (REQ-ERR-3, REQ-TEST-8).
- [ ] Every entity-specific error identifies the offending entity by name, or by index where unnamed, so the caller can locate it without a debugger (REQ-ERR-4).
- [ ] Errors are raised so that the build's message-extraction pass keeps the text out of shipped bundles, and a caught error decodes to the expected message (REQ-ERR-1).
- [ ] Interpolated runtime values are passed as arguments rather than concatenated into message text, verified by a bundle content check (REQ-ERR-10).
- [ ] Neither errors nor warnings use any `console` method as a channel (REQ-ERR-2).
- [ ] Every lossy condition produces its expected warning code without aborting: dropped materials, dropped attributes, thin instances, skinning, VAT, morph targets, invisible nodes, dropped lights and cameras, dropped metadata, and dropped animation groups (REQ-ERR-6, REQ-TEST-8).
- [ ] A snapshot test locks the warning-code set, so an existing code's meaning cannot change silently while adding a new code stays additive (REQ-ERR-7).
- [ ] A lossy export still produces a valid `.glb` that passes the reusable structural-conformance assertion set (REQ-ERR-8).
- [ ] A coverage audit demonstrates no silent degradation: every observable scene state not represented in the output is either an enumerated error or an enumerated warning (REQ-ERR-9).
- [ ] A round-trip test modifies a transform while the container is attached, observes that live change reflected in the export, awaits completion, removes the source from its final scene, and re-imports the output successfully (REQ-API-13, REQ-API-16, REQ-TEST-4).
- [ ] That round-trip test is documented as proving **symmetry only**, not conformance, and is explicitly not presented as the primary correctness gate — the structural checks are (REQ-TEST-4).
- [ ] No Babylon.js test code is copied; upstream suites are used only as a behavioural checklist (REQ-TEST-9).
- [ ] A filtered per-scene bundle build shows zero runtime-byte growth in scenes that do not call the exporter. No unrelated per-scene manifest is modified (REQ-SIZE-1, REQ-SIZE-4, REQ-SIZE-11).

---

## Slice 6 — Focused BJS-vs-Lite visual parity fixtures

**Blocked by:** Slice 4.

### What to build

The visual oracle for the handedness conversion.

The structural checks prove internal consistency, and the round-trip test proves only
symmetry — if the exporter and the importer share the same wrong handedness or UV convention,
the pixels match and the file is still broken in Blender. Focused BJS-vs-Lite parity fixtures
are what actually constrain the conversion, which is why they are a separate deliverable
rather than a nice-to-have.

Three behaviours need covering, each independently derived from a Babylon.js playground:
`KX53VK#88` (negative-world-matrix winding through two export/re-import cycles), `UK7FLI#1`
(varied parent/child quaternion conversion), and `KX53VK#85` (shared geometry converted once).
**The IDs are retained for traceability only.** No upstream playground source and no upstream
PNG may be copied, and their goldens are not valid expected output for v1 because they contain
materials and vertex colours the exporter does not emit.

Because v1 emits no materials, both the BJS and the Lite side must receive equivalent
**test-only** materials after re-import, so parity isolates geometry, hierarchy, and winding
rather than measuring the absence of material data. New BJS reference images are generated
through this repository's own parity harness.

Each Lite fixture must follow the same lifetime path a real caller takes: export while the
source container is live, await the export, then remove the source and re-import the output
before rendering.

### Acceptance criteria

- [ ] A fixture derived from `KX53VK#88` covers Lite-authored procedural left-handed content under both ordinary and negative-scale parents, through **two** export/re-import cycles (REQ-TEST-16).
- [ ] A fixture derived from `UK7FLI#1` covers varied parent/child quaternion hierarchies (REQ-TEST-16).
- [ ] The shared-geometry behaviour derived from `KX53VK#85` is covered, either by its own fixture or within one of the above, including a structural assertion that one shared source geometry is converted once without mutating the input, plus rendered BJS-vs-Lite parity after re-import (REQ-TEST-17).
- [ ] Every Lite fixture exports while its source container is live, awaits the export, then removes the source and re-imports the output before rendering (REQ-TEST-16).
- [ ] No Babylon.js playground source and no existing upstream PNG is copied; only the upstream *behaviours* are reused (REQ-TEST-18, REQ-TEST-9).
- [ ] Both the BJS and the Lite side receive equivalent test-only materials after re-import, so parity isolates geometry, hierarchy, and winding (REQ-TEST-18).
- [ ] New BJS reference images are generated through this repository's parity harness and follow the repository reference-image convention, living under `reference/lite/` with the standard golden filename (REQ-TEST-18, GUIDANCE §2b).
- [ ] If the fixtures are delivered as numbered parity scenes, the GUIDANCE §2 new-scene checklist is followed in full, and any new `scene-config.json` entry is purely additive (REQ-SIZE-2).
- [ ] No existing golden reference is regenerated and no existing `maxMad` or `maxRawKB` threshold is changed (REQ-SIZE-2, REQ-SIZE-10).
- [ ] These fixtures remain distinct from the lab demo page; the demo is not the visual oracle and these are not the demo (REQ-TEST-11).
- [ ] Validation stays scoped to these focused parity specs plus lint and typecheck. No all-scene suite, no full parity run, no unfiltered bundle build, no perf run (REQ-TEST-12).

---

## Slice 7 — Lab demo with download, catalog entry, and bundle measurement

**Blocked by:** Slice 4.

### What to build

The human-facing gate, plus the catalog and measurement plumbing every other demo has.

Because the structural conformance checks are deliberately a structural check and not a
specification validator, the only thing that proves the output is genuinely openable is a
person downloading a `.glb` and opening it in an independent third-party viewer. This slice
delivers the page that makes that possible, and the manual gate is a recorded judgement, not a
mechanized one.

The demo builds or loads scene content, invokes the exporter, and offers a download button.
All download and DOM behaviour lives in **lab code only**: no `Blob`, object URL, anchor
click, or other DOM API introduced by this feature may appear under the package source, and
the exporter result stays DOM-free so the package remains usable outside a browser main thread.

It is explicitly **not** a numbered parity scene. It gets no MAD threshold and no
`scene-config.json` entry, and it is not the visual oracle — the focused parity fixtures are.
Its catalog registration, thumbnail, and demo bundle measurement follow the same pattern as
the existing demos.

### Acceptance criteria

- [ ] A lab demo page builds or loads scene content, invokes the exporter, and offers a working download button that yields a `.glb` (REQ-TEST-11).
- [ ] All download and DOM behaviour lives in lab code. No `Blob`, object URL, anchor click, or other DOM API introduced by this feature appears under `packages/babylon-lite/src/`, verifiable by inspecting the package source and its emitted `.d.ts` (REQ-TEST-13, REQ-API-11).
- [ ] The demo is registered in `demos-config.json` with a slug, name, description, and tags matching the shape of the existing entries (REQ-DELIV-2).
- [ ] A representative JPG thumbnail is committed at `lab/public/thumbnails/demo-gltf-exporter.jpg` at exactly 1280×720, cover-cropped, following the thumbnail convention. No PNG is committed to that directory (REQ-DELIV-2, GUIDANCE §2b″).
- [ ] The demo is present in the generated demo site (REQ-DELIV-2).
- [ ] The demo's fetched JavaScript raw and gzip sizes are measured and recorded in `lab/public/bundle/demos-manifest.json` (REQ-DELIV-3).
- [ ] The demo manifest is the only manifest that changes. No unrelated per-scene manifest moves, and the generated aggregate scene manifest is not committed (REQ-DELIV-6, REQ-SIZE-11).
- [ ] The demo receives no `maxMad` or `maxRegionMad` threshold and no `scene-config.json` entry, and is not used as the visual oracle fixture (REQ-TEST-11).
- [ ] No new third-party asset is required. If one is added, its provenance and licence are documented and the asset is local and reproducible (REQ-DELIV-3).
- [ ] The manual gate is performed and its result recorded: a `.glb` downloaded from this page opens without modification in at least one independent third-party viewer, reported explicitly as a judgement gate rather than a mechanized check (REQ-GLB-10).
- [ ] Validation stays scoped: demo smoke check, lint, typecheck, and filtered bundle work only. No all-scene suite, no unfiltered bundle build, no perf run (REQ-TEST-12).
