# Module: glTF Exporter

> Package path: `packages/babylon-lite/src/export-gltf/`

## Purpose

Export the current, live contents of a Babylon Lite `SceneContext` as one
portable glTF 2.0 GLB. V1 is deliberately a small static-geometry exporter:
it exports the mesh graph owned by the scene, current node transforms, retained
CPU positions/normals/indices, and optional `TEXCOORD_0`. It does not attempt a
source-preserving round trip, GPU readback, material export, deformation bake,
or general scene repair.

The scene boundary is the `SceneNode` ancestor closure of `scene.meshes`. A
mesh is a seed; every live `SceneNode` ancestor needed to place that mesh is
included until a non-`SceneNode` world-matrix provider is reached.
Transform-only ancestors and loader-created mesh wrappers are retained, except
for the structural no-op coordinate-conversion root described below.
Unrelated nodes are not exported. Visibility and metadata are ignored, without
warnings.

The implementation is private and two-phase:

```text
exportSceneGLB(scene)
  -> collectSceneForGltf(scene)       // synchronous, source snapshot
  -> serializeGlb(collected)          // asynchronous, CPU conversion and GLB
  -> Blob("model/gltf-binary")
```

This contract is governed by the 63 normative requirements in
`features/gltf-exporter/requirements.md`. Babylon.js behavior resolves
handedness and winding ambiguity, but Babylon.js source is a behavioral
reference only; its implementation is not copied.

## Public API Surface (types, functions, constants — full signatures)

```ts
export function exportSceneGLB(scene: SceneContext): Promise<Blob>;
```

- The function is a standalone named export from
  `packages/babylon-lite/src/index.ts`, which remains the only package entry
  point. No exporter type or method is public.
- The signature accepts exactly one `SceneContext`. There is no options
  object, overload, alternate container, engine parameter, device parameter,
  raw WebGPU handle, or experimental/preview label.
- The fulfilled value is a `Blob` whose type is exactly
  `"model/gltf-binary"`.
- The package function never creates an object URL, downloads a file, touches
  the DOM, or exposes a download helper. Download behavior belongs only to the
  separate lab demo.
- Collection completes before serialization begins. The public wrapper does
  not inspect `_kind`, perform a nominal runtime shape check, inspect
  `_disposed`, register the scene, render a frame, or require an engine/device.
- Source nodes, meshes, GPU wrappers, and CPU arrays are never mutated,
  disposed, or given exporter state. Reading an existing lazy interleaved CPU
  getter may populate that getter's own de-strided cache. Failures throw Lite's
  existing coded error form and never return a partial Blob.

## Internal Architecture

### Module layout

The production implementation is a static-imported, CPU-only module family.
The following boundaries keep the public function small and keep all
implementation types private:

```text
export-scene-glb.ts
  -> collect-gltf-scene.ts
  -> gltf-conversion.ts
  -> gltf-json.ts
  -> glb-serializer.ts
```

`export-scene-glb.ts` contains the public wrapper and no module-level work.
`collect-gltf-scene.ts` owns graph selection, snapshots, topology checks, and
geometry identity. `gltf-conversion.ts` owns the handedness and effective
winding rules. `gltf-json.ts` contains private JSON shapes and numeric
constants. `glb-serializer.ts` plans streams, writes little-endian bytes, and
assembles the GLB. None of these modules creates a cache, registers a feature,
mutates global state, or performs work at import time.

### Scene closure and deterministic hierarchy

Collection is defined as follows:

1. Copy the current `scene.meshes` array into a local seed array. Seed order is
   part of deterministic output.
2. For every seed, walk `parent` links while the parent satisfies the
   `SceneNode` transform contract (`children`, `position`,
   `rotationQuaternion`, and `scaling`) and mark every node on that chain
   selected. A light, camera, or foreign `IWorldMatrixProvider` is not selected
   or emitted. The selected child below it becomes an exported root and
   snapshots its current `worldMatrix` as a matrix transform so omitted
   ancestors do not change its placement. The graph is otherwise assumed to be
   a well-formed tree or forest. Cycles and contradictory
   `parent`/`children` links have undefined behavior; no graph repair or general
   validation pass is added.
3. The first-seen top-level roots are retained in root order. A root is
   traversed recursively in its live `children` array order, filtering out
   children not in the selected set. This produces node indices. A selected
   node is emitted once, even when several mesh seeds share it.
4. A selected mesh node receives one `CollectedGltfMesh` and therefore one
   glTF mesh and one primitive. A transform-only selected node receives a glTF
   node with no `mesh` property. Mesh wrappers are never collapsed into their
   transform parent.
5. `document.scenes[0].nodes` contains exactly the emitted root indices. Every
   emitted node is reachable by following `children` from the default scene.
   No unrelated empty, unindexed, or unattached node is added.

The collector uses identity maps only for lookup and duplicate prevention. It
never iterates a `Map`, `Set`, or `WeakMap` to decide output order. Mesh,
geometry-job, accessor, and buffer-stream indices are assigned by first
encounter in the ordered node walk.

`visible`, `metadata`, material state, render order, lights, cameras,
animation groups, and scene registration state do not affect selection or
output. Metadata and visibility changes therefore produce neither output nor
warnings.

### Structural no-op coordinate root normalization

Lite's loader creates a synthetic root with the same handedness matrix used by
the Babylon.js loader:

