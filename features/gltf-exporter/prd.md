# PRD — glTF Exporter (v1)

**Status:** Ready for implementation planning
**Source goals:** [goals.md](goals.md) · [goals-review.md](goals-review.md)
**Source requirements:** [requirements.md](requirements.md) — 104 numbered requirements, acceptance matrix, 13 resolved decisions
**Governing constraints:** [GUIDANCE.md](../../GUIDANCE.md) (immutable), [AGENTS.md](../../AGENTS.md), [CONTRIBUTING.md](../../CONTRIBUTING.md), [TESTING.md](../../TESTING.md)

> This document is the user-facing framing of the exporter work. It does not replace
> `requirements.md`, which remains the normative, traceable requirement set.

---

## Test seams

One production seam: the single public `exportGltf(container, options)` root export. Every
assertion — geometry, hierarchy, handedness, GLB framing, errors, warnings — is made against its
returned bytes and returned warnings, never against an internal builder or the private neutral
model. Existing test-side seams are reused for everything else: the vitest unit project, the
Playwright plumbing directory, the rollup/webpack tree-shaking build tests, the public-API/type
test, the parity harness, and the per-scene bundle manifests. No new core-module seam is proposed.

---

## Problem Statement

Babylon Lite can **read** glTF but cannot **write** it. A developer who loads a `.glb`, or builds
geometry procedurally with `createBox` and friends, has no supported way to get that content back
out of the engine. Today the only escape hatches are to keep a copy of the original file
(impossible for procedural content, and useless once the scene has been transformed) or to
hand-roll a serializer against `@internal` mesh fields.

This blocks the ordinary interchange workflows people expect from a 3D engine: hand an asset to a
colleague, open it in Blender or an online viewer, feed it to a geometry pipeline, or capture a
Lite-authored scene as a portable artifact. The gap is especially visible because the loader is
mature — the asymmetry reads as a missing feature, not a deliberate boundary.

The complication is that Lite retains almost nothing of the source asset. There is no source JSON,
no buffer views, no accessor layouts, no image bytes, no sampler indices, no extension objects.
Anything written out must be **re-derived from live scene state**, and the naive expectation of a
lossless round trip is not something the data model can honour.

## Solution

A single experimental root export, `exportGltf(container, options)`, that takes an
`AssetContainer` and asynchronously returns a self-contained `.glb` binary plus a list of
structured lossiness warnings.

This is framed explicitly as **export-for-interchange**, not round trip. The promise is narrow and
honest: a conformant third-party viewer renders the output with the same geometry, hierarchy,
orientation, chirality, and face visibility that Lite renders. Anything Lite can observe but v1
cannot represent is reported as a coded warning on the result — never silently dropped.

V1 covers `POSITION`, `NORMAL`, `TEXCOORD_0`, and indices for triangle-list meshes, the full node
hierarchy including mesh-less pivots, and correct handedness for **both** mesh populations in one
file — glTF-loaded subtrees (which export by deleting Lite's synthetic `__root__` flip node, with
zero per-vertex work) and procedural meshes (which need a genuine left-to-right handed conversion
with positions, normals, and winding flipped in lockstep).

Materials are out of v1 entirely. glTF's `materials` array is optional and a primitive with no
`material` is fully conformant, so viewers fall back to their own default grey. Cutting materials
removes all material type checking, so mixed Standard/PBR scenes need no special handling and no
error path — and it moots the pre-multiplied-emissive and ORM-packing problems completely.

The feature must cost **zero bytes** for every scene that does not call it.

## User Stories

