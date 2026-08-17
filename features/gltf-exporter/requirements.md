# Requirements — glTF Exporter (v1)

**Status:** Approved for implementation planning — 63 requirements

**Source goals:** [goals.md](goals.md); **Source PRD:** [prd.md](prd.md)
**Governing constraints:** [GUIDANCE.md](../../GUIDANCE.md)

This document is normative. Requirement language uses **MUST**, **MUST NOT**,
**SHOULD**, and **MAY**. V1 re-derives a GLB from current Lite scene state and
does not promise source-preserving round trips today. That is a current scope
boundary, not a permanent claim about future exporters.

## 0. Terms and v1 boundary

- **Selected node:** a live node in the ancestor closure of `scene.meshes`.
- **Included node:** a selected node that remains after the
  coordinate-conversion-root normalization in `REQ-SCENE-7`.
- **Base geometry:** retained CPU positions, normals, indices, and optional UVs
  before skeleton, morph, VAT, or thin-instance evaluation.
- **Emitted subset:** the GLB structures that v1 actually writes. Structural
  tests cover this subset; they do not claim full glTF specification
  conformance.
- **Coded error:** the existing Lite thrown-error convention, including its
  message extraction and decoding behavior.

## 1. Public API (`REQ-API`)

- **REQ-API-1** — The sole v1 public function MUST have exactly this contract:
  `export function exportSceneGLB(scene: SceneContext): Promise<Blob>;`.
- **REQ-API-2** — The function MUST be a standalone named export from the
  package root. No public type introduced by the feature MAY carry an exporter
  method, and no package subpath export MAY be added.
- **REQ-API-3** — V1 MUST accept `SceneContext` only. It MUST NOT expose an
  alternate container input, node-array input, union overload, convenience
  overload, or options argument. The public name MUST remain
  version-agnostic and MUST NOT carry an exporter-specific experimental label.
- **REQ-API-4** — The function MUST require no engine, device, or raw WebGPU
  handle. It MUST perform no runtime nominal or shape check of the TypeScript
  `SceneContext` argument.
- **REQ-API-5** — The fulfilled value MUST be a `Blob` whose MIME type is
  exactly `model/gltf-binary`. The package function MUST NOT trigger a
  download, create an object URL, or expose a download helper.
- **REQ-API-6** — The exporter MUST not mutate, dispose, or attach exporter
  state to the source scene, nodes, meshes, or CPU arrays. Referenced large
  CPU arrays MUST remain unmodified until the returned promise settles.
- **REQ-API-7** — Production MUST collect synchronously with the private
  `collectSceneForGltf(scene): CollectedGltfScene` phase, then serialize
  asynchronously with the private `serializeGlb(collected): Promise<Blob>`
  phase. `CollectedGltfScene` MUST be purpose-built and private.
- **REQ-API-8** — V1 MUST use ordinary static imports and MUST NOT add dynamic
  imports or GPU readback to implement export.

## 2. Scene selection and hierarchy (`REQ-SCENE`)

- **REQ-SCENE-1** — The selected graph MUST be exactly the ancestor closure of
  `scene.meshes`: every scene mesh is a seed, and every live ancestor needed to
  place a seed mesh is selected.
- **REQ-SCENE-2** — Every included live node MUST be emitted exactly once.
  Transform-only ancestors MUST be retained except for the root normalization
  in `REQ-SCENE-7`; parent/child relationships and non-empty names MUST
  otherwise be preserved.
- **REQ-SCENE-3** — Nodes unrelated to an exported mesh MUST be omitted,
  including empty or unindexed nodes. V1 exports the scene's mesh graph, not
  every unattached object ever created.
- **REQ-SCENE-4** — Node and reference ordering MUST be deterministic from the
  ordered scene graph and `scene.meshes`; it MUST NOT depend on object-identity
  map or set iteration. Every emitted node MUST be reachable from the default
  scene.
- **REQ-SCENE-5** — Visibility and metadata MUST NOT change selection or
  emitted geometry, and MUST NOT produce warnings. Metadata is not serialized.
- **REQ-SCENE-6** — V1 MAY assume a well-formed tree or forest. Malformed
  parent/child graphs have undefined behavior; v1 does not repair them or add a
  general graph-validation policy.