```text
C = diag(-1, 1, 1, 1)
```

`C` is represented in column-major order as:

```ts
const COORDINATE_CONVERSION_ROOT = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
```

For each selected graph root, the collector performs the Babylon.js-equivalent
structural test:

- the root is transform-only and has no `_gpu` property;
- its live `parent` is `null` (an exported root created by omitting a
  non-`SceneNode` parent is never treated as a loader conversion root);
- its current `worldMatrix` has all 16 elements within `0.001` of the
  corresponding element of `C` (the Babylon.js `Epsilon` tolerance); and
- the test does not inspect the root name.

Only a root satisfying all of those conditions is removed. Its selected
children are promoted in their original child order. A root named
`"__root__"` that fails the structural test remains; an arbitrarily named root
that passes is removed. A mesh wrapper can never pass because it has `_gpu`,
even if its transform happens to equal `C`.

Each ordinary root and its descendants receive
`coordinateMode: "lh-to-rh"` and `rootState: "ordinary"`. Every child promoted
from a removed root and every selected descendant receives
`coordinateMode: "already-rh"` and `rootState: "promoted-noop"`. The removed
root's `C` transform is not emitted and is not applied a second time to
promoted vertex data or transforms. `rootState` is inherited by the complete
promoted subtree so every geometry job receives the Babylon.js no-op-root
orientation compensation.

### Private collected types and invariants

These types are file-private implementation contracts. They are not exported
from the package root or any package subpath.

```ts
type GltfCoordinateMode = "lh-to-rh" | "already-rh";
type GltfRootState = "ordinary" | "promoted-noop";
type GltfWindingMode = "preserve" | "reverse";
type GltfIndexComponentType = 5123 | 5125; // UNSIGNED_SHORT | UNSIGNED_INT
type GltfVec3 = readonly [number, number, number];
type GltfQuat = readonly [number, number, number, number];
type GltfMat4 = readonly [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];

interface CollectedGltfTrs {
    readonly kind: "trs";
    readonly translation: GltfVec3;
    readonly rotation: GltfQuat;
    readonly scale: GltfVec3;
}

interface CollectedGltfMatrix {
    readonly kind: "matrix";
    readonly matrix: GltfMat4;
}

type CollectedGltfTransform = CollectedGltfTrs | CollectedGltfMatrix;

interface CollectedGltfNode {
    readonly name: string;
    readonly transform: CollectedGltfTransform;
    readonly children: readonly number[];
    readonly meshIndex?: number;
    readonly coordinateMode: GltfCoordinateMode;
    readonly rootState: GltfRootState;
}

interface CollectedGltfMesh {
    readonly nodeIndex: number;
    readonly name: string;
    readonly geometryJobIndex: number;
}

interface CollectedGltfGeometrySource {
    readonly identity: object; // the source mesh._gpu object, never dereferenced
    readonly positions: Float32Array;
    readonly normals: Float32Array;
    readonly indices: Uint32Array;
    readonly uvs?: Float32Array;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly maxIndex: number;
}

interface CollectedGltfGeometryJob {
    readonly source: CollectedGltfGeometrySource;
    readonly coordinateMode: GltfCoordinateMode;
    readonly windingMode: GltfWindingMode;
    readonly indexComponentType: GltfIndexComponentType;
}

interface CollectedGltfScene {
    readonly nodes: readonly CollectedGltfNode[];
    readonly roots: readonly number[];
    readonly meshes: readonly CollectedGltfMesh[];
    readonly geometryJobs: readonly CollectedGltfGeometryJob[];
}

function collectSceneForGltf(scene: SceneContext): CollectedGltfScene;
function serializeGlb(data: CollectedGltfScene): Promise<Blob>;
```

The invariants are:

- `nodes[i].children` contains only valid node indices, in source child order.
  `nodes[i].meshIndex`, when present, points to one `meshes` entry, and that
  entry's `nodeIndex` is `i`.
- `meshes` is in node-walk order. Each entry is emitted exactly once even if
  its geometry job is shared. `geometryJobIndex` is valid and points to a job
  whose source arrays are suitable for that mesh by the existing live-mesh
  sharing contract.
- `geometryJobs` is in first-use order. The collector uses a nested lookup,
  `Map<object, Map<`${GltfCoordinateMode}:${GltfWindingMode}`, number>>`, keyed
  first by the shared `mesh._gpu` wrapper identity and then by both
  output-affecting modes. It never creates a fresh composite object as a `Map`
  key. Equal-looking arrays on different `_gpu` objects never deduplicate.
  There is no byte comparison, hash, or content-based sharing.
- `indexComponentType` is decided once during collection from the source
  vertex count and maximum index. It is not recomputed from a later array or
  from a copied view.
- The collected object contains no `SceneContext`, no live `children` arrays,
  no live transform objects, and no references to materials. The opaque
  `_gpu` identity is retained only as an `object` key and is never dereferenced
  by serialization.
- Node names, local transforms, root state, authored winding signs, topology,
  and array references are observed during collection. The
  serializer never re-reads live node state.

### Snapshot and CPU-array lifetime

The collector reads the current local state synchronously:

- If `_localMatrix` is present, it copies all 16 scalar values into a
  `CollectedGltfMatrix`. Otherwise it reads the current observable position,
  quaternion, and scale and copies those scalar values into a
  `CollectedGltfTrs`. The sole exception is an exported root whose live parent
  is an omitted non-`SceneNode` provider: that root snapshots its current
  `worldMatrix` into `CollectedGltfMatrix`.
- The collector reads each required `mesh._cpuPositions`,
  `mesh._cpuNormals`, and `mesh._cpuIndices` reference directly. It reads
  `mesh._cpuUvs` directly when present and non-empty. The direct references are
  intentionally retained in `CollectedGltfGeometrySource`.
- Accessing a lazy interleaved getter is allowed to materialize the existing
  tight CPU array and then retains that returned reference. The exporter does
  not call `getMeshGeometry`, because that helper copies arrays and would erase
  the live `_gpu`-identity sharing relationship. Populating `il._cpu` through
  that existing getter is the sole permitted cache mutation and is not counted
  as exporter state.
- The exporter allocates converted output arrays only during serialization.
  It never writes to any retained source array, including when reversing
  indices. The only possible cache write is the existing lazy interleaved
  getter's materialization; no exporter state is attached.
- Collection snapshots `scene.meshes`, node relationships, transforms, root
  state, names, and authored winding signs before returning. The collected object
  retains the references needed until `serializeGlb` has copied every source
  value into its output bytes. V1 serialization performs all source reads
  before yielding; its Promise return reserves the asynchronous contract for
  future formats/resources.
  External mutation of a retained CPU array while an export is pending is
  outside the contract; the exporter itself leaves the array byte-for-byte
  unchanged before and after the returned promise settles.

### Geometry policy and identity deduplication

For every selected mesh:

- Positions, normals, and indices are required retained CPU data. A missing
  required array throws an existing coded error naming the mesh. UV0 is
  optional and is emitted only when the direct `_cpuUvs` reference exists and
  is non-empty. The glTF loader zero-fills and retains UV0 when a source
  primitive omitted it; that array is current live geometry and is emitted.
  V1 does not attempt to recover source-level UV absence. UV2, tangents,
  colors, joints, weights, and all other attributes are ignored.
- `mesh._topology === undefined` means the current triangle-list topology.
  Any current non-triangle marker (point list, line list, line strip, or
  triangle strip) throws an existing coded error; no topology is recovered.
- Skeleton, morph-target, VAT, and thin-instance state does not change the
  geometry job. V1 exports the retained base arrays once; it does not bake
  deformation or expand instances.
- `vertexCount` is the retained position vertex count and `maxIndex` is the
  maximum value observed while scanning the retained index array. This scan is
  solely for index component selection. The collector does not audit attribute
  lengths, finite values, or index bounds.
- `UNSIGNED_SHORT` (`5123`) is selected only when
  `vertexCount <= 65535` and `maxIndex < 65535`. The strict maximum excludes
  the 16-bit primitive-restart sentinel. Otherwise `UNSIGNED_INT` (`5125`) is
  selected. V1 never emits signed indices, quantizes, welds, re-indexes, or
  changes vertex order.
- One `CollectedGltfGeometryJob` is reused by every mesh whose `_gpu` identity,
  coordinate mode, and final winding mode are equal. Reuse means the glTF
  primitives reference the same accessor indices; each mesh still receives
  its own glTF mesh object and primitive.

### Handedness, transforms, normals, and winding

`C` is its own inverse. It is used both for Lite's loader RH-to-LH root and for
the exporter LH-to-RH conversion:

```text
C = diag(-1, 1, 1, 1)
```

For an ordinary `"lh-to-rh"` subtree:

- A position and a normal become `C * v`, which is exactly
  `(-x, y, z)`. Normals are not regenerated, normalized, or inverse-transpose
  transformed; this is the orthogonal coordinate-basis change used by the
  current Babylon.js exporter.
- A TRS translation becomes `(-tx, ty, tz)`. Scale components, including
  negative and non-uniform values, are preserved. A quaternion first becomes
  the basis-equivalent `(qx, -qy, -qz, qw)`. To choose the same deterministic
  global sign as Babylon.js `ConvertToRightHandedRotation`, select X or Y when
  `qx*qx + qy*qy > 0.5`: choose X only when `abs(qx) > abs(qy)`, otherwise
  choose Y. Otherwise choose Z only when `abs(qz) > abs(qw)`, otherwise choose
  W. Negate all four converted components when the selected converted
  component is negative, then normalize before emission. The strict `>` rules
  mean ties choose Y or W, matching Babylon.js.
- A matrix node is not decomposed. Its emitted matrix is exactly
  `C * localMatrix * C` in column-major order. This preserves negative scales,
  shear, and any matrix state that cannot be represented faithfully as TRS.

For an `"already-rh"` subtree promoted from a sniffed root, local transforms,
positions, and normals are emitted without a second conversion. The removed
root's `C` is not serialized. An already-RH quaternion is normalized before
emission but keeps its source global sign; no converted-path canonicalization
is applied.

Triangle orientation follows Lite's established mirrored-mesh convention and
then the Babylon.js no-op-root compensation. `_authoredSign` is never used to
recognize a root or infer loader provenance. It is only an input to effective
orientation:

```text
authoredSign = mesh._authoredSign ?? 1
baseOrientation = authoredSign < 0 ? "cw" : "ccw"

if (node.rootState == "promoted-noop") {
    // BJS ExporterState.wasAddedByNoopNode compensation in a Lite LH scene.
    baseOrientation = toggle(baseOrientation)
}

windingMode = baseOrientation == "cw" ? "reverse" : "preserve"
```