1. As a Lite application developer, I want a single function that turns an `AssetContainer` into `.glb` bytes, so that I can get scene content out of the engine without reverse-engineering internal fields.
2. As a Lite application developer, I want that function reachable from the one `@babylonjs/lite` package root, so that I do not have to learn a subpath import convention.
3. As a Lite application developer, I want the export to be a standalone function taking the container as its first argument, so that it matches every other Lite API I already use.
4. As a Lite application developer, I want the export to return a Promise, so that the implementation can be dynamic-imported and I never pay for it until I call it.
5. As a Lite application developer, I want to call the exporter with no options at all, so that the simple case stays a one-liner.
6. As a Lite application developer, I want the exporter to require no `EngineContext` or GPU handle, so that I can call it from code that has no rendering concerns.
7. As a Lite application developer, I want the result to be one binary value, so that saving it is a single write with no filename map to interpret.
8. As a Lite application developer, I want no `Blob`, object URL, or download helper in the result type, so that the package stays DOM-free and usable outside a browser main thread.
9. As a Lite application developer, I want the exporter to leave my scene completely untouched, so that I can export mid-session without perturbing what is on screen.
10. As a Lite application developer, I want to export a container that was just loaded and never registered or rendered, so that I can build headless asset pipelines.
11. As a Lite application developer, I want the exporter to read live state at call time, so that transforms I changed a moment ago appear in the output without a rebuild or a frame.
12. As a Lite application developer, I want a clear rule that I export before final scene removal and keep the container stable until the promise settles, so that I do not hit undefined behaviour.
13. As a Lite application developer, I want a named error when I export a mesh that has already been disposed, so that a lifetime mistake is loud rather than a corrupt file.
14. As a Lite application developer, I want two exports of the same unmodified input to be byte-identical, so that I can content-hash, cache, and diff exported assets.
15. As a Lite application developer, I want the v1 surface clearly marked experimental, so that I can judge how much to build on it before it stabilises.
16. As a Lite application developer, I want an empty or non-exportable container to still yield a valid empty `.glb`, so that batch pipelines do not need a special-case branch.
17. As a Lite application developer, I want every `SceneNode` entry in `entities` traversed, not just the first, so that multi-root containers export completely.
18. As a Lite application developer, I want my mesh's positions, normals, UVs, and indices written out faithfully, so that the exported shape is the shape I saw.
19. As a Lite application developer, I want geometry read from Lite's CPU mirrors with no GPU readback, so that export never forces a footprint change on scenes that do not export.
20. As a Lite application developer, I want each mesh to become exactly one glTF mesh with one primitive, so that the output structure is predictable.
21. As a Lite application developer, I want correct `min`/`max` on the position accessor, so that viewers frame and cull my asset properly on open.
22. As a Lite application developer, I want an index component type wide enough for my vertex count, so that large meshes are not silently truncated.
23. As a Lite application developer, I want all accessor offsets 4-byte aligned with correct padding, so that strict parsers accept the file.
24. As a Lite application developer, I want a named error when a mesh's required CPU geometry is missing, so that I never receive a file that quietly omits a mesh.
25. As a Lite application developer, I want a named error when a mesh uses non-triangle topology, so that I am not handed a file where lines or points were guessed into triangles.
26. As a Lite application developer, I want that topology check to cover both procedural meshes and glTF-loaded meshes, so that the guarantee holds regardless of how the mesh got there.
27. As a Lite application developer, I want an ordinary triangle mesh with no topology marker to export cleanly with no warning, so that the common case is not noisy.
28. As a Lite application developer, I want a warning when tangents, second UVs, or vertex colours are dropped, so that I know what the file lost.
29. As a Lite application developer, I want a mesh with thin instances, a skeleton, VAT, or morph targets to export its base geometry with a warning rather than fail, so that partial usefulness beats an abort.
30. As a Lite application developer, I want shared geometry written once and referenced from several nodes, so that repeated props do not multiply my file size.
31. As a Lite application developer, I want vertex data preserved exactly apart from the handedness transform, so that no quantizing, welding, or re-indexing changes my asset behind my back.
32. As a Lite application developer, I want the full node tree exported including mesh-less pivots and empty groups, so that attachment points and rig structure survive.
33. As a Lite application developer, I want parent/child relationships preserved, so that the exported hierarchy is the hierarchy I built.
34. As a Lite application developer, I want TRS emitted as `translation`/`rotation`/`scale` with default components omitted, so that the JSON stays small and readable.
35. As a Lite application developer, I want nodes whose transform is a raw local matrix emitted as `matrix`, so that matrix-declared glTF nodes are not lossily decomposed.
36. As a Lite application developer, I want node names preserved and empty names omitted, so that I can find my objects by name in another tool.
37. As a Lite application developer, I want the loader's mesh-under-node pairing collapsed, so that repeated load→export cycles do not keep deepening my hierarchy.
38. As a Lite application developer, I want traversal to be cycle-safe and visit shared nodes once, so that malformed input cannot hang the export.
39. As a Lite application developer, I want deterministic node ordering derived from traversal, so that output diffs are meaningful.
40. As a Lite application developer, I want invisible nodes exported with a warning rather than omitted, so that I lose only a flag I can reapply, not the geometry itself.
41. As a Lite application developer, I want lights and cameras excluded with a warning, so that their absence is a recorded decision rather than a mystery.
42. As a Lite application developer, I want node metadata and glTF extras excluded with a warning, so that the "no extensions, no extras" line is visible rather than assumed.
43. As a Lite application developer, I want output that is right-handed and Y-up per the glTF convention, so that it opens correctly in any conformant viewer.
44. As a Lite application developer, I want glTF-loaded subtrees handled by removing Lite's synthetic flip root, so that re-exporting a loaded asset costs no per-vertex work.
45. As a Lite application developer, I want procedural meshes genuinely converted from Lite's left-handed space, so that a `createBox` scene is not mirrored in Blender.
46. As a Lite application developer, I want positions, normals, and winding converted in lockstep, so that faces are not inside-out or lit backwards.
47. As a Lite application developer, I want a scene mixing loaded and procedural meshes to export correctly in one file, so that I can combine imported assets with generated geometry.
48. As a Lite application developer, I want no emitted node left with an unmatched negative-determinant transform, so that backface culling behaves in downstream tools.
49. As a Lite application developer, I want exporting and re-importing to reproduce world-space vertex positions within float tolerance, so that I can trust the transform chain.
50. As a Lite application developer, I want `.glb` with no external URIs, so that the asset is a single portable file.
51. As a Lite application developer, I want a correct GLB header and exactly two correctly typed, correctly padded chunks, so that strict loaders accept the file.
52. As a Lite application developer, I want one buffer with no `uri` whose declared length matches the binary chunk, so that the file is internally consistent.
53. As a Lite application developer, I want `asset.version` `"2.0"` and a generator string naming Babylon Lite and its version, so that I can trace where a file came from.
54. As a Lite application developer, I want no `extensionsUsed`/`extensionsRequired` declared, so that no viewer refuses the file over an extension v1 never emits.
55. As a Lite application developer, I want every node reachable from the default scene, so that nothing I exported is invisible on open.
56. As a Lite application developer, I want no `materials`, `textures`, `images`, or `samplers` arrays at all, so that the material-free contract is unambiguous rather than half-declared.
57. As a Lite application developer, I want a warning once per mesh that carried a Lite material, so that the single largest v1 loss is explicit.
58. As a Lite application developer, I want failures thrown as decodable coded errors, so that production bundles stay small and I can still recover the message with `enableErrorDecoding`.
59. As a Lite application developer, I want exactly four abort conditions and no more, so that I can reason about when export fails.
60. As a Lite application developer, I want every entity-specific error to name the offending entity, so that I can find it without a debugger.
61. As a Lite application developer, I want lossiness as structured warnings with stable machine-readable codes, so that I can filter and act on them programmatically.
62. As a Lite application developer, I want the warnings collection always present and empty when lossless, so that I never have to null-check it.
63. As a Lite application developer, I want warnings never written to the console, so that my logs stay mine.
64. As a Lite application developer, I want a lossy export to still be a valid `.glb`, so that a warning never costs me a usable file.
65. As a Lite application developer, I want nothing to degrade silently, so that anything unrepresented is either an error or a warning.
66. As a Lite consumer who never exports, I want zero added bytes in my bundle, so that a feature I do not use is genuinely free.
67. As a Lite consumer who never exports, I want no chunk I previously tree-shook to become fetched, so that the deoptimization hazard does not reach me indirectly.
68. As a Lite consumer, I want importing the package barrel to pull in no exporter code, so that tree-shaking works as advertised.
69. As a Lite consumer, I want the exporter to add no runtime, dev, or peer dependency, so that my supply chain does not grow.
70. As a Lite consumer, I want the root-only package export map preserved, so that my import paths do not change.
71. As a Lite consumer, I want no `@internal` member leaking into the public `.d.ts`, so that my editor shows a clean type.
72. As a Lite maintainer, I want core modules to gain no exporter-specific semantics, so that the exporter's cost stays at the exporter.
73. As a Lite maintainer, I want no `maxRawKB` ceiling or `maxMad` threshold changed for this feature, so that a regression is treated as a design defect, not a new baseline.
74. As a Lite maintainer, I want unrelated per-scene bundle manifests untouched, so that the diff shows real movement rather than churn.
75. As a Lite maintainer, I want the loader and all existing parity specs unaffected, so that adding write support cannot break read support.
76. As a Lite maintainer, I want no existing golden reference regenerated, so that the visual ground truth stays immutable.
77. As a Lite maintainer, I want zero module-level side effects in every new module, so that the existing tree-shaking proofs keep passing unmodified.
78. As a Lite maintainer, I want `AssetContainer` to be the first adapter into a private neutral model rather than the serializer's permanent schema, so that a `SceneContext` or node-array adapter can be added later without a rewrite.
79. As a Lite maintainer, I want no Babylon.js code or test code copied, so that we stay on the right side of the "understand, then write the minimum" pillar.
80. As a Lite maintainer, I want a numbered architecture doc complete enough to regenerate the implementation, so that the one-shot documentation rule holds.
81. As a Lite maintainer, I want a Babylon.js equivalence table marking each upstream extension implemented, deferred, or unrepresentable-in-Lite, so that scope is reviewable rather than argued.
82. As a reviewer, I want handedness conversion unit-testable with no GPU, so that the riskiest maths is verified fast and deterministically.
83. As a reviewer, I want a reusable structural conformance assertion set, so that any test producing a `.glb` can check it the same way.
84. As a reviewer, I want the structural check documented as proving internal consistency and not full spec conformance, so that nobody over-claims.
85. As a reviewer, I want the round-trip test documented as proving symmetry only, so that it is not mistaken for the primary correctness gate.
86. As an evaluator, I want a lab demo page with an export and download button, so that I can open a real output in an external viewer myself.
87. As an evaluator, I want that demo registered in the demo catalog with a thumbnail, so that it is discoverable alongside the other demos.
88. As an evaluator, I want the demo's fetched raw and gzip bytes recorded in the demo manifest, so that its footprint is tracked like every other demo.
89. As an evaluator, I want the demo's download and DOM code confined to lab code, so that the package itself stays DOM-free.
90. As a future contributor, I want the extension shape right even though v1 ships none, so that adding materials or `KHR_*` support later does not require restructuring the core.
91. As a future contributor, I want the result type free of a multi-file map, so that adding `.gltf` + `.bin` later is additive rather than breaking.
92. As a future contributor, I want camera support explicitly deferred rather than blocked, so that I know it is the cheapest next addition.