- **REQ-SCENE-7** — Loader-created mesh-under-node wrappers MUST remain
  ordinary included nodes. A selected graph root MUST instead be removed and
  its children promoted when it satisfies the Babylon.js exporter-equivalent
  no-op coordinate-conversion-root test: it is transform-only, carries no mesh
  geometry, and its effective root transform is the Lite LH-to-glTF-RH
  conversion matrix within the architecture contract's numeric tolerance.
  Recognition MUST be structural and mathematical, not name-based.
- **REQ-SCENE-8** — Collection MUST read the current live node transforms and
  graph state synchronously. No registration, build, rendered frame, or prior
  scene ownership MAY be required.

## 3. Geometry (`REQ-GEOM`)

- **REQ-GEOM-1** — Each exported mesh MUST use retained CPU base positions,
  normals, and indices. UVs are optional: `TEXCOORD_0` MUST be emitted only
  when UVs exist. Missing required CPU data MUST fail with a coded error.
- **REQ-GEOM-2** — The exporter MUST use the mesh's current live topology.
  Triangle lists are the only supported topology. A mesh currently marked as
  non-triangle MUST be rejected with a coded error; the exporter MUST NOT
  recover topology discarded by the loader.
- **REQ-GEOM-3** — Lite mesh data is assumed internally valid. V1 MUST NOT add
  a general runtime audit for attribute lengths, finite values, or index bounds;
  structural test assertions MAY check the emitted subset.
- **REQ-GEOM-4** — Each source mesh MUST map to one glTF mesh with one
  primitive. Positions, normals, optional UVs, and indices MUST be preserved
  numerically except for the selected conversion and winding behavior in
  `REQ-HAND`.
- **REQ-GEOM-5** — The index component type MUST be unsigned and wide enough
  for the mesh's vertex count. V1 MUST NOT quantize, weld, re-index, or
  otherwise re-author retained geometry.
- **REQ-GEOM-6** — Geometry MAY be deduplicated only when live geometry
  identity is explicitly shared. The deduplication key MUST include the
  conversion mode, and unrelated arrays MUST NOT be byte-compared to discover
  sharing.
- **REQ-GEOM-7** — Buffer regions and accessor offsets MUST be aligned to the
  actual requirement of their component types and GLB structures. Alignment
  MUST NOT be imposed as a universal four-byte rule on every component.
- **REQ-GEOM-8** — Meshes carrying skeleton, morph, VAT, or thin-instance state
  MUST export base geometry only. V1 MUST NOT bake those deformations or expand
  instances.
- **REQ-GEOM-9** — V1 MUST NOT emit tangents, second UV sets, vertex colors,
  joints, weights, or any other attributes outside the base geometry contract.
  Their omission is documented scope and MUST NOT create a warning.

## 4. Handedness (`REQ-HAND`)

- **REQ-HAND-1** — Handedness MUST follow the current Babylon.js glTF exporter
  state model adapted to Lite. Ordinary Lite roots use the LH-to-RH conversion
  path. Children promoted by `REQ-SCENE-7` use the already-RH path and MUST NOT
  receive a redundant per-vertex handedness conversion.
- **REQ-HAND-2** — Within each conversion path, node transforms, vertex
  positions, vertex normals, and triangle winding MUST remain mutually
  consistent. Removing a coordinate-conversion root MUST preserve the visible
  transform and face orientation of its promoted descendants.
- **REQ-HAND-3** — Negative scales are legal input. The emitted transform and
  matching winding MUST preserve the intended face orientation; negative scale
  MUST NOT be rejected merely because its determinant is negative.
- **REQ-HAND-4** — Coordinate-conversion mode MUST be selected by the root test
  in `REQ-SCENE-7`, not by a node name or `_authoredSign`. Effective triangle
  winding MUST follow Lite's established mirrored-mesh rule: compare the
  current world-determinant sign with `mesh._authoredSign ?? 1`, then apply the
  Babylon.js-equivalent compensation when a no-op root was removed.
- **REQ-HAND-5** — Handedness conversion and winding selection MUST be isolated
  in private code. Shared-geometry reuse MUST distinguish every output-affecting
  conversion and winding mode. When Lite and Babylon.js behavior is ambiguous,
  the current Babylon.js glTF exporter is the behavioral reference.

## 5. GLB container (`REQ-GLB`)

- **REQ-GLB-1** — The output MUST be a glTF 2.0 GLB with no external URI or
  sidecar file. Its JSON MUST contain `asset.version: "2.0"` and a Babylon
  Lite generator string.
- **REQ-GLB-2** — The GLB header MUST contain the glTF magic, version `2`, and
  a total length equal to the Blob byte length. JSON MUST precede binary data.
