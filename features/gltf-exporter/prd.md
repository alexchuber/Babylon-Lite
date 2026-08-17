# PRD — glTF Exporter (v1)

**Status:** Approved for implementation planning

**Source goals:** [goals.md](goals.md); **Source requirements:**
[requirements.md](requirements.md) — 63 normative requirements
**Governing constraints:** [GUIDANCE.md](../../GUIDANCE.md)

This document frames the product decision. The requirements document remains
the normative, traceable specification.

## Production seam

There is one production seam:

```ts
export function exportSceneGLB(scene: SceneContext): Promise<Blob>;
```

The caller receives a `Blob` with MIME `model/gltf-binary`. The function has no
options and no download side effect. Tests observe production only through the
Blob bytes and thrown coded errors. They do not reach into the private
collector, collected type, serializer, or test helper.

## Problem

Babylon Lite can load glTF but cannot currently write a portable artifact from
the scene it owns. This blocks ordinary workflows such as handing a generated
scene to another tool, opening it in an external viewer, or saving a current
scene state for a pipeline. Requiring callers to reverse-engineer internal CPU
fields would make the feature fragile and contrary to the package boundary.

Lite does not retain all source-file information. V1 therefore re-derives a
GLB from the current live scene state. It does not promise source-preserving
round trips today; future work may add retained data or richer exporters
without changing what this v1 contract promises.

## Solution

`exportSceneGLB` selects the ancestor closure of `scene.meshes`. A mesh is a
seed, and every live `SceneNode` ancestor needed to place it is selected until
a non-`SceneNode` world-matrix provider is reached. Selected nodes are emitted
one-to-one, with names and relationships intact, including transform-only
ancestors, except for the root normalization described next.
Loader mesh wrappers remain. A root that matches
Babylon.js's no-op coordinate-system conversion-root test is removed and its
children are promoted; detection is based on transform and payload, never the
root's name. Unrelated empty or unindexed nodes are omitted because v1 exports
the mesh graph rather than every unattached object. Visibility and metadata are
ignored without a warning channel. A light, camera, or other non-`SceneNode`
ancestor is not emitted; its selected `SceneNode` child becomes a root using
its current world matrix so mesh placement is preserved without widening v1
into light or camera export.

The private implementation collects the graph synchronously and serializes it
asynchronously:

```ts
function collectSceneForGltf(scene: SceneContext): CollectedGltfScene;
function serializeGlb(data: CollectedGltfScene): Promise<Blob>;
```

Collection fixes deterministic ordering, snapshots inexpensive mutable state,
identifies explicitly shared live geometry, and records work for serialization.
The collected type is purpose-built and private. V1 uses static imports and
retained CPU data; it adds no GPU readback or speculative neutral adapter.
Reading an existing lazy interleaved geometry getter may materialize its normal
de-strided cache, but the exporter attaches no state and mutates no source array.

Geometry is static base positions, normals, indices, and optional UV0. Current
non-triangle topology is rejected. Shared geometry is deduplicated only by
explicit live identity plus conversion mode. Skeleton, morph, VAT, and
thin-instance meshes export base geometry only. Optional UV means optional in
the current retained mesh state: a loader-generated zero-filled UV array is
exported as current state even when the source glTF omitted the attribute.