## Implementation Decisions

**Placement and surface.** The exporter lives inside `packages/babylon-lite`, re-exported by name
from the package's single root entry. No subpath export is added. The public surface is one
standalone async function taking the `AssetContainer` first and an optional options object second;
no exported type carries a method, and no exported type mentions a raw WebGPU handle. The surface
is declared experimental in both TSDoc and the architecture doc, in the same manner as the
headless null engine.

**Dynamic import and byte isolation.** The entry point is async specifically so every
implementation module beneath it can be dynamic-imported. Nothing the exporter adds may execute at
import time. Following the measured `bgOptions` precedent, no options object whose properties gate
a dynamic import may be handed to an unknown callee — pre-computed scalars are passed instead. If a
core module must ever change on the exporter's behalf, the change is confined to a single
optional-chained engine seam whose meaning lives entirely in exporter-owned code.

**Input adapter vs. serializer core.** `AssetContainer` is the only v1 public input and is treated
as the _first adapter_, not the data model. It feeds a private, container-neutral export
representation that the GLB writer and geometry converter consume. That representation is never
exposed publicly. `SceneContext` and bare node arrays are deliberately excluded: `SceneContext`
keeps flat `meshes`/`lights` arrays with no root registry and never registers a bare
`TransformNode`, so scene-based traversal would silently drop pivots and empty groups.