- **REQ-GLB-3** — An empty export MUST contain one JSON chunk only, with an
  empty default scene representation. It MUST contain no BIN chunk and no
  `buffers`, `bufferViews`, or `accessors` structures.
- **REQ-GLB-4** — A geometry export MUST contain one JSON chunk followed by one
  BIN chunk. Its JSON MUST declare exactly one URI-less buffer whose
  `byteLength` matches the BIN payload.
- **REQ-GLB-5** — Chunk lengths MUST equal their padded payload lengths. JSON
  padding MUST use spaces and binary padding MUST use zero bytes, with valid
  UTF-8 JSON and GLB chunk framing.
- **REQ-GLB-6** — JSON MUST contain only the node, mesh, accessor, bufferView,
  scene, and related structures needed by the emitted subset. It MUST NOT
  declare materials, textures, images, samplers, cameras, lights, animations,
  skins, morph targets, metadata, or other omitted v1 content.
- **REQ-GLB-7** — V1 MUST emit no glTF extensions and MUST NOT declare
  `extensionsUsed` or `extensionsRequired`. No primitive MAY carry a material
  reference.
- **REQ-GLB-8** — A hand-written test helper MUST inspect only the emitted
  subset: GLB framing and padding, reference reachability, component alignment,
  accessor shapes, position bounds, triangle index bounds, and default-scene
  reachability. No glTF validator dependency MAY be added, and the helper MUST
  not be described as full conformance validation.

## 6. Errors and omissions (`REQ-ERR`)

- **REQ-ERR-1** — Any failure that prevents valid output MUST use Lite's
  existing coded thrown-error convention and MUST return no partial result.
  Entity-specific errors SHOULD identify the affected mesh or node.
- **REQ-ERR-2** — The documented known failures include unavailable required
  CPU geometry and currently marked non-triangle topology. This list is
  illustrative, not exhaustive; the exporter MUST NOT be constrained to an
  exact or capped number of error conditions.
- **REQ-ERR-3** — V1 MUST return no warning collection and MUST log no warnings.
  Visibility, metadata, omitted attributes, materials, and other v1 omissions
  are scope decisions rather than warning events.
- **REQ-ERR-4** — The public entry point MUST NOT inspect a nominal runtime
  input shape or a `_disposed` flag. Exportability depends on the CPU geometry
  and live graph available at collection time.
- **REQ-ERR-5** — V1 MUST NOT add a new warning-code or warning-logging system.
  Failures use coded thrown errors; omissions are documented in the v1 scope
  and output contract.

## 7. Size and repository constraints (`REQ-SIZE`)

- **REQ-SIZE-1** — A bundled consumer that does not reference
  `exportSceneGLB` MUST pay no exporter runtime bytes. The root re-export MUST
  remain tree-shakable without relying on a dynamic import.
- **REQ-SIZE-2** — New exporter modules MUST have no import-time side effects,
  registrations, global mutations, or module-level mutable caches. Existing
  tree-shaking coverage MUST be extended rather than duplicated.
- **REQ-SIZE-3** — V1 MUST add no runtime, development, peer, or test
  dependency, including no validator dependency.
- **REQ-SIZE-4** — Core scene, mesh, loader, resource, and material modules
  MUST NOT gain exporter-specific behavior. Existing package export maps MUST
  remain root-only.
- **REQ-SIZE-5** — No existing bundle-size ceiling, parity threshold, golden
  reference, or unrelated per-scene manifest MAY be changed for this feature.
  Affected demo measurement is separate.
- **REQ-SIZE-6** — Validation for implementation work MUST remain focused on
  changed behavior and filtered representative scenes; CI owns full scene
  coverage. No all-scene, unfiltered bundle, or performance run is part of
  local feature validation.

## 8. Tests (`REQ-TEST`)

- **REQ-TEST-1** — Production behavior MUST be tested only by calling
  `exportSceneGLB` and observing its `Blob` bytes or thrown errors. Tests MUST
  not depend on private collector or serializer shapes.
- **REQ-TEST-2** — Direct GLB parsing and assertions MUST be the primary gate.
  They MUST cover empty JSON-only output, geometry JSON-plus-one-BIN output,
  hierarchy, transforms, names, optional UVs, index widths, component
  alignment, root sniffing and promotion, ordinary-LH and already-RH conversion
  states, mirrored winding cases, shared-identity deduplication, deterministic
  bytes, MIME, and omitted v1 constructs.