`windingMode: "reverse"` swaps the second and third index of every complete
triangle before packing. `"preserve"` copies index order. The output has no
material or `doubleSided` flag, so this final index decision is what preserves
front-face visibility in a standard glTF viewer. `_authoredSign` is the
retained geometry's winding baseline: `+1` maps to the ordinary Lite
counter-clockwise exporter orientation and `-1` maps to the loader-authored
clockwise orientation. It is the same baseline consumed by
`enableMirroredMeshes`, but the exporter does not call `isMirrored`: glTF
retains the node transform, and the glTF determinant rule carries negative
scale parity without another index toggle.

The complete direct truth table is:

| Root state    | `_authoredSign` | base orientation | no-op compensation | final orientation | index action |
| ------------- | --------------: | ---------------- | -----------------: | ----------------- | ------------ |
| ordinary      |            `+1` | ccw              |                 no | ccw               | preserve     |
| ordinary      |            `-1` | cw               |                 no | cw                | reverse      |
| promoted-noop |            `+1` | ccw              |                yes | cw                | reverse      |
| promoted-noop |            `-1` | cw               |                yes | ccw               | preserve     |

Positive- and negative-determinant node transforms use the same table row and
therefore the same index action. This is the direct equivalent of
Babylon.js `_exportIndices` using the mesh/material base `sideOrientation`,
then toggling it when
`wasAddedByNoopNode && !scene.useRightHandedSystem`; Babylon.js does not feed
the runtime determinant-adjusted draw orientation into `_exportIndices`.
Tests must exercise every row with both determinant signs, including
procedural and loader-authored baselines, reparenting, and negative scale.
This explicit algorithm prevents `_authoredSign` from becoming a false root
detector while preserving the Lite convention it was designed to encode.

### Private glTF JSON subset

The serializer writes only these private JSON shapes. Optional fields are
omitted when their values are defaults or when the corresponding capability is
not present.

```ts
interface GltfAssetJson {
    version: "2.0";
    generator: string;
}

interface GltfNodeJson {
    name?: string;
    children?: number[];
    mesh?: number;
    translation?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    matrix?: [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number];
}

interface GltfPrimitiveJson {
    attributes: {
        POSITION: number;
        NORMAL: number;
        TEXCOORD_0?: number;
    };
    indices: number;
}

interface GltfMeshJson {
    name?: string;
    primitives: [GltfPrimitiveJson];
}

interface GltfSceneJson {
    nodes: number[];
}

interface GltfBufferJson {
    byteLength: number;
}

interface GltfBufferViewJson {
    buffer: 0;
    byteOffset?: number;
    byteLength: number;
    target?: 34962 | 34963; // ARRAY_BUFFER | ELEMENT_ARRAY_BUFFER
}

interface GltfAccessorJson {
    bufferView: number;
    byteOffset?: number;
    componentType: 5123 | 5125 | 5126; // USHORT | UINT | FLOAT
    count: number;
    type: "SCALAR" | "VEC2" | "VEC3";
    min?: number[];
    max?: number[];
}

interface GltfDocumentJson {
    asset: GltfAssetJson;
    scene: 0;
    scenes: [GltfSceneJson];
    nodes?: GltfNodeJson[];
    meshes?: GltfMeshJson[];
    buffers?: [GltfBufferJson];
    bufferViews?: GltfBufferViewJson[];
    accessors?: GltfAccessorJson[];
}
```

An empty export is:

```json
{
    "asset": { "version": "2.0", "generator": "Babylon Lite v<version>" },
    "scene": 0,
    "scenes": [{ "nodes": [] }]
}
```

It has no `nodes`, `meshes`, `buffers`, `bufferViews`, or `accessors`
properties. A geometry export adds exactly the structures needed for the
reachable nodes, one mesh and primitive per source mesh, one URI-less buffer,
the buffer views, and the accessors. It emits no materials, textures, images,
samplers, cameras, lights, animations, skins, morph targets, metadata,
`extras`, extensions, `extensionsUsed`, `extensionsRequired`, tangents, UV2,
colors, joints, weights, or instance expansion. The primitive omits `mode`
because triangle-list is the glTF default and omits `material` because v1 is
material-free.

Node names are copied when non-empty. A mesh node's non-empty name is copied to
both its node and its one glTF mesh. `children`, `mesh`, and transform fields
are omitted when absent. Identity TRS values are omitted; a matrix is omitted
only when the emitted matrix is exactly identity. No default-value omission
uses an epsilon other than the explicitly specified no-op-root test.

### Buffer planning and exact packing

There is one logical BIN buffer for a geometry export. For each unique geometry
job, the planner emits streams in this order:

1. converted positions (`FLOAT`, `VEC3`);
2. converted normals (`FLOAT`, `VEC3`);
3. converted UV0 when present (`FLOAT`, `VEC2`);
4. final triangle indices (`UNSIGNED_SHORT` or `UNSIGNED_INT`, `SCALAR`).

Each stream has one tightly packed buffer view and one accessor. An accessor
reference is reused for every primitive that reuses the same geometry job.
There is no interleaving. Stream starts are aligned to the component size:

| Component        | glTF value | Byte size | Alignment |
| ---------------- | ---------: | --------: | --------: |
| `FLOAT`          |     `5126` |         4 |         4 |
| `UNSIGNED_SHORT` |     `5123` |         2 |         2 |
| `UNSIGNED_INT`   |     `5125` |         4 |         4 |

The next stream offset is `align(cursor, componentSize)`. The alignment rule
is component-aware and is not a universal four-byte rule. A buffer view's
`byteOffset` is omitted at zero; its accessor's `byteOffset` is omitted because
each stream starts at the beginning of its view. Attribute views use target
`34962`; the index view uses `34963`.

Position `min` and `max` are computed from the converted position values, in
the order `[x, y, z]`. Normals and UVs do not receive bounds. Counts are
`vertexCount` for positions/normals/UV0 and `indexCount` for indices. The
serializer does not reject non-finite values or out-of-range indices; the
emitted-subset test helper checks valid fixtures and catches those conditions
in tests.

Every scalar is written explicitly little-endian with `DataView` operations
(`setFloat32`, `setUint16`, and `setUint32` with `littleEndian: true`).
Header/chunk integers use the same explicit little-endian rule. The
implementation does not depend on host typed-array byte order and never packs
by mutating the retained source arrays.

### Exact GLB framing

The writer uses these constants:

```ts
const GLB_MAGIC = 0x46546c67; // "glTF"
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a; // "JSON"
const BIN_CHUNK_TYPE = 0x004e4942; // "BIN"
const JSON_SPACE = 0x20;
const BIN_ZERO = 0x00;
```

The JSON object is serialized deterministically with compact
`JSON.stringify`, encoded with `TextEncoder`, and padded to a multiple of four
bytes with ASCII spaces. A geometry BIN payload is padded to a multiple of
four bytes with zero bytes. Chunk lengths include their padding. The 12-byte
header is:

```text
uint32 magic       = 0x46546c67
uint32 version     = 2
uint32 totalLength = Blob byte length
```

An empty export contains the header followed by one JSON chunk and no BIN
chunk. A geometry export contains the header, one JSON chunk, then one BIN
chunk. `buffer.byteLength` describes the logical BIN data, including any
component-alignment gaps but excluding final BIN padding. Consequently it may
be smaller than the BIN chunk payload by zero to three bytes. The GLB total
length includes both chunk headers and all JSON/BIN padding.

The fulfilled object is `new Blob([bytes], { type: "model/gltf-binary" })`.
No URI is written into the one buffer, and no sidecar file is produced.

## Pipeline Configuration

None. The exporter has no WebGPU render or compute pipeline, no shader module,
no bind group, no GPU buffer upload, no device access, and no readback path.
It is ordinary CPU code and is tree-shaken when `exportSceneGLB` is not
referenced.

## Shader Logic

None. There is no WGSL in this feature. The CPU conversion kernel is:

```text
for each vertex (x, y, z):
    if coordinateMode == "lh-to-rh":
        position = (-x, y, z)
        normal   = (-nx, ny, nz)
    else:
        position = (x, y, z)
        normal   = (nx, ny, nz)

copy UV0 without coordinate conversion

for each index triple (a, b, c):
    write (a, c, b) when windingMode == "reverse"
    otherwise write (a, b, c)
```

The kernel writes newly allocated output storage only. It does not normalize
normals, infer topology, expand instances, or inspect materials.

## State Machine / Lifecycle

1. **Entry** - `exportSceneGLB` statically calls the synchronous collector.
   There is no input nominal check and no disposal check.
2. **Collecting** - The seed array, ancestor closure, root candidates, names,
   local/root-world transforms, visibility-independent hierarchy, topology
   markers, geometry references, authored signs, and deterministic indices are
   captured. Missing required CPU data or a current non-triangle topology
   throws a coded error before serialization starts.
3. **Collected** - The private `CollectedGltfScene` is self-contained. It has
   no live scene graph references. Direct CPU-array references remain alive for
   the serializer; no source array is written.
4. **Serializing** - `serializeGlb` allocates converted vertex/index arrays,
   determines stream offsets, writes JSON and logical BIN data, and adds GLB
   padding. Geometry is serialized entirely from the collected snapshot.
5. **Fulfilled** - The promise resolves to the typed GLB Blob. All output bytes
   have been copied, so no source array is retained for asynchronous work.
6. **Rejected** - Any failure that prevents a valid Blob is a coded thrown
   error. There is no partial Blob, warning result, warning logger, retry, or
   disposal action.

Repeated calls on unchanged scene state produce byte-identical JSON ordering,
node/reference indices, stream ordering, and GLB bytes. A later caller may
mutate the scene after collection; that mutation does not alter the already
collected graph or transforms. Concurrent mutation of retained CPU arrays is
not a promised snapshot mode.

## Babylon.js Equivalence Map

The current Babylon.js glTF exporter is the behavioral golden for every
ambiguous conversion, root, orientation, and framing decision. Lite
re-expresses the behavior with its plain-data contracts and does not copy
Babylon.js code.