**Lifetime model.** The container is a set of live references, not a snapshot. Export reads current
transforms and CPU geometry with no registration, build, or rendered frame required. Callers must
export and await before final scene removal, and must not mutate or dispose reachable entities
while the promise is pending. Preflight rejects any reachable mesh observably marked disposed,
aborting before any partial result; non-mesh nodes carry no equivalent bit and none is invented.

**Geometry source.** Geometry comes exclusively from Lite's retained CPU mirrors. GPU readback is
off the table — vertex and index buffers are allocated without copy-source usage, and adding it
would change footprint across every scene. Each mesh maps to one glTF mesh with one primitive.
Shared underlying geometry is emitted once and referenced from multiple nodes. Data is written
through unchanged apart from the handedness transform: no quantizing, re-indexing, or welding.

**Handedness.** Two populations, discriminated by the authored-sign marker the loader stamps.
glTF-loaded subtrees hang under a synthetic scale-negating root that is exactly the inverse of what
glTF wants — those export by **removing that node** and reparenting its children, with zero
per-vertex work. Procedural meshes have no such root and get a genuine left-to-right conversion
with positions, normals, and winding flipped together. Both populations must be correct in a single
output file, and no emitted node may keep a net negative-determinant transform without a matching
winding flip.

**Hierarchy.** The full tree from every `SceneNode` entry is emitted, including mesh-less nodes. The
loader's mesh-under-node pairing is collapsed so node depth is stable across repeated load→export
cycles. TRS is emitted with default components omitted; nodes whose transform is a raw local matrix
emit `matrix` instead — never both on one node. Traversal is cycle-safe, visits shared nodes once,
and produces deterministic ordering derived from traversal, never from map or set iteration over
object identities. Two exports of the same unmodified input are byte-identical.