- **REQ-TEST-3** — Exactly one re-import smoke test MUST export a live scene,
  await the Blob, re-import it, and verify that the resulting asset loads.
  It is a smoke signal, not a promise of source-preserving round trips.
- **REQ-TEST-4** — One combined numbered parity scene MUST cover asymmetric
  geometry, ordinary-scale and negative-scale parents, and a quaternion
  hierarchy, including content exported through the sniffed-root path. The
  scene MUST exercise the public Blob seam; root promotion and shared geometry
  remain direct GLB byte-level assertions.
- **REQ-TEST-5** — Babylon.js parity behavior MUST be adapted independently.
  The Babylon.js golden is generated once; runtime parity opens only the Lite
  scene. No upstream playground source or golden image MAY be copied.
- **REQ-TEST-6** — The download demo MUST remain separate from the numbered
  parity scene and MUST have a catalog entry, a JPG thumbnail, and a recorded
  bundle measurement.
- **REQ-TEST-7** — A manual gate MUST record whether a downloaded Blob opens
  without modification in an independent external viewer. This is a judgment
  gate, not a structural-test claim.
- **REQ-TEST-8** — Local implementation validation MUST use focused unit,
  plumbing, type, tree-shaking, and filtered-build checks. CI owns full scene
  coverage; this documentation-only revision runs no code tests.

## 9. Delivery and traceability (`REQ-DELIV`)

- **REQ-DELIV-1** — The architecture contract MUST specify the exact public
  seam, private two-phase pipeline, scene closure, geometry and handedness
  rules, GLB subset, omissions, coded-error policy, test seams, and file
  manifest before implementation begins.
- **REQ-DELIV-2** — The implementation plan MUST describe one feature branch
  with work milestones that are not independently releasable partial features.
  Milestone order MUST be architecture, private writer/helper, scene
  collector, geometry/deduplication, conversion/serialization, public
  integration, parity, then demo/evidence.
- **REQ-DELIV-3** — The Babylon.js equivalence map MUST cover core exporter
  behaviors individually and MUST group all exporter extensions as deferred
  v1 work.
- **REQ-DELIV-4** — The cataloged download demo MUST consume the public Blob
  seam, provide its own JPG thumbnail, and record raw and gzip bundle
  measurements without changing unrelated scene manifests.
- **REQ-DELIV-5** — Final implementation evidence MUST report focused checks,
  the re-import smoke, the combined parity scene, tree-shaking and bundle
  results, demo readiness, and the manual external-viewer judgment. It MUST
  not claim a check passed before it ran.
- **REQ-DELIV-6** — The four planning documents MUST remain mutually
  consistent: they MUST contain no reference to the deleted review document,
  must use the IDs in this file, and must not reintroduce rejected public
  inputs, warning systems, name-based loader detection, or invalid GLB rules.

## 10. Out of scope for v1

| Omitted capability | V1 disposition |
| --- | --- |
| Materials, textures, images, samplers | Not emitted; no warning system |
| Cameras, lights, animations | Not emitted; no warning system |
| Skins, morph targets, VAT, thin-instance expansion | Base geometry only; no baking or expansion |
| Metadata and glTF extras | Not emitted; ignored |
| Tangents, second UV sets, vertex colors, joints, weights | Not emitted; optional UV0 remains supported |
| glTF extensions | No extension output; deferred as a grouped future area |
| `.gltf` plus `.bin`, external URIs, Draco, or other formats | Not produced |
| GPU readback and runtime disposal/nominal checks | Not performed |
| Download behavior in the package | Kept in the separate lab demo |
| General graph repair or general mesh validity auditing | Not performed; Lite state is assumed well formed |

## 11. Acceptance criteria summary

