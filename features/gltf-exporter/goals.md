# Goals — glTF Exporter (v1)

**Status:** Approved scope for implementation planning

## Goal

Give Babylon Lite one small, tree-shakable way to export the current contents of a
`SceneContext` as a portable glTF 2.0 binary:

```ts
export function exportSceneGLB(scene: SceneContext): Promise<Blob>;
```

The returned `Blob` MUST have type `model/gltf-binary`. Calling the function MUST
not download a file, mutate the scene, or accept an options object. The public
surface is deliberately version-agnostic and has no exporter-specific
experimental label.

V1 re-derives output from the live Lite scene state. It does not promise
source-preserving round trips today; that is a statement about the data retained
by the current implementation, not a permanent limit on future exporters.

## Scene boundary

The export is the ancestor closure of `scene.meshes`:

- Every mesh in `scene.meshes` is a seed.
- Every live ancestor needed to place a seed mesh is selected.
- Selected nodes are preserved one-to-one, with their names and parent/child
  relationships, except for a removable coordinate-conversion root as described
  below. Transform-only ancestors are otherwise retained.
- Empty or unindexed nodes unrelated to an exported mesh are omitted. V1 exports
  the scene's mesh graph, not every object ever created.
- Visibility and metadata do not affect selection and do not produce warnings.
- Lite's scene graph is assumed to be a well-formed tree or forest. Malformed
  graphs have undefined behavior.
- Loader-created mesh wrappers remain ordinary included nodes. A graph root that
  can be identified, using the same transform-and-payload test as the Babylon.js
  exporter, as a no-op coordinate-system conversion root is removed and its
  children are promoted to exported roots. Detection does not depend on its name.

## Geometry and coordinate conversion

V1 exports static retained CPU base geometry: positions, normals, and indices,
with `TEXCOORD_0` emitted only when UVs exist. It uses the current live
triangle-list topology. A mesh currently marked as non-triangle is rejected;
there is no attempt to recover topology discarded by loading, and no general
runtime audit of lengths, finite values, or index bounds.

Shared geometry is deduplicated only when live geometry identity is explicitly
shared, and the key includes the conversion mode. Unrelated arrays are not
byte-compared. Binary regions use the alignment required by their component
types; alignment is not universally four bytes.

Skeleton, morph, VAT, and thin-instance meshes export base geometry only. V1
does not bake deformation or expand instances. No materials, textures, images,
samplers, cameras, lights, animations, skins, morph output, metadata,
extensions, tangents, second UV sets, or vertex colors are emitted.

Handedness follows the Babylon.js exporter state model:

- ordinary Lite roots and their descendants use the LH-to-RH conversion path;
- children promoted from a sniffed no-op coordinate-conversion root use the
  already-RH path, avoiding a redundant vertex conversion; and
- triangle winding follows the mesh's effective rendered orientation, using
  Lite's established mirrored-mesh rule (current world determinant versus
  `_authoredSign`) and the equivalent of Babylon.js's removed-root winding
  compensation.

Node transforms, positions, normals, and winding stay consistent within each
path, and negative scales remain legal. `_authoredSign` informs effective
winding; it does not select the coordinate-conversion path. Ambiguous conversion
or winding behavior is resolved against the current Babylon.js glTF exporter.

## Private implementation direction

The exporter has one private, purpose-built two-phase pipeline:

```ts
function collectSceneForGltf(scene: SceneContext): CollectedGltfScene;
function serializeGlb(data: CollectedGltfScene): Promise<Blob>;
```

Collection is synchronous. It establishes deterministic hierarchy and ordering,
snapshots inexpensive mutable state, identifies explicitly shared geometry, and
records serialization work before serialization begins. Serialization performs
coordinate conversion, packing, and `Blob` assembly. The collected type is
private; v1 does not define a speculative general neutral adapter.

V1 uses ordinary static imports and never performs GPU readback. The exporter
does not mutate or dispose source state, and referenced CPU arrays remain
unmodified until the returned promise settles.

## Output and failure policy

An empty export is a JSON-only GLB with an empty default scene: it has no BIN
chunk and no buffer, bufferView, or accessor structures. A geometry export has
one JSON chunk and one BIN chunk with one URI-less buffer. Both forms use
correct GLB framing, UTF-8 JSON, chunk lengths, padding, and the required Blob
MIME.

V1 has no warning return value and no warning logger. The omissions above are
documented scope, not warning events. Failures that prevent valid output use
Lite's existing coded thrown-error convention. The known failures documented by
the feature are examples, not an exhaustive or capped error list. The public
entry point performs no runtime nominal `SceneContext` check and does not
inspect disposal flags; exportability depends on CPU geometry available during
collection.

## Verification and delivery

Tests observe production only through `exportSceneGLB`'s `Blob` and thrown
errors. Direct GLB parsing and assertions are the primary gate. A hand-written
test helper checks only the emitted subset: framing and padding, reachability,
component alignment, accessor shapes, position bounds, triangle indices, and
scene reachability. It is not a glTF validator, and no validator dependency is
added.

The test plan includes one re-import smoke test and one combined numbered parity
scene covering asymmetric geometry, ordinary and negative-scale parents, a
quaternion hierarchy, and the sniffed-root path. Direct GLB assertions cover
root promotion, both conversion states, mirrored winding cases, and
shared-geometry deduplication. The parity golden is generated once from
Babylon.js; runtime parity opens only the Lite scene. A cataloged download demo,
JPG thumbnail, demo measurement, and manual external-viewer gate remain separate
from the numbered scene. Local validation is focused; CI owns full scene
coverage.

The Babylon.js equivalence map records core exporter behavior individually.
Babylon.js extension exporters are grouped as deferred v1 work rather than
listed as separate v1 implementation tasks. Babylon.js source is a behavioral
reference, not copied implementation.