**Materials.** None. No primitive carries a `material`, and the JSON declares no `materials`,
`textures`, `images`, or `samplers` array — not even empty. Because the exporter never inspects a
material, there is no material type check and no material error path; mixed Standard/PBR scenes
need no handling at all. Every mesh carrying a Lite material raises the material-loss warning once.

**Container format.** `.glb` only: correct 12-byte header, exactly two chunks in JSON-then-binary
order, each chunk length matching its payload with JSON space-padded and binary zero-padded to
4 bytes, one buffer with no `uri`, `asset.version` `"2.0"` plus a Babylon Lite generator string, and
no extension declarations. No multi-file result shape enters the v1 public API, so adding `.gltf` +
`.bin` later stays additive.

**Errors and warnings.** Exactly four abort conditions: missing CPU geometry, a first argument that
is not an `AssetContainer`, known non-triangle topology, and an observably disposed mesh. Everything
else that cannot be represented becomes a structured warning on the result with a stable
machine-readable code and the affected entity's identity. Errors are thrown as plain `Error`s so the
build's message-extraction pass keeps text out of shipped bundles and `decodeError` still works;
interpolated values are passed as arguments rather than concatenated. Neither errors nor warnings
use the console. Warnings never abort, and never degrade output validity. Adding a warning code is
additive; changing an existing code's meaning is breaking.