| Requirement IDs | Acceptance evidence |
| --- | --- |
| REQ-API-1..REQ-API-5 | Public type test and a Blob returned by the exact root function; MIME, no options, no side effect, and no alternate input are observable |
| REQ-API-6..REQ-API-8 | Public-seam immutability/lifetime checks plus static-import and source inspection |
| REQ-SCENE-1..REQ-SCENE-4 | Parsed Blob JSON proves ancestor closure, one-to-one nodes, names, deterministic order, and default-scene reachability |
| REQ-SCENE-5..REQ-SCENE-8 | Public-seam fixtures prove ignored visibility/metadata, preserved wrappers, sniffed conversion-root removal, current transforms, and documented graph assumptions |
| REQ-GEOM-1..REQ-GEOM-5 | Parsed Blob accessors and thrown coded errors prove CPU base data, optional UVs, current topology, one primitive, and faithful indices |
| REQ-GEOM-6..REQ-GEOM-9 | Blob byte assertions prove identity/mode deduplication and component alignment; fixtures prove no extra attributes or instance expansion |
| REQ-HAND-1..REQ-HAND-5 | Parsed transforms, positions, normals, winding, negative-scale fixture, and the combined parity scene |
| REQ-GLB-1..REQ-GLB-5 | Hand-written emitted-subset helper over public Blob bytes |
| REQ-GLB-6..REQ-GLB-8 | JSON inspection proves omissions and no extensions; helper and dependency diff prove the scoped validator policy |
| REQ-ERR-1..REQ-ERR-5 | Public-seam error tests, decoded existing coded errors, and absence of warnings/logging or runtime disposal checks |
| REQ-SIZE-1..REQ-SIZE-3 | Extended tree-shaking tests, static-import review, and dependency diff |
| REQ-SIZE-4..REQ-SIZE-6 | Package/source review, unchanged thresholds/goldens/manifests, and focused validation record |
| REQ-TEST-1..REQ-TEST-5 | Public-seam unit/plumbing assertions, one re-import smoke, and one combined numbered parity scene |
| REQ-TEST-6..REQ-TEST-8 | Demo inventory/measurement, manual viewer record, and focused-vs-CI validation record |
| REQ-DELIV-1..REQ-DELIV-3 | Architecture and implementation-plan review, including the equivalence map |
| REQ-DELIV-4..REQ-DELIV-6 | Demo/catalog evidence, PR evidence, and cross-document contradiction audit |

## 12. Resolved decisions

| Decision | Resolution | Affected requirements |
| --- | --- | --- |
| Public contract | `exportSceneGLB(scene: SceneContext): Promise<Blob>`, MIME `model/gltf-binary`, no options or download side effect | REQ-API-1..REQ-API-5 |
| Scene selection | Ancestor closure of `scene.meshes`; remaining nodes one-to-one after root normalization; unrelated empty/unindexed nodes omitted | REQ-SCENE-1..REQ-SCENE-4 |
| Loader hierarchy | Preserve mesh wrappers; remove only structurally sniffed no-op coordinate-conversion roots and promote their children | REQ-SCENE-7, REQ-HAND-1..REQ-HAND-4 |
| Private architecture | Synchronous collection followed by asynchronous serialization with a private purpose-built type | REQ-API-6..REQ-API-8, REQ-DELIV-1 |
| Geometry | Retained CPU base attributes, optional UV0, current triangle topology, identity-plus-mode deduplication, component alignment | REQ-GEOM-1..REQ-GEOM-7 |
| Handedness | Babylon.js-equivalent ordinary-LH and removed-conversion-root states; Lite mirrored-mesh semantics select effective winding; negative scales are legal | REQ-HAND-1..REQ-HAND-5 |
| Omitted content | No materials, textures, images, samplers, cameras, lights, animations, skins, morph output, metadata, extensions, extra attributes, or instance expansion | REQ-SCENE-5, REQ-GEOM-8..REQ-GEOM-9, REQ-GLB-6..REQ-GLB-7, REQ-ERR-3 |
| Errors and lifetime | Existing coded thrown errors for failures; no warning channel; no exhaustive error count, nominal input check, or disposal check | REQ-ERR-1..REQ-ERR-5 |
| GLB and validation | JSON-only empty GLB; JSON plus one BIN for geometry; hand-written emitted-subset checks; no validator dependency | REQ-GLB-1..REQ-GLB-8 |
| Verification | Public Blob/errors only, direct assertions primary, one re-import smoke, one combined numbered parity scene, separate demo/manual gate | REQ-TEST-1..REQ-TEST-8 |
| Equivalence map | Core behaviors mapped individually; extensions grouped as deferred | REQ-DELIV-3 |

## 13. Requirement counts

| Group | Count |
| --- | ---: |
| REQ-API | 8 |
| REQ-SCENE | 8 |
| REQ-GEOM | 9 |
| REQ-HAND | 5 |
| REQ-GLB | 8 |
| REQ-ERR | 5 |
| REQ-SIZE | 6 |
| REQ-TEST | 8 |
| REQ-DELIV | 6 |
| **Total** | **63** |