| Babylon.js core behavior                                    | Upstream conceptual location                                                                                                                              | Lite contract                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Async GLB orchestration (`GLBAsync` and `generateGLBAsync`) | `GLTF2Export.GLBAsync` in `glTFSerializer.ts` and `GLTFExporter.generateGLBAsync` in `glTFExporter.ts`                                                    | One public `exportSceneGLB` seam, synchronous collection, asynchronous `serializeGlb`, and one Blob.                                                                                                                                                                                              |
| Exporter state and identity reuse                           | `ExporterState` in `glTFExporter.ts`                                                                                                                      | `CollectedGltfScene`, ordered arrays, and a lookup-only identity map keyed by `_gpu` plus coordinate/winding mode. No map iteration determines output.                                                                                                                                            |
| No-op conversion-root recognition                           | `IsNoopNode` in `packages/dev/serializers/src/exportUtils.ts`                                                                                             | Structural transform-only/no-`_gpu` test against `C` with `0.001` tolerance. Names do not participate.                                                                                                                                                                                            |
| No-op-root removal and promoted-child state                 | `removeNoopRootNodes` handling in `_exportSceneAsync`, including `wasAddedByNoopNode`                                                                     | Remove only a passing graph root, promote selected children, assign `"already-rh"`, retain wrappers, and apply the explicit orientation compensation.                                                                                                                                             |
| Node transform conversion                                   | `_setNodeTransformation`, `ConvertToRightHandedPosition`, `ConvertToRightHandedRotation`, and `ConvertToRightHandedTransformMatrix` in `glTFUtilities.ts` | Negate X for translations/attributes, conjugate matrices with `C`, convert quaternions by the equivalent basis change, and preserve scale including negative components. Ordinary hierarchy nodes stay local; only a selected root below an omitted non-`SceneNode` parent snapshots world space. |
| Attribute conversion and position bounds                    | `_exportBuffers`, `_exportVertexBuffer`, `GetMinMax`, and `GetAccessorType`                                                                               | CPU positions/normals are converted in newly allocated arrays, UV0 is optional and unchanged, position min/max use converted values, and only the v1 attributes are typed.                                                                                                                        |
| Effective orientation and index export                      | `_getEffectiveOrientation` and `_exportIndices` in `glTFExporter.ts`                                                                                      | Map Lite `_authoredSign ?? 1` to Babylon.js's base side orientation, toggle for a removed no-op root, and reverse complete triangle triples exactly according to the truth table. Negative determinant remains represented by the exported node transform.                                        |
| Buffer planning and binary writes                           | `BufferManager.createBufferView`, `createAccessor`, `generateBinary`, and `DataWriter`                                                                    | One logical buffer, one tightly packed stream view/accessor per unique job, component-size alignment, explicit little-endian writes, and JSON/BIN padding rules.                                                                                                                                  |
| Exporter extensions                                         | `IGLTFExporterExtensionV2`, material/texture/camera/light/animation/skin/morph exporters, and all `KHR_*`/`EXT_*` exporter modules                        | Grouped deferred work. V1 emits no extension declarations or extension payload, and contains no extension-specific branch.                                                                                                                                                                        |

Babylon.js behavior therefore resolves the conversion direction, quaternion
basis/sign behavior, no-op-root promotion, effective-orientation toggle, and
position-bounds timing. Lite deliberately differs in two container details:
Babylon.js currently includes an empty BIN chunk and uses
`application/octet-stream`; Lite follows the GLB recommendation to omit an
empty BIN chunk and returns `model/gltf-binary`. Lite also narrows the payload
to the emitted subset rather than pretending to implement the upstream
material, animation, camera, skin, morph, or extension surface.

## Dependencies

Production dependencies are static and minimal:

- `SceneContext` type from `scene/scene-core.ts`;
- `Mesh` and its retained CPU fields / opaque `_gpu` identity from
  `mesh/mesh.ts`;
- `SceneNode` and `_localMatrix`/TRS contracts from `scene/scene-node.ts`;
- `mat4Compose` and `mat4Multiply` (or equivalent existing math helpers) for
  local snapshots and matrix conjugation;
- `VERSION` from `engine/version.ts` for the exact generator string
  `Babylon Lite v${VERSION}`;
- the existing coded-error rewrite convention used by Lite's
  `throw new Error(...)` call sites; no new error or warning framework;
- standard platform `Blob`, `TextEncoder`, `DataView`, and typed arrays.

The exporter does not import an engine, loader feature registry, material,
resource, WebGPU, DOM, download, validator, or `getMeshGeometry` module. It
adds no runtime, development, peer, or test dependency. The only package
integration is this static root re-export:

```ts
export { exportSceneGLB } from "./export-gltf/export-scene-glb.js";
```

No package subpath export, dynamic import, module-level mutable cache, import
registration, or core scene/mesh/loader/material behavior is added.

## Test Specification

### Production test seam and emitted-subset helper

Every production test calls only `exportSceneGLB(scene)` and observes either
the returned `Blob` bytes/type or a thrown coded error. Tests do not import or
assert `CollectedGltfScene`, `CollectedGltfGeometryJob`, `serializeGlb`, or
any other private shape.

`tests/lite/unit/gltf-exporter-subset.ts` is a hand-written parser/assertion
helper, not a full glTF validator. Given public Blob bytes, it must assert:

- GLB magic, version, total length, chunk order, little-endian integers, JSON
  chunk UTF-8 decoding, JSON space padding, BIN zero padding, and chunk
  lengths including padding;
- empty JSON-only output has exactly `asset`, `scene`, and `scenes`, has no BIN
  chunk, and has no buffers, bufferViews, or accessors;