**Non-triangle detection.** Both carrier forms are checked — the numeric topology field procedural
meshes set, and the loader-applied primitive state glTF-loaded meshes carry. Absence across all
applicable carriers means triangle list. The exporter never emits a non-triangle primitive mode;
these carriers feed error detection only.

**No new dependencies.** Nothing is added to the package or workspace `package.json`. A glTF
validator package is explicitly rejected; structural conformance is proven by assertions this
repository owns.

## Testing Decisions

**What makes a good test here.** Tests assert external behaviour observed through the one public
seam: the returned bytes and the returned warnings. No test reaches into an internal builder, a
private neutral-model shape, or a module boundary. Concretely, a test parses the emitted GLB and
asserts on its JSON and binary layout rather than on how the exporter computed them, which keeps the
internals free to be restructured.

**Seams.** One production seam — the public export function. All test-side infrastructure reuses
existing seams: the vitest unit project, the Playwright plumbing directory, the existing rollup and
webpack tree-shaking build tests, the public-API/type test, the parity harness, and the per-scene
bundle manifests.

**Unit level (vitest, no engine, no WebGPU).** Accessor packing, min/max computation, TRS extraction
with default omission, 4-byte alignment and padding, GLB chunk framing, and left-to-right handed
conversion. Also: input-shape rejection, options-optional, warnings-always-present,
no-mutation-of-input via a deep snapshot before and after, cycle-safe traversal, deterministic
ordering, byte-identical repeat export, absence of all material constructs, and the four abort
conditions each naming their entity and returning no partial result. Prior art: the existing
`tests/lite/unit` suite generally, and `decode-error.test.ts` for asserting a coded error decodes to
the expected message.

**Structural conformance.** A reusable, Node-hosted assertion set applied to any produced `.glb`,
covering chunk framing, padding rules, buffer/bufferView/accessor reachability, absence of dangling
indices, index values within the referenced position accessor's count, required fields, min/max
equal to the true component-wise extrema, and byte alignment. Its documentation must state plainly
that it proves structure and internal consistency, **not** glTF 2.0 specification conformance — and
neither the tests nor the docs may claim otherwise. This is the primary correctness gate.

**Plumbing (Playwright).** Load a real `.glb`, leave the container unregistered, export it, and
assert both JSON shape and the structural checks — this is the explicit never-added-container
contract. Plus: node-depth stability across two successive load→export cycles; a mixed
loaded-plus-procedural export; a round-trip case that modifies a transform while attached, observes
the live change in the export, awaits completion, removes the source from its final scene, and
re-imports successfully; and world-space vertex positions reproduced within float tolerance. Prior
art: `dispose.spec.ts` and `material-swap.spec.ts` for lifecycle-style browser tests.

**Topology coverage.** One procedural non-triangle mesh and one glTF-loaded non-triangle mesh each
produce the coded error, name the mesh, and yield no partial output; an ordinary triangle mesh with
no marker succeeds with no topology warning.

**Visual parity.** Focused BJS-vs-Lite fixtures independently derived from the behaviours
demonstrated by playgrounds `KX53VK#88` (negative-world-matrix winding through two export/re-import
cycles), `KX53VK#85` (shared geometry converted once), and `UK7FLI#1` (varied parent/child
quaternion conversion). The IDs are retained for traceability only — no upstream source and no
upstream PNG is copied, and their goldens are not valid expected output because they contain
materials and vertex colours v1 does not emit. Both sides receive equivalent **test-only** materials
after re-import so parity isolates geometry, hierarchy, and winding, and new BJS references are
generated through this repository's own parity harness.

**Build and footprint.** The existing tree-shaking tests are **extended**, not duplicated, to prove
the exporter export tree-shakes away. The public-API/type test continues to enforce the root-only
export map unmodified. Bundle verification uses filtered per-scene builds against the smallest
ceilings first, with manifest diffs proving no unrelated scene moved.