Handedness follows Babylon.js exporter behavior. Ordinary Lite roots use the
LH-to-RH path. Children promoted from a sniffed coordinate-conversion root use
the already-RH path and avoid redundant vertex conversion. Effective winding
uses `_authoredSign` as the retained geometry baseline (the same state used by
Lite's mirrored-mesh support) plus Babylon.js-equivalent compensation for
removed roots. Negative scales remain legal and stay represented by node
transforms rather than independently reversing indices. The root test, not
`_authoredSign`, selects the coordinate-conversion path.

The GLB writer emits JSON-only output with an empty default scene for an empty
scene and JSON plus one BIN chunk for geometry. It emits no materials, textures, images, samplers,
cameras, lights, animations, skins, morph output, metadata, extensions,
tangents, second UV sets, vertex colors, or instance expansion. Omitted
capabilities are documented v1 scope; they are not returned as warnings and
are not logged. Failures that prevent valid output use Lite's existing coded
thrown-error convention, without an exhaustive or capped error count.

## User stories

1. As a Lite developer, I can call one root-exported function with my
   `SceneContext` and receive a single GLB `Blob`.
2. As a Lite developer, I can export the scene's current transforms and graph
   without registration, rendering, or a GPU handle.
3. As a Lite developer, I can export procedural and loaded meshes together and
   keep transform-only ancestors and non-empty names.
4. As a Lite developer, I can rely on optional UV0, current triangle topology,
   shared live geometry, and base-only behavior for unsupported deformation.
5. As a Lite developer, I can open an empty or geometry-bearing result as a
   correctly framed glTF 2.0 GLB, with no hidden download behavior.
6. As a Lite developer, I receive an existing coded error when valid output
   cannot be produced, while omitted v1 state remains a documented scope
   decision rather than a warning API.
7. As a Lite maintainer, unused consumers pay no exporter runtime bytes, no
   dependency or threshold changes are needed, and tests use only the public
   seam.
8. As an evaluator, I can use a separate cataloged demo to download a Blob,
   view its thumbnail and measurement, and record an external-viewer result.

## Product decisions

| Area         | Decision                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| API          | Exact `exportSceneGLB(scene: SceneContext): Promise<Blob>`; no options, overload, alternate input, label, or package download     |
| Selection    | Ancestor closure of `scene.meshes`; remaining nodes one-to-one after root normalization; unrelated empty/unindexed nodes omitted  |
| Hierarchy    | Live parent/child structure and names preserved; mesh wrappers remain; structurally sniffed no-op conversion roots are removed    |
| Architecture | Synchronous private collection followed by asynchronous private serialization                                                     |
| Geometry     | Retained CPU base data, optional UV0, current triangle topology, identity-plus-mode sharing, component-aware alignment            |
| Handedness   | Babylon.js-equivalent LH and already-RH root states; `_authoredSign` records base winding; determinant parity stays in transforms |
| Scope        | No materials, images, cameras, lights, animation, deformation output, metadata, extensions, or extra vertex attributes            |
| Errors       | Existing coded thrown errors for invalid output; no warning return or logging system; known errors are not a closed list          |
| Format       | JSON-only empty GLB; JSON plus one BIN for geometry; correct framing and `model/gltf-binary` Blob                                 |

## Testing and acceptance

Direct GLB assertions are the primary correctness gate. A hand-written
emitted-subset helper checks framing, padding, references, component
alignment, accessor shapes, position bounds, triangle indices, and scene
reachability; it is not a full validator. The test inventory contains:

- one re-import smoke test;
- one combined numbered parity scene with asymmetric geometry, ordinary and
  negative-scale parents, a quaternion hierarchy, and the sniffed-root path;
- direct byte assertions for root promotion, both conversion states,
  authored-winding/root compensation, negative-scale transforms, shared
  identity deduplication, deterministic output, optional UVs, empty output,
  MIME, and omitted constructs;
- one cataloged download demo with JPG thumbnail and bundle measurement; and
- one manual external-viewer gate for a downloaded result.

The Babylon.js golden is generated once, and runtime parity opens only the Lite
scene. Local implementation validation remains focused; CI owns full scene
coverage. No existing golden, threshold, ceiling, or unrelated scene manifest
is a baseline to change.

## Scope and future-safe language

V1 is intentionally material-free and static. It does not emit materials,
textures, images, samplers, cameras, lights, animations, skins, morph targets,
VAT, thin-instance expansion, metadata, extensions, tangents, UV2, colors,
joints, or weights. It also does not provide `.gltf` plus `.bin`, external
URIs, GPU readback, a package download helper, or general graph/mesh repair.

These are deferred capabilities, not claims that they can never be supported.
The public name is version-agnostic, the collected type is private, and the
Babylon.js equivalence map records core behavior individually while grouping
all exporter extensions as deferred.

## Babylon.js equivalence map

The future architecture document MUST map each core behavior separately:

| Core behavior                                                         | Reference disposition                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Scene closure and node preservation                                   | Compare behavior with Babylon.js, then implement the Lite graph contract                                   |
| Static CPU geometry and accessor packing                              | Compare emitted values and framing, then implement the Lite data path                                      |
| LH-to-RH conversion, no-op root removal, and winding                  | Follow current Babylon.js exporter state/compensation behavior, adapted to Lite's mirrored-mesh convention |
| GLB framing, empty output, and omission rules                         | Implement the explicitly scoped v1 subset                                                                  |
| Exporter extensions (`KHR_*`, `EXT_*`, and material/texture features) | Grouped deferred work; no extension is emitted in v1                                                       |

This map records equivalence targets without copying Babylon.js source or test
code.