- geometry output has exactly one URI-less buffer, exactly one JSON chunk and
  one BIN chunk, `buffer.byteLength` equal to logical BIN bytes, and logical
  length no more than three bytes below padded BIN length;
- all node, mesh, primitive, accessor, bufferView, and scene references are in
  range and reachable from the default scene; no emitted node is orphaned;
- names, parent/child reachability, transform representations, one mesh and
  one primitive per source Mesh, and no material/extension/omitted-content
  declarations;
- attributes are exactly POSITION/NORMAL and optional TEXCOORD_0; positions
  and normals are FLOAT VEC3, UV0 is FLOAT VEC2, indices are unsigned SCALAR,
  counts match the fixture, and accessor/bufferView offsets obey component
  alignment;
- decoded position `min`/`max` equals the converted values and every fixture
  triangle index is within the fixture's vertex range;
- shared geometry uses the same accessor references, while equal bytes on
  different `_gpu` identities do not share.

The helper deliberately does not claim general glTF conformance and adds no
validator dependency.

### Direct public-Blob cases

`tests/lite/unit/gltf-exporter.test.ts` must cover, through the public seam:

1. An empty scene: JSON-only GLB, empty default scene, MIME, generator/version,
   and no binary structures.
2. An asymmetric procedural triangle with no UV: ordinary LH-to-RH position
   and normal X conversion, transformed node values, exact indices, position
   bounds, and omission of TEXCOORD_0.
3. The same geometry with UV0: FLOAT VEC2 values and the exact attribute set.
   A loaded primitive that omitted UV0 but retains the loader's zero-filled
   array emits those zeros, documenting current-state rather than source-state
   semantics.
4. Transform-only ancestors, names, child order, mesh wrappers, and omission
   of unrelated empty/unindexed nodes. Set visibility false and attach
   metadata; assert no output or warning behavior changes.
5. A mesh whose nearest selected `SceneNode` ancestor is parented to a light or
   camera: omit the semantic parent and emit the selected child as a matrix
   root with its current world placement.
6. A transform-only root whose name is not `"__root__"` and whose world matrix
   is `C`: root removal, child promotion, unchanged already-RH child
   transform/attributes, and preserved wrapper node.
7. A root named `"__root__"` that is not structurally `C`: root remains and
   receives ordinary LH-to-RH conversion. This is the direct name-independence
   test.
8. All four rows of the winding truth table above, each under positive- and
   negative-determinant node transforms. Cover `_authoredSign` `+1` and `-1`,
   ordinary and promoted roots, reparenting, and negative scales. Assert index
   order and decoded face visibility, not only that export succeeds.
9. Shared `_gpu` identity with equal coordinate/winding modes: two glTF mesh
   objects but one set of attribute/index accessors. Use separate `_gpu`
   identities containing byte-identical arrays to prove no byte-comparison
   deduplication. Use the same identity with a different conversion or final
   winding mode to prove a separate job.
10. Index selection at the exact boundaries: max index `65534` with 65535
    vertices uses `UNSIGNED_SHORT`; max index `65535` or 65536 vertices uses
    `UNSIGNED_INT`; no primitive-restart sentinel is accepted for the short
    path.
11. A current `_topology` marker for a non-triangle mesh throws a coded error.
    Missing positions, normals, or indices throws a coded error naming the
    affected mesh. No partial Blob and no warning collection/logger exist.
12. Skeleton, morph, VAT, and thin-instance fields present: base geometry only,
    no extra attributes, no skin/morph/extension JSON, and no instance
    expansion.
13. Repeated export of unchanged state yields byte-identical Blobs. Copy all
    retained arrays before export and compare them after fulfillment; no source
    graph, transform, or CPU array is changed. A first read may populate an
    existing interleaved de-stride cache, which is explicitly exempt.

The tests must not add a runtime nominal-input or disposal-flag assertion as a
production requirement. A disposed flag, when a valid retained mesh remains
exportable, is not inspected by the public entry point.

### Re-import smoke

Exactly one focused plumbing test,
`tests/lite/plumbing/gltf-exporter-reimport.spec.ts`, creates a small live
scene, calls the public Blob seam, awaits the Blob, passes that Blob to
`loadGltf(engine, blob)`, and verifies that the returned asset loads and has
the expected reachable mesh hierarchy. This is only a loadability smoke
signal; it is not a source-preserving round-trip promise.

### Combined numbered parity scene

The current next free numbered scene is `scene283`. It is one combined scene,
not a collection of separate parity fixtures. It contains:

- visibly asymmetric triangle/box geometry so X reflection and winding errors
  cannot hide;
- an ordinary LH root with a positive-scale parent;
- a second branch with a negative-scale parent;
- a quaternion-driven transform hierarchy;
- a transform-only, arbitrarily named root with world matrix `C`, containing
  a mesh wrapper so the sniffed-root/already-RH path is exercised;
- a direct `exportSceneGLB` call, followed by re-import of the Blob into the
  Lite display scene before the screenshot.

The planned BJS reference page builds the equivalent source hierarchy and uses
the current Babylon.js GLB exporter once to create the one-time reference
golden. The planned Lite page builds the independently written equivalent,
calls the public Lite exporter, re-imports its Blob, and renders only the
re-imported result. The Babylon.js page is not opened by runtime parity tests;
the BJS golden is captured once and then immutable. No upstream playground
source or image is copied.