**Agent guardrails.** Validation stays scoped: focused unit and plumbing tests, the focused exporter
parity specs, filtered bundle builds, demo smoke checks, and lint/typecheck. No all-scene suite, no
unfiltered bundle build, no perf run.

**Manual gate.** Opening the output in an independent third-party viewer via the lab demo's download
button is a recorded judgement gate, not a mechanized one — necessary because the structural check
is deliberately not a spec validator.

## Out of Scope

Materials of any kind, textures, images, and samplers — warned, never emitted, arrays never
declared. All `KHR_*` and `EXT_*` extensions. Animations and animation groups — warned. Skinning,
joints, and weights — never CPU-retained by Lite. Morph targets, thin-instance expansion, and
VAT — base geometry only, warned. Cameras — warned and excluded, and identified as the cheapest next
addition, deferred rather than blocked. Lights and any subtree rooted beneath a light entry — warned
and excluded, with no child promotion. Tangents, second UV sets, and vertex colours — warned. All
non-triangle topologies — rejected with a named coded error rather than guessed. `.gltf` + `.bin`
output, USDZ, BVH, `.babylon` serialization, and Draco compression. GPU readback of geometry or
textures. `SceneContext` or node-array input adapters. Any DOM download, `Blob`, or multi-file
result in the package. Node metadata and glTF extras. `@babylonjs/lite-gl` support — it has no scene
graph, no PBR, and no glTF loader to invert. A glTF validator dependency. Making the lab demo a
numbered parity scene with a MAD threshold or scene-config entry.

## Further Notes

**This is a re-derivation, not a round trip,** and the docs must say so without hedging. Lite retains
no source JSON, buffer views, accessor layouts, image bytes, sampler indices, or extension objects.
Presenting the feature as a round trip would set an expectation the data model cannot meet.

**The largest single piece of v1 work is the procedural handedness conversion,** not the GLB writing.
Upstream carries dozens of handedness references for good reason: winding, normals, and tangent
handedness all have to move in lockstep, and Lite additionally holds two populations that a single
export must handle simultaneously.

**The most likely way this feature fails is bundle size, not correctness.** The ceilings span
roughly 14.8 KB to 161.3 KB across 234 scenes. Verify against the smallest ceilings early rather
than at the end; a regression in a scene that does not export is a design defect to fix, never a
ceiling to raise.

**Depth doubling is easy to miss and trivial to catch.** The loader attaches each mesh as a child of
its source node, so Lite's graph is one level deeper than the source asset. Without the collapse,
every load→export cycle adds a level — a two-cycle test catches it immediately.

**The round-trip test is weaker than it looks.** Export → re-import → compare passes trivially for
any self-consistent error: if the exporter and importer share the same wrong handedness or UV
convention, the pixels match and the file is still broken in Blender. It proves symmetry, not
conformance. The structural checks and the manual external-viewer gate are what actually constrain
correctness.

**Prior art for a complete feature landing** is PR #534 (screen-space effects): root API and type
exports, focused tests, a full architecture contract, an interactive demo with a catalog entry and
thumbnail, demo bundle measurement, a zero-byte proof for unrelated scenes, scoped quality commands,
and a PR body recording concrete validation. Its 124 per-scene manifest edits were mostly
shared-chunk hash churn and are explicitly **not** a checklist item to reproduce.

**Doc slot 53 is free** under `docs/lite/architecture/`, though note that directory already contains
duplicate numbers elsewhere. `TESTING.md`'s scene counts are stale — do not trust them.

**Full requirement traceability** — 104 numbered requirements with an acceptance matrix and 13
resolved decisions — already exists in [requirements.md](requirements.md), alongside
[goals.md](goals.md) and [goals-review.md](goals-review.md). This spec is the user-facing framing of
that work, not a replacement for it.