The parity spec uses the existing focused scene harness and its approved MAD
threshold. It does not change an existing golden, threshold, bundle ceiling,
or unrelated per-scene manifest. Local implementation validation remains
focused; CI owns the full parity and scene suite.

### Separate download demo and manual viewer gate

`demo-gltf-exporter` is separate from `scene283`. Its lab-only TypeScript calls
the public Blob seam, displays byte length/MIME and a small JSON summary, and
uses DOM download behavior only in that demo. It has its own catalog entry in
`demos-config.json`, a `demo-gltf-exporter.jpg` thumbnail, and a generated
`lab/public/bundle/demos-manifest.json` entry with raw and gzip measurements.
The demo does not add download code to the package.

One manual gate records whether a downloaded Blob opens without modification in
an independent external glTF viewer. The judgment is separate from the
emitted-subset helper and is not presented as structural conformance proof.

### Focused validation and CI boundary

Implementation validation may run the focused exporter unit/plumbing tests,
the focused re-import smoke, TypeScript/lint checks for changed source, a
tree-shaking check proving an unused consumer pays no exporter runtime bytes,
and filtered scene/demo bundle measurements. The filtered scene283 build must
produce `lab/public/bundle/manifest/scene283.json`; its measured raw runtime
bytes establish a new additive `maxRawKB` ceiling in `scene-config.json`, which
must be explicitly approved before commit. Existing ceilings are not changed.
Implementation validation must not run `pnpm test`, full `pnpm test:parity`,
an unfiltered scene bundle, or performance tests. Visual parity, full scene
coverage, and the final MAD gate remain CI/user checks. No unrelated manifest
is regenerated.

## File Manifest

The following is the exact planned add/update manifest for implementation.
This documentation-only change does not assert that any path below already
exists or has been created.

| Planned path                                                   | Role                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `packages/babylon-lite/src/export-gltf/export-scene-glb.ts`    | Public wrapper with the exact `exportSceneGLB` signature.                                                                |
| `packages/babylon-lite/src/export-gltf/collect-gltf-scene.ts`  | Private synchronous closure, root normalization, snapshots, topology checks, and geometry identity jobs.                 |
| `packages/babylon-lite/src/export-gltf/gltf-conversion.ts`     | Private `C` conversion, quaternion/matrix conversion, authored orientation, no-op compensation, and index winding.       |
| `packages/babylon-lite/src/export-gltf/gltf-json.ts`           | Private emitted-subset JSON interfaces and GLB/component constants.                                                      |
| `packages/babylon-lite/src/export-gltf/glb-serializer.ts`      | Private stream planner, little-endian writer, JSON/BIN padding, and Blob assembly.                                       |
| `packages/babylon-lite/src/index.ts`                           | One static tree-shakable root re-export; no package subpath.                                                             |
| `tests/lite/unit/gltf-exporter-subset.ts`                      | Public-Blob emitted-subset parser/assertion helper, explicitly not a full validator.                                     |
| `tests/lite/unit/gltf-exporter.test.ts`                        | Focused public seam Blob, determinism, geometry, root, winding, errors, and omission tests.                              |
| `tests/lite/plumbing/gltf-exporter-reimport.spec.ts`           | The single re-import smoke test.                                                                                         |
| `lab/lite/src/bjs/scene283.ts`                                 | Independently authored Babylon.js source for the combined parity scene.                                                  |
| `lab/lite/src/lite/scene283.ts`                                | Independently authored Lite source exercising both root states and the public Blob seam.                                 |
| `lab/lite/babylon-ref-scene283.html`                           | One-time Babylon.js golden capture page.                                                                                 |
| `lab/lite/scene283.html`                                       | Lite runtime parity page.                                                                                                |
| `lab/lite/bundle-scene283.html`                                | Filtered Lite bundle-size entry for scene283.                                                                            |
| `tests/lite/parity/scenes/scene283-gltf-exporter.spec.ts`      | Focused scene283 parity spec; runtime opens Lite only.                                                                   |
| `scene-config.json`                                            | New scene283 catalog, MAD threshold, and explicitly approved additive `maxRawKB` ceiling; no existing threshold changes. |
| `lab/public/bundle/manifest/scene283.json`                     | Filtered runtime-fetched bundle manifest for the new scene.                                                              |
| `reference/lite/scene283-gltf-exporter/babylon-ref-golden.png` | Immutable one-time Babylon.js golden.                                                                                    |
| `lab/public/thumbnails/scene283.jpg`                           | 1280x720 JPG scene thumbnail derived from the golden.                                                                    |
| `lab/lite/demo-gltf-exporter.html`                             | Separate cataloged exporter/download demo page.                                                                          |
| `lab/lite/src/demos/gltf-exporter.ts`                          | Demo-only Blob display and download interaction.                                                                         |
| `demos-config.json`                                            | Separate `gltf-exporter` demo catalog entry.                                                                             |
| `lab/public/thumbnails/demo-gltf-exporter.jpg`                 | Demo JPG thumbnail.                                                                                                      |
| `lab/public/bundle/demos-manifest.json`                        | Generated demo raw/gzip measurement entry.                                                                               |
| `docs/lite/architecture/53-gltf-exporter.md`                   | This one-shot architecture contract.                                                                                     |
