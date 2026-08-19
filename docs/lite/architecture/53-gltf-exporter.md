# Module: glTF 2.0 Exporter

> Package path: `packages/babylon-lite/src/export-gltf/`

---

## Purpose

`exportSceneAsGlb` serializes a `SceneContext` into a single binary glTF 2.0 (`.glb`) `Blob`: one JSON chunk, one binary chunk, images embedded as bufferViews. It is the inverse of `loadGltf`. 

---

## Public API Surface

### Entry point — `export-gltf.ts`

```typescript
export async function exportSceneAsGlb(scene: SceneContext): Promise<Blob>;
```

Semantics:

- **Read-only.** The scene renders identically before and after the call.
- **Complete capture.** Every mesh, punctual light, the camera, and every glTF-clip animation group exports — including transform hierarchies referenced only by animation channels (see Root collection). There is no filter parameter; callers restructure the scene before exporting. The current pose is captured: node TRS, thin-instance matrices, and morph weights export as they are at call time.
- **Deterministic.** Two calls on an unchanged scene resolve to byte-identical Blobs.
- **Errors.** Recoverable issues log `console.warn` and degrade per the rules in this document. The promise rejects only for the conditions in Warnings & Errors.
- **Concurrency.** Calls are independent; shared caches are per-call.

---

## Internal Architecture

Round-tripping is a design goal: artifacts the loader inserts (the `__root__` conversion node, camera fixup nodes, factor-baked 1×1 textures) are recognized and removed on export, so `loadGltf → exportSceneAsGlb → loadGltf` reproduces the source structure.

The module handles three main concerns:

1. **Handedness.** Lite scenes are left-handed; glTF is right-handed with CCW front faces and −Z-forward cameras and lights. The exporter bakes the conversion into vertex data, transforms, instance matrices, and animation curves. Content loaded from glTF still carries right-handed data under the loader's mirror root; it is detected and passed through unchanged.
2. **Material mapping.** `PbrMaterialProps` is already glTF-shaped, so PBR export inverts the loader's import mappings field by field. `StandardMaterialProps` is converted to metallic-roughness with the Babylon.js conversion formulas.
3. **Sharing.** Geometry, materials, images, samplers, and accessors are deduplicated in the output, matching the sharing the loader and engine maintain at runtime.

### Design rules

- **Opt-in by import.** The exporter is reached only through the root export `exportSceneAsGlb`. No module in `export-gltf/` runs code at import time, and there is no global registry; extension writers are a static ordered list. Scenes without the import carry zero exporter bytes.
- **Read-only.** The exporter reads plain-data interfaces and mutates nothing. All conversions act on copies. GPU work is limited to texture readback and is transient.
- **Omit defaults.** Values equal to their glTF defaults are omitted (see the consolidated table). Materials, textures, images, samplers, cameras, and skins are emitted only when referenced.
- **Warn and continue.** Content outside the exportable set logs a `console.warn` and degrades to a defined fallback. Throws are limited to the cases listed in Warnings & Errors.
- **Deterministic.** The same scene exports to a byte-identical GLB: stable traversal order, insertion-ordered maps, fixed writer order, no time- or randomness-dependent output.

### Inputs read from the scene

This table is the exporter's full input surface. Extending the exporter starts by adding a row here.

| Source | Fields read |
| --- | --- |
| `SceneContext` | `surface` (engine via `surface.engine`), `meshes`, `lights`, `camera`, `animationGroups` |
| `SceneNode` (incl. `TransformNode`, `Mesh`) | `name`, `children`, `parent`, `position`, `rotationQuaternion`, `scaling`, `_localMatrix`, `metadata.gltf.extras`, `_gltfNodeIndex` |
| `Mesh` | the above, plus `material`, `_authoredSign`, `_topology`, `_primitive`, `_cpuPositions`, `_cpuNormals`, `_cpuTangents`, `_cpuUvs`, `_cpuUv2s`, `_cpuColors`, `_cpuGpuIndices`, `_cpuIndexFormat`, `_cpuIndices`, `skeleton`, `morphTargets`, `thinInstances` |
| `SkeletonData` | `joints`, `weights`, `joints1`, `weights1`, `_sourceSkin` |
| `MorphTargetData` | `targets`, `weights`, `count` |
| `ThinInstanceData` | `matrices`, `count`, `colors` |
| `Material` | `name`, `metadata.gltf.extras`, `_buildGroup._materialFamily`, and per-family props below |
| `PbrMaterialProps` | `baseColorTexture`, `baseColorFactor`, `alpha`, `alphaBlend`, `_alphaCutOff`, `doubleSided`, `metallicFactor`, `roughnessFactor`, `ormTexture`, `occlusionStrength`, `occlusionTexture`, `occlusionTexCoord`, `normalTexture`, `normalTextureScale`, `emissiveTexture`, `_emissiveColor`, `specGlossTexture`, `reflectance`, `_unlit`, `_unlitColor`, `_clearCoat`, `_sheen`, `_iridescence`, `_anisotropy`, `_subsurface`, `_specularWeight`, `_metallicReflectanceColor`, `_metallicReflectanceTexture`, `_reflectanceTexture` |
| `StandardMaterialProps` | `diffuseColor`, `alpha`, `specularPower`, `emissiveColor`, `diffuseTexture`, `diffuseCoordIndex`, `_emissiveTexture`, `_bumpTexture`, `bumpLevel`, `_ambientTexture`, `ambientCoordIndex`, `_opacityTexture`, `alphaCutOff`, `uvScale`, `uvOffset`, `backFaceCulling`, `disableLighting` |
| `Texture2D` | `texture`, `sampler`, `width`, `height`, `uScale`, `vScale`, `uOffset`, `vOffset`, `uAng`, `_texCoord`, `_recoverySource` |
| `LightBase` (+ concrete types) | `lightType`, `parent`, `position`, `direction`, `diffuse`, `intensity`, `range`, `angle`, `exponent` |
| `Camera` (`ArcRotateCamera` / `FreeCamera`) | `name`, `worldMatrix`, `parent`, `fov`, `nearPlane`, `farPlane`, `ortho` (`left`, `right`, `top`, `bottom`, `halfHeight`) |
| `AnimationGroup` | `name`, `_gltfMixer`, `targetedAnimations` |
| `EngineContext` | `_device` (readback), primary surface canvas `width`/`height` (camera aspect), sampler pool (descriptor recovery), `VERSION` (generator string) |

State outside this table is not part of the current input contract; the corresponding glTF output is absent from the file, without a warning, unless a rule below says otherwise.

### Module map

One module per glTF entity, plus helpers for concerns that cut across entities. Modules communicate only through the `ExportContext`; entity modules import helpers, and the entry orchestrates.

```
export-gltf/
  export-gltf.ts                          entry: exportSceneAsGlb, root partitioning, JSON assembly
  export-context.ts                       ExportContext, MaterialExtensionWriter, warn helper
  export-handedness.ts                    LH↔RH math: positions, quaternions, matrices, winding rule
  export-buffers.ts                       BufferBuilder: bufferViews, accessors, alignment, min/max
  export-glb.ts                           GLB container framing → Blob
  export-nodes.ts                         node traversal, TRS/matrix emission, mesh grouping
  export-geometry.ts                      primitives, attributes, indices, morph targets, dedup
  export-materials.ts                     material dispatch, PBR core, Standard→MR, writer sweep
  export-textures.ts                      texture/sampler funnel, sampler recovery, textureInfo
  export-images.ts                        image bytes: retained sources, GPU readback, PNG encode
  export-cameras.ts                       camera node and projection
  export-skins.ts                         skins, inverse bind matrices, joint resolution
  export-animations.ts                    animation groups → glTF animations
  ext/export-ext-lights-punctual.ts       KHR_lights_punctual
  ext/export-ext-instancing.ts            EXT_mesh_gpu_instancing
  ext/export-ext-texture-transform.ts     KHR_texture_transform
  ext/export-ext-unlit.ts                 KHR_materials_unlit
  ext/export-ext-emissive-strength.ts     KHR_materials_emissive_strength
  ext/export-ext-clearcoat.ts             KHR_materials_clearcoat
  ext/export-ext-sheen.ts                 KHR_materials_sheen
  ext/export-ext-iridescence.ts           KHR_materials_iridescence
  ext/export-ext-anisotropy.ts            KHR_materials_anisotropy
  ext/export-ext-ior.ts                   KHR_materials_ior
  ext/export-ext-specular.ts              KHR_materials_specular
  ext/export-ext-transmission.ts          KHR_materials_transmission
  ext/export-ext-volume.ts                KHR_materials_volume
  ext/export-ext-dispersion.ts            KHR_materials_dispersion
  ext/export-ext-diffuse-transmission.ts  KHR_materials_diffuse_transmission
  ext/export-ext-spec-gloss.ts            KHR_materials_pbrSpecularGlossiness
```

The 13 material writers are assembled into `const MATERIAL_EXTENSION_WRITERS: readonly MaterialExtensionWriter[]` in `export-materials.ts`, in the order listed (unlit → emissive-strength → clearcoat → sheen → iridescence → anisotropy → ior → specular → transmission → volume → dispersion → diffuse-transmission → spec-gloss). The order is part of the output contract: it fixes `extensionsUsed` ordering, and later writers see earlier writers' output (spec-gloss runs last because it edits core metallic-roughness fields).

Internal imports are static. The tree-shaking boundary is the feature itself: scenes without the exporter import carry zero of its bytes.

### Loader-retained seams

Two `@internal` fields, stamped by the glTF loader at load time, carry source-file identity the exporter needs. Both are plain data with no imports, like the existing `Mesh._authoredSign` stamp:

| Field | Stamped by | Contents |
| --- | --- | --- |
| `SceneNode._gltfNodeIndex?: number` | `load-gltf.ts` `buildNode` | The glTF source node index this node was built from. Resolves animation channels and skin joints (which reference source indices) to live nodes. Indices are per source file; the exporter scopes resolution per collected root (see Root collection). |
| `SkeletonData._sourceSkin?: { jointNodes: readonly number[]; inverseBindMatrices: Float32Array }` | `gltf-feature-skeleton.ts` `applyMesh` | The skin's joint list and inverse bind matrices, retained as views into the loaded buffer. |


### Internal contract types — `export-context.ts`

```typescript
/** Per-call state shared by every export module. Discarded when the call resolves. */
export interface ExportContext {
    readonly engine: EngineContext;
    /** The glTF document under construction. */
    readonly gltf: GltfRoot;
    readonly buffers: BufferBuilder;
    /** SceneNode | Mesh | LightBase | Camera → glTF node index. */
    readonly nodeIndex: Map<object, number>;
    /** Per collected root: glTF source node index → live SceneNode (from
     *  `_gltfNodeIndex` stamps). Indices are per source file, so scoping by
     *  root keeps two loaded assets from colliding on the same index. */
    readonly sourceNodes: Map<SceneNode, Map<number, SceneNode>>;
    readonly materialIndex: Map<Material, number>;
    /** One glTF image per GPUTexture. */
    readonly imageIndex: Map<GPUTexture, number>;
    /** `${imageIndex}:${samplerIndex}` → glTF texture index. */
    readonly textureIndex: Map<string, number>;
    /** Sampler parameter tuple → glTF sampler index. */
    readonly samplerIndex: Map<string, number>;
    /** (typed array identity, conversion variant) → accessor index. */
    readonly accessorIndex: Map<ArrayBufferView, Map<string, number>>;
    /** Primitive-list signature → glTF mesh index. */
    readonly meshIndex: Map<string, number>;
    readonly extensionsUsed: Set<string>;
    readonly extensionsRequired: Set<string>;
    /** Logs each distinct message once per call. */
    warn(message: string): void;
}

/** One glTF material extension writer. Writers form a static ordered array in
 *  export-materials.ts. */
export interface MaterialExtensionWriter {
    /** glTF extension name, e.g. "KHR_materials_clearcoat". */
    readonly name: string;
    /** When the material carries this extension's state: attach
     *  `out.extensions[name]`, export any textures through ctx, return true.
     *  Returning true records the name in ctx.extensionsUsed. */
    write(ctx: ExportContext, material: PbrMaterialProps, out: GltfMaterial): Promise<boolean> | boolean;
}
```

`exportSceneAsGlb` is the only public root export. The contract types are exported for tests and future writers, tagged `@internal` where they expose engine internals. Both are re-exported by name from `packages/babylon-lite/src/index.ts` (root-only export map, pillar 4e).

### `BufferBuilder` — `export-buffers.ts`

- `addBufferView(bytes, byteStride?, target?)` records a bufferView with a deferred `byteOffset` and returns its index. Identical inputs (same array identity, stride, target) return the same index.
- `addAccessor(desc)` records an accessor referencing a bufferView index, with `componentType`, `count`, `type`, and optional `byteOffset`, `normalized`, `min`, `max`.
- `finalize()` orders bufferViews by descending alignment need (`byteLength % 4 === 0` → 4, `% 2 === 0` → 2, else 1 — the Babylon.js packing rule), concatenates with 4-byte padding, assigns offsets, and returns the single binary chunk. All data targets `buffers[0]`.

`min`/`max` are computed per component over the converted data for every `POSITION` attribute accessor, every morph-target `POSITION` accessor, and every animation input accessor — the places the glTF specification requires them.

### Root collection and partitioning — `export-gltf.ts`

1. Walk `parent` chains upward from every mesh, every exportable light, the camera, and every animation-bound node — each `targetedAnimations[].target` of a `_gltfMixer` group that is a `SceneNode`. Collect distinct roots in first-encounter order (meshes, then lights, then camera, then animation targets). Hierarchy fidelity assumes entities were added through `addToScene`, which resolves parent links. Seeding from bound targets keeps channel-only hierarchies — e.g. an animated meshless `TransformNode` root — in the export.
2. Sweep each collected root's hierarchy once, recording `_gltfNodeIndex` stamps into that root's own `sourceNodes` map. Channel and joint resolution never crosses roots, so two loaded assets cannot collide on their per-file indices.
3. Partition each root:
   - A root matching the **loader conversion root** — a `TransformNode` with no geometry, `position ≈ (0,0,0)`, `rotationQuaternion ≈ identity`, `scaling ≈ (−1,1,1)` (ε = 0.001), and targeted by no `_gltfMixer` channel (no `targetedAnimations[].target` of any group binds it; the loader builds those bindings from the same node map channel resolution uses) — is **stripped**. Its children export in the **pass-through** state. This inverts `createTransformNode("__root__", 0,0,0, 0,0,0,1, −1,1,1)` in `load-gltf.ts`.
   - Every other root exports in the **converting** state.
4. Each set exports depth-first. Root node indices concatenate into `scenes[0].nodes`.

A per-pass `convert: boolean` flag rides on the recursion. Every spatial emission site (TRS, vertex data, instance matrices, IBMs, camera and light orientation, animation samples) branches on it once.

---

## Coordinate-System Policy

Lite is left-handed, column-major (module 21). glTF is right-handed, Y-up, CCW front faces, −Z-forward cameras and lights. Converting passes bake a mirror across the YZ plane (negate X). Pass-through passes hold right-handed data already and emit it verbatim, which keeps load→export round trips byte-stable.

Let `C = diag(−1, 1, 1, 1)`, so `C⁻¹ = C`.

### Vertex data (converting passes)

On copied arrays: negate component 0 of every `POSITION`, `NORMAL`, and `TANGENT` element, and of every morph position/normal delta. Renormalize `NORMAL` and `TANGENT` xyz (zero-length vectors left as-is). UVs, colors, joints, and weights are untouched. Pass-through passes copy attribute bytes verbatim, with no renormalization.

### Transforms

- **Translation**: `(x, y, z) → (−x, y, z)`.
- **Rotation**: `q′ = quat(C · mat(q) · C⁻¹)`, implemented with the Babylon.js sign-pattern form, which also keeps the largest component positive: pick the pivot component (the larger of |x|, |y| when `x² + y² > 0.5`, else the larger of |z|, |w|), take `s = sign(pivot)`, make the pivot absolute, and flip the other three components — x-pivot: `(|x|, −s·y, −s·z, s·w)`; y-pivot: `(−s·x, |y|, s·z, −s·w)`; z-pivot: `(−s·x, s·y, |z|, −s·w)`; w-pivot: `(s·x, −s·y, −s·z, |w|)`.
- **Scale**: unchanged.
- **Matrices** (`_localMatrix` nodes, inverse bind matrices): `M′ = C · M · C`.

### Winding order

glTF requires CCW front faces. Lite renders with CCW front faces (mirrored glTF content compensates with a `"cw"` pipeline state stamped at load), and `Mesh._authoredSign` records which determinant sign the geometry was wound for (−1 for glTF-loaded meshes; unset counts as +1). Per primitive:

| Pass | `_authoredSign` | Index order |
| --- | --- | --- |
| converting | any | reversed — triangles emitted as `(i₀, i₂, i₁)` |
| pass-through | `−1` | verbatim |
| pass-through | `+1` / unset | reversed |

Reversal happens on a copy. A triangle-strip primitive (`_topology` 4 or `_primitive.topology` `"triangle-strip"`) with a required reversal throws (`Triangle strip winding reversal is not implemented`). Point and line topologies emit verbatim.

### Cameras

Converting passes post-multiply the camera's converted rotation by a 180° turn about Y: `Rotate180Y(q): (x, y, z, w) → (−z, w, x, −y)`. Lite cameras look along +Z; glTF cameras look along −Z. Pass-through cameras skip both steps.

### Lights

A glTF punctual light shines down its node's −Z. Converting passes mirror the light's direction, then derive the node rotation as the unit quaternion rotating `(0, 0, −1)` onto the normalized direction (identity when equal; a 180° turn about any perpendicular axis when opposite). Positions convert like translations.

### Animation samples

When a channel's target node exports in a converting pass: `translation` outputs negate X per key; `rotation` outputs apply the quaternion change of basis per key (plus `Rotate180Y` for the camera); `scale` and `weights` pass through. Channels targeting pass-through nodes emit verbatim.

---

## Order of Operations

1. Create the `ExportContext` (engine = `scene.surface.engine`): document root `{ asset: { generator: "Babylon Lite v" + VERSION, version: "2.0" } }`, empty arrays and caches.
2. Collect and partition roots; sweep each root's hierarchy for `_gltfNodeIndex` stamps into its per-root `sourceNodes` map.
3. Node passes: `export-nodes.ts` recurses depth-first per root set. Nodes pull meshes (`export-geometry.ts`), meshes pull materials (`export-materials.ts`), materials pull textures and images.
4. Camera: `export-cameras.ts` emits `scene.camera` when set.
5. Lights: `ext/export-ext-lights-punctual.ts` emits each point, directional, and spot light.
6. Skins: `export-skins.ts` runs over exported meshes carrying `skeleton`; patches `node.skin`.
7. Animations: `export-animations.ts` emits one glTF animation per exportable group.
8. Extension bookkeeping: `extensionsUsed` / `extensionsRequired` arrays from the context sets; the lights writer attaches `gltf.extensions.KHR_lights_punctual.lights`.
9. `buffers.finalize()` → binary chunk; `buffers: [{ byteLength }]` written only when the chunk has bytes.
10. JSON assembly: only non-empty top-level arrays; `scenes` and `scene: 0` only when at least one node exported. Top-level members serialize in the fixed order `asset`, `extensionsUsed`, `extensionsRequired`, `extensions`, `scene`, `scenes`, `nodes`, `meshes`, `materials`, `textures`, `images`, `samplers`, `cameras`, `skins`, `animations`, `accessors`, `bufferViews`, `buffers`, so byte output is reproducible across reimplementations, not just across calls.
11. `export-glb.ts` frames JSON and binary; resolves `new Blob([glb], { type: "model/gltf-binary" })`.

Image readback promises from step 3 are awaited before step 9.

---

## Scene & Node Export — `export-nodes.ts`

Depth-first per root set. Per `SceneNode`:

1. **Dedup.** `nodeIndex` maps each live object to one glTF node; a revisit links the existing index into the current parent's `children`.
2. **Create.** `node.name` from `sceneNode.name` (when non-empty); `node.extras` from `metadata.gltf.extras` (when present) — the inverse of the loader's `ExtrasAsMetadata` promotion.
3. **Transform.** When `_localMatrix` is set (a glTF `matrix` node), emit `node.matrix` — converted `C·M·C` in converting passes, verbatim in pass-through — omitted when ≈ identity. Otherwise emit TRS from `position` / `rotationQuaternion` / `scaling`, converted per the policy, each omitted within ε = 0.001 of its default (`[0,0,0]`, `[0,0,0,1]`, `[1,1,1]`). Exported rotations are normalized.
4. **Mesh assembly.** Only a `TransformNode` absorbs: its `Mesh` children fold into this node's mesh, one primitive each, in child order — the inverse of the loader attaching one Lite `Mesh` per glTF primitive under a node — when each folding child has identity TRS, no children of its own, and agrees with the already-folded siblings on `skeleton` identity (or none), `thinInstances` identity (or none), and morph-target count plus current `weights` (`node.skin`, `EXT_mesh_gpu_instancing`, and `mesh.weights` are single-valued per node/mesh; loader output always satisfies these fences). A child failing a fence, a `Mesh` with a non-identity transform or with children (a `Mesh` node never absorbs), and a standalone `Mesh` root each become their own node with a single-primitive mesh. A folded mesh is recorded in `nodeIndex` against the absorbing node's index, so animation channels, skins, and parent-attachment rules resolve to the holding node. `mesh.name` and the glTF mesh's `extras` come from the first contributing mesh that carries each; later contributors' values are ignored.
5. **Mesh dedup.** The primitive list is signature-keyed (attribute accessors, index accessor, material, mode, morph-target accessors, weights, in order). An identical signature reuses the existing glTF mesh — nodes sharing loader-shared geometry and materials reference one mesh.
6. **Children** are written only when non-empty.

Nodes export regardless of `visible`; visibility is runtime presentation state.

---

## Geometry Export — `export-geometry.ts`

### Attributes

One glTF primitive per Lite `Mesh`. Data comes from the retained CPU arrays (interleaved glTF meshes materialize tight copies through their lazy de-stride getters, as picking and CSG already do):

| glTF attribute | Source | Type / componentType | Notes |
| --- | --- | --- | --- |
| `POSITION` | `_cpuPositions` | VEC3 / FLOAT | min/max on converted data |
| `NORMAL` | `_cpuNormals` | VEC3 / FLOAT | renormalized in converting passes |
| `TANGENT` | `_cpuTangents` | VEC4 / FLOAT | xyz like normals; w passes through |
| `TEXCOORD_0` | `_cpuUvs` | VEC2 / FLOAT | verbatim (loader keeps glTF UV convention) |
| `TEXCOORD_1` | `_cpuUv2s` | VEC2 / FLOAT | when retained |
| `COLOR_0` | `_cpuColors` | VEC4 / FLOAT | RGBA |
| `JOINTS_0` / `JOINTS_1` | `skeleton.joints` / `.joints1` | VEC4 / UNSIGNED_BYTE or UNSIGNED_SHORT | only when a skin is emitted |
| `WEIGHTS_0` / `WEIGHTS_1` | `skeleton.weights` / `.weights1` | VEC4 / FLOAT | only when a skin is emitted |

Retained colors and skin weights are `Float32Array` — the loader normalizes integer-typed glTF sources at load — so attribute emission is float throughout; `JOINTS_*` alone keeps its retained integer width (`Uint8Array` / `Uint16Array`).

**Retention gate.** `_cpuPositions` / `_cpuNormals` / `_cpuUvs` are always retained (interleaved sources install lazy de-stride getters), as is `_cpuIndices`. `_cpuTangents`, `_cpuUv2s`, `_cpuColors`, and `_cpuGpuIndices` are retained only when device-lost-recovery mesh capture (`enableDeviceLostSceneRecovery`) was active at load time; without it those attributes are absent from the export per the input contract and indices fall back to `_cpuIndices`. Full-fidelity export therefore pairs with scene recovery; the parity pages load with it enabled.

A mesh with no retained `_cpuPositions` or `_cpuNormals` logs `Mesh "<name>" has no retained CPU geometry; exporting its node without a mesh.` and contributes a transform-only node.

Accessors are cached per (typed-array identity, conversion variant), where the variant encodes pass kind and winding flip. Each emitted array becomes one tightly-packed bufferView (`target` 34962 for attributes, 34963 for indices).

### Indices and mode

- Indices come from `_cpuGpuIndices` when retained (preserving the 16- vs 32-bit width), else `_cpuIndices` (UNSIGNED_INT). The winding rule applies on a copy when a reversal is needed.
- Every loader- or factory-built mesh is indexed (`_cpuIndices` is always retained; glTF no-indices primitives get loader-synthesized sequential indices). A hand-assembled mesh lacking both index arrays exports a non-indexed primitive (no `indices`); a required winding reversal then synthesizes the flipped `(0, 2, 1, 3, 5, 4, …)` sequence — UNSIGNED_SHORT when the vertex count ≤ 65535, else UNSIGNED_INT — cached through the standard accessor cache against the position array under a synthesized-index variant. Non-indexed strip topology with a required reversal throws like the indexed case.
- `primitive.mode`: from `_topology` when set (native meshes, e.g. line systems: 1 → `POINTS`; 2 → `LINES`; 3 → `LINE_STRIP`; 4 → `TRIANGLE_STRIP`), else from the loader-stamped `_primitive.topology` GPU state (`"point-list"` → `POINTS`; `"line-list"` → `LINES`; `"line-strip"` → `LINE_STRIP`; `"triangle-strip"` → `TRIANGLE_STRIP`), else `TRIANGLES` (4, omitted as the default). glTF `LINE_LOOP` / `TRIANGLE_FAN` sources cannot reappear: the loader already leaves those modes as triangle-list (matching Babylon.js, which cannot render them).
- A material family outside the dispatch table leaves `primitive.material` unset, with a warning (see Materials).

### Morph targets

A mesh with `morphTargets` emits `primitive.targets`, one entry per `MorphTargetData.targets[t]`:

- `POSITION`: VEC3 / FLOAT deltas from the retained per-target `positions` (verbatim in pass-through, X negated in converting passes), with min/max.
- `NORMAL`: VEC3 / FLOAT deltas when the target retains `normals` (same rule).

The glTF mesh gets `weights` = current `MorphTargetData.weights`. Accessors are dense; sparse encoding is an open seam. Targets sharing arrays share accessors through the standard cache. (Lite retains no morph-target names; `extras.targetNames` is absent from the output.)

### Thin instances — `ext/export-ext-instancing.ts`

A mesh with `thinInstances` (`count > 0`) attaches `EXT_mesh_gpu_instancing` to its node. `matrices` is one `Float32Array` (`Float64Array` under a high-precision-matrix engine; values downcast to float32 on emission), instance `i` at offset `16·i`, column-major per module 21. Instance matrices are node-local in Lite (`finalWorld = world × instanceMatrix`), which matches the extension, so each 16-float matrix is decomposed with `mat4Decompose`:

- `attributes.TRANSLATION` (VEC3/FLOAT), `ROTATION` (VEC4/FLOAT, normalized values), `SCALE` (VEC3/FLOAT) — each emitted only when some instance deviates from its identity value (ε = 0.001).
- Converting passes convert instance translations and rotations with the standard rules; scale passes through.
- A negative-determinant matrix decomposes losslessly to the canonical negative-Y-scale TRS (`mat4Decompose` folds the mirror into −Y; module 21), so mirrored instances survive round trips — canonically, not sign-faithfully.
- `colors` (RGBA per instance) emits `attributes._COLOR_0` as VEC3/FLOAT, dropping alpha with one warning per mesh (`Instance color alpha is not represented in _COLOR_0; exporting RGB.`) — the Babylon.js convention for this attribute.

The extension is recorded in `extensionsUsed` (optional, per its design).

---

## Material Export — `export-materials.ts`

### Dispatch

Materials dedupe by identity through `materialIndex`. The kind is read from `material._buildGroup._materialFamily` (resolving `MaterialView.source` first):

| Family | Path |
| --- | --- |
| `"pbr"` | PBR core mapping, then the writer sweep |
| `"standard"` | Standard→metallic-roughness conversion |
| other | warning `Material "<name>" of family "<family>" is not mapped to glTF; exporting the primitive without a material.` |

Every emitted material carries `name` and `extras` when present. The writer sweep runs the fixed `MATERIAL_EXTENSION_WRITERS` order; a writer returning true records its extension name.

### PBR core — `PbrMaterialProps` → `pbrMetallicRoughness`

The loader assembles `PbrMaterialProps` in glTF's own shape; the core path inverts `gltf-pbr-builder.ts` field by field:

| glTF output | Rule |
| --- | --- |
| `baseColorTexture` | `baseColorTexture`, through the texture funnel. A 1×1 texture is folded into the factor instead (below) and emits no texture. |
| `baseColorFactor` | `[rgb, a]`: rgb = `baseColorFactor` rgb when set, else the folded 1×1 texel (read back, sRGB-decoded to linear), else `[1,1,1]`; a = `baseColorFactor[3]` when set, else `alpha`, else 1. Omitted when ≈ `[1,1,1,1]`. |
| `metallicFactor` / `roughnessFactor` | From the props when set. When unset and `ormTexture` is 1×1 (the loader's factor bake), read from the texel's B / G channels — the same quantized values the renderer samples. Omitted when 1. |
| `metallicRoughnessTexture` | `ormTexture` when larger than 1×1 (Lite's ORM packing is glTF's: R=occlusion, G=roughness, B=metallic). |
| `occlusionTexture` | `occlusionTexture` when set, else `ormTexture` when `occlusionStrength > 0` (sharing the image, as glTF ORM assets do). `strength` = `occlusionStrength` when ≠ 1; `texCoord` = `occlusionTexCoord` when ≠ 0. Omitted when `occlusionStrength` is 0. |
| `normalTexture` | `normalTexture`; `scale` = `normalTextureScale` when ≠ 1. |
| `emissiveTexture` | `emissiveTexture`. |
| `emissiveFactor` | From `_emissiveColor`, with `m = max(r, g, b)`: when `m ≤ 1`, the color itself (omitted at `[0,0,0]`); when `m > 1`, `_emissiveColor / m`, and the emissive-strength writer emits `{ emissiveStrength: m }` — the inverse of the loader's premultiplication. Texture present with no `_emissiveColor` → `[1,1,1]`, matching the loader's import gate. |
| `alphaMode` / `alphaCutoff` | `_alphaCutOff` set → `"MASK"`, cutoff written when ≠ 0.5. Else `alphaBlend === true` or `alpha < 1` → `"BLEND"`. Else omitted. |
| `doubleSided` | `doubleSided === true`. |

1×1 texel reads use the image module's readback path (4 bytes). Under a null engine the fold falls back to `[1,1,1,1]` with a warning.

### Standard material → metallic-roughness

The Babylon.js Blinn-Phong conversion (Babylon.js decodes `diffuseColor` through its engine-configurable sRGB transfer; Lite applies the 2.2 power form, matching the Babylon.js default path):

```
baseColorFactor = [linear(diffuseColor) × 0.5, alpha]      linear(c) = c^2.2 per channel
metallicFactor  = 0
roughnessFactor = SpecularPowerToRoughness(clamp(specularPower, 0, 1024))
    where t = (P / 1300)^0.333333
          roughness = CubicBezier(t; 1.0, 0.1, 0.1, 0.1)
          CubicBezier(t; p0,p1,p2,p3) = (1−t)³p0 + 3(1−t)²t·p1 + 3(1−t)t²·p2 + t³p3
```

Textures: `diffuseTexture → baseColorTexture` (`texCoord` from `diffuseCoordIndex`); `_bumpTexture → normalTexture` with `scale = 1 / bumpLevel` when ≠ 1 (Lite's Standard shader applies `bumpScale = 1 / bumpLevel`, so the reciprocal restores glTF's multiplicative scale; `.babylon` sources copy Babylon.js's `level` into `bumpLevel` verbatim); `_emissiveTexture → emissiveTexture` with `emissiveFactor` pre-set to `[1,1,1]`; non-black `emissiveColor` overwrites `emissiveFactor` (gamma → linear); `_ambientTexture → occlusionTexture` (`texCoord` from `ambientCoordIndex`). Alpha: `alphaCutOff > 0` → `"MASK"` + cutoff; else `alpha < 1` or `_opacityTexture` present → `"BLEND"`. `backFaceCulling === false` → `doubleSided: true`. `disableLighting === true` → the unlit writer attaches `KHR_materials_unlit`.

Material-wide `uvScale` / `uvOffset` export as `KHR_texture_transform { scale, offset }` on each texture slot whose wrapper carries no transform of its own. A slot carrying both logs `Material "<name>" combines material-wide and per-texture UV transforms; exporting the per-texture transform.`

### Extension writer digests

Each writer inverts the corresponding loader module. Triggers and default omissions mirror the loader's import defaults so round trips converge.

| Writer | Trigger | Output |
| --- | --- | --- |
| `unlit` | `_unlit === true` (or Standard `disableLighting`) | `KHR_materials_unlit = {}`. When `_unlitColor` is set and `baseColorFactor` is absent, `_unlitColor` becomes the factor rgb. |
| `emissive-strength` | `max(_emissiveColor) > 1` | `{ emissiveStrength: m }`, with the core factor normalized to peak 1. |
| `clearcoat` | `_clearCoat?.isEnabled` | `clearcoatFactor` = `intensity ?? 1`, `clearcoatRoughnessFactor` = `roughness ?? 0` (each omitted at 0), `clearcoatTexture` = `texture`, `clearcoatRoughnessTexture` = `roughnessTexture`, `clearcoatNormalTexture` = `bumpTexture` with `scale = bumpTextureScale` when ≠ 1. `indexOfRefraction ≠ 1.5` and `useF0Remap === true` are outside this extension's schema; each logs a warning and the rest still exports. |
| `sheen` | `_sheen?.isEnabled` | `sheenColorFactor` = `color × intensity` (omitted at `[0,0,0]`; the loader imports with `intensity = 1`, so glTF-sourced materials round-trip exactly), `sheenRoughnessFactor` = `roughness` (omitted at 0), `sheenColorTexture` = `texture`, `sheenRoughnessTexture` = `roughnessTexture` when set, else `texture` when set (Lite reads packed sheen roughness from the color texture's alpha; re-referencing the texture preserves that on reimport). |
| `iridescence` | `_iridescence?.isEnabled` | `iridescenceFactor` = `intensity` (omitted at 0), `iridescenceIor` = `indexOfRefraction` (omitted at 1.3), thickness min/max = `minimumThickness` / `maximumThickness` (omitted at 100 / 400, already nanometres), `iridescenceTexture`, `iridescenceThicknessTexture`. |
| `anisotropy` | `_anisotropy?.isEnabled` | `anisotropyStrength` = `intensity` (omitted at 0), `anisotropyRotation` = `atan2(direction[1], direction[0])` (omitted at 0) — inverse of the loader's `direction = [cos rot, sin rot]` — `anisotropyTexture` = `texture`. |
| `ior` | `_subsurface?.refraction?.indexOfRefraction` set and ≠ 1.5 | `{ ior }`. |
| `specular` | any of `_specularWeight` ≠ 1, `_metallicReflectanceColor` ≠ white, `_metallicReflectanceTexture`, `_reflectanceTexture` | `specularFactor` = `_specularWeight` when ≠ 1, `specularColorFactor` = `_metallicReflectanceColor` when ≠ white, `specularTexture` = `_metallicReflectanceTexture`, `specularColorTexture` = `_reflectanceTexture`. Keying the factor on `_specularWeight` keeps an IOR-derived F0 from re-emitting as a specular factor (the loader's IOR path sets `_specularWeight = 1`; its specular path sets both fields to `specularFactor`). `_metallicF0Factor` is deliberately unread: the loader's specular path writes the same specular factor to both fields, and its IOR path parks normalized IOR-derived F0 there with `_specularWeight = 1` — reading it would re-emit IOR as a specular factor. Unset trigger fields count as their defaults (weight 1, color white). |
| `transmission` | `_subsurface?.refraction` with `intensity > 0` or `texture` | `transmissionFactor` = `intensity` (omitted at 0), `transmissionTexture` = `texture`. |
| `volume` | `_subsurface?.thickness` with `useGlTFChannel === true` | `thicknessFactor` = `thickness.max`, `thicknessTexture` = `thickness.texture`, `attenuationColor` = `tint.color` when ≠ white, `attenuationDistance` = `tint.atDistance` when set. The loader's synthesized no-absorption tint (`color ≈ white`, `atDistance = 1`) emits no attenuation fields, restoring the source's omitted form. (An absent or zero source `thicknessFactor` loads as `thickness.max = 1` — the loader's floor — and re-exports as 1.) |
| `dispersion` | `_subsurface?.refraction?.dispersion > 0` with refraction and thickness | `{ dispersion: 20 / refraction.dispersion }` — inverse of the loader's `strength = 20 / dispersion`. |
| `diffuse-transmission` | `_subsurface?.translucency` with `thickness.min === 0 && thickness.max === 0` (the loader's thin-surface marker) | `diffuseTransmissionFactor` = `intensity` (omitted at 0), `diffuseTransmissionTexture` = `intensityTexture`, `diffuseTransmissionColorFactor` = `color` when ≠ white, `diffuseTransmissionColorTexture` = `colorTexture`. |
| `spec-gloss` | `specGlossTexture` set | `KHR_materials_pbrSpecularGlossiness`: `diffuseTexture` = `baseColorTexture`, `specularGlossinessTexture` = `specGlossTexture`, `glossinessFactor` = `1 − roughnessFactor` when ≠ 1, `specularFactor` = `[reflectance ×3]` when `reflectance` ≠ 1, `diffuseFactor` from the core `baseColorFactor` when ≠ `[1,1,1,1]`. Clears `metallicRoughnessTexture` and leaves the loader's converted core factors (`metallicFactor 0`, `roughnessFactor = 1 − glossiness`) as the fallback for readers without the extension. This diverges from the Babylon.js serializer, which re-solves spec-gloss into metallic-roughness per texel; Lite retains the source payload, so it is re-emitted directly (recorded in the Equivalence Map). |

---

## Texture & Sampler Export — `export-textures.ts`

`exportTextureInfo(ctx, tex, slot)` is the single funnel for every material slot. It returns `{ index, texCoord?, extensions? }`.

- Images dedupe per `GPUTexture`: all `cloneTexture2D` wrappers over one GPU resource share one glTF image.
- Textures dedupe per (image, sampler) pair.
- The returned textureInfo is per slot: it carries the wrapper's own `texCoord` (`_texCoord`, written when ≠ 0) and its own `KHR_texture_transform`. Two slots referencing one image with different transforms emit two textureInfos over one texture.

### `ext/export-ext-texture-transform.ts` — KHR_texture_transform

Inverse of `gltf-ext-uv-transform.ts`, which copies glTF values onto the wrapper verbatim:

| Output | Source | Written when |
| --- | --- | --- |
| `offset` | `[uOffset ?? 0, vOffset ?? 0]` | either ≠ 0 |
| `scale` | `[uScale ?? 1, vScale ?? 1]` | either ≠ 1 |
| `rotation` | `uAng ?? 0` | ≠ 0 |
| `texCoord` | `_texCoord` | ≠ 0 |

No component present → no extension object. Writing one records `KHR_texture_transform` in `extensionsUsed` (optional extension).

`uAng` holds the glTF `rotation` angle verbatim — the loader copies it with no sign change on import, and export re-emits it unchanged. (Babylon.js stores the opposite sign in `wAng`, which its serializer negates on export; Lite's storage convention makes re-emission sign-neutral. The texture-transform unit test asserts the import → export rotation round trip.)

### Samplers

`Texture2D.sampler` is an opaque `GPUSampler`. Parameters are recovered by inverting the engine sampler pool: `getOrCreateSampler` caches one sampler per descriptor key (`min:mag:mip:addrU:addrV:addrW:aniso`), and the `@internal` helper `_samplerDescFor(engine, sampler)` in `resource/gpu-pool.ts` finds the key by sampler identity and parses it back. Mapping:

| glTF field | From | Values |
| --- | --- | --- |
| `wrapS` / `wrapT` | `addressModeU` / `V` | `repeat` → omitted (default 10497); `clamp-to-edge` → 33071; `mirror-repeat` → 33648 |
| `magFilter` | `magFilter` | `nearest` → 9728; `linear` → 9729 |
| `minFilter` | `minFilter` + `mipmapFilter` | nearest+nearest → 9984; linear+nearest → 9985; nearest+linear → 9986; linear+linear → 9987 |

Samplers dedupe by parameter tuple; an all-default sampler emits no `sampler` property. A sampler outside the pool (the loader's per-call `lodMaxClamp` samplers) resolves to defaults with `Sampler parameters for texture <image index> were not recoverable; exporting default sampling.`

---

## Image Export — `export-images.ts`

One image per `GPUTexture`, chosen by a two-rung ladder:

1. **Retained-source bytes.** When `_recoverySource` is present and the upload was not row-flipped (`kind: "url"` with `opts.invertY === false`, or unflipped `"bitmap"` sources — all glTF-loader images qualify), the original encoded bytes are recovered (re-fetch for `url`, retained fallback bytes for `bitmap`) and embedded verbatim when the MIME is `image/png`, `image/jpeg`, or `image/webp`. `url` bytes come from `fetch(url)`; the MIME is the response `Content-Type` when it names one of the three types, else sniffed from the payload's magic bytes. A failed fetch or an unrecognized payload falls through to rung 2 (silently — rung 2 is a normal path), as do the other `_recoverySource` kinds (`solid`, `pixels`, `render`, `dynamic`). WebP payloads move the texture's `source` under `extensions.EXT_texture_webp.source` and record the extension as used and required, matching the Babylon.js serializer.
2. **Readback.** Otherwise: read mip 0 with `copyTextureToBuffer` (256-byte row alignment, rows repacked tight) and encode a PNG. `rgba8unorm-srgb` and `rgba8unorm` sources embed their stored bytes directly. Other formats (float, compressed) are first decoded by a one-quad blit into a transient `rgba8unorm` target, then read back.

**Row order.** Readback emits rows in texture storage order, row 0 first. With verbatim `TEXCOORD` emission this is self-consistent for every source: glTF-loaded images (uploaded unflipped) come back byte-faithful, and upload-flipped raster textures (`loadTexture2D` default, paired with Y-up UVs) produce a vertically mirrored PNG that samples identically under the exported UVs.

- 1×1 `baseColorTexture` / `ormTexture` payloads — the loader's factor bakes — are folded into factors by the material module and produce no image. A 1×1 texture in any other slot is ordinary content and exports as a normal image.
- Null engine: rung 2 is unavailable; a texture with no usable retained source logs `Texture pixels for material "<name>" are not readable on this engine; exporting the material without that texture.` and the slot is omitted.
- GLB placement: `{ mimeType, bufferView }`; `name` is the glTF slot string through which the image was first exported (`"baseColorTexture"`, `"clearcoatTexture"`, …).
- PNG encoding is dependency-free: PNG chunk framing over `CompressionStream("deflate")`. No canvas; worker-safe.

---

## Camera Export — `export-cameras.ts`

`scene.camera` (when set) emits one `cameras[0]` entry plus a node reference. `cameras[0].name` = `camera.name` when set.

**Node placement.**

- A camera in the **pristine fixup shape** collapses. All conditions, ε = 0.001: the camera's parent `F` is a `TransformNode` with `scaling ≈ (−a, a, a)` (uniform `a > 0`; the loader sizes `a = 1/worldScale` to cancel inherited uniform scale), `position ≈ (0,0,0)`, `rotationQuaternion ≈ identity`, no geometry and no `SceneNode` children — the state `gltf-feature-camera.ts` inserts (named `<camera>_fixup`, but detection is shape-based); `F.parent` exists and exports; and the camera's transform relative to `F` (`world(F)⁻¹ · worldMatrix`) ≈ the 180° yaw `createFreeCamera((0,0,0), (0,0,−1))` leaves — rotation `diag(−1, 1, −1)`, zero translation. Then `F` is skipped and `node.camera` is written onto `F.parent` (the original glTF camera node — or the loader's synthetic `<camera>_bakedNode` when the source node was unreachable, which collapses the same way) with no other change to that node — the exact inverse of the import, so pristine camera round trips are stable.
- A parent matching the fixup scaling but failing another condition (residual camera transform, extra children) logs `Camera fixup node "<F.name>" carries extra transform or children; exporting the camera as its own node.`; the general placement below applies and `F` exports as an ordinary node. No transform is ever folded into `F.parent` — it is a source node other content may reference.
- Otherwise the camera becomes its own node: TRS from `mat4Decompose(camera.worldMatrix)` when parentless (appended as a scene root), or from `parentWorld⁻¹ × worldMatrix` when parented — `parentWorld` composed on the fly from the parent chain's local TRS / `_localMatrix` (the exporter reads no engine-cached world state, keeping the call valid before `registerScene`). Converting passes apply the mirror conversion plus `Rotate180Y`; pass-through placements emit as-is.

**Projection.**

| Case | Output |
| --- | --- |
| `camera.ortho` unset | `type: "perspective"`, `perspective: { yfov: fov, znear: nearPlane, zfar?, aspectRatio? }`. `zfar` omitted when `farPlane ≥ 1e6` (restores the glTF infinite form behind the loader's sentinel). `aspectRatio` = primary surface `canvas.width / canvas.height`; omitted under a null engine. |
| `camera.ortho` set | `type: "orthographic"`, `orthographic: { xmag, ymag, znear: nearPlane, zfar: farPlane }`. `xmag` = `(right − left) / 2` when both planes are numbers, else `halfHeight × aspectRatio`; `ymag` = `(top − bottom) / 2` when both set, else `halfHeight`. The `halfHeight` fallback has no aspect source under a null engine: `xmag = ymag` (aspect 1), with `Orthographic camera aspect is unavailable under a null engine; exporting xmag = ymag.` |

---

## Light Export — `ext/export-ext-lights-punctual.ts`

Each `scene.lights` entry with `lightType` `"point"`, `"directional"`, or `"spot"` emits a `KHR_lights_punctual` light. `"hemispheric"` has no punctual counterpart; it logs `Hemispheric light is not representable in KHR_lights_punctual; skipping.` and contributes nothing.

**Light block** (defaults omitted, matching the extension schema and the loader's import defaults):

| Field | Source | Written when |
| --- | --- | --- |
| `type` | `lightType` | always |
| `color` | `diffuse` | ≠ `[1,1,1]` |
| `intensity` | `intensity` | ≠ 1 |
| `range` | `range` | ≠ `Number.MAX_VALUE` (point/spot) |
| `spot.outerConeAngle` | `angle / 2` (Lite stores the full cone angle) | ≠ π/4 |

A spot `exponent` ≠ 1 logs `Spot light exponent falloff is approximated by KHR_lights_punctual cone angles.` and export proceeds. `spot.innerConeAngle` is left at its schema default — the same resolution the loader applies on import. Lite lights retain no glTF `name`; none is emitted.

**Node placement**, inverting the loader's parent-the-light-to-its-node import:

- Light parented to an exported node with an identity-like local transform (`position ≈ (0,0,0)`; for directional/spot, `direction ≈ (0,0,−1)`, ε = 0.001): the light reference attaches directly to the parent node (`parent.extensions.KHR_lights_punctual.light = i`).
- Otherwise a dedicated node is emitted (child of the exported parent, or a new scene root): `translation` from `position`, `rotation` from the `(0,0,−1) → direction` quaternion for directional/spot (omitted when identity), through the converting-pass rules when applicable.

`gltf.extensions.KHR_lights_punctual = { lights: [...] }` is written once any light emits. The extension is optional (`extensionsUsed` only).

---

## Skin Export — `export-skins.ts`

For each exported mesh whose `skeleton` carries `_sourceSkin`:

1. Resolve `_sourceSkin.jointNodes` (source glTF node indices) through the `sourceNodes` map of the root that collected the skinned mesh — never another root's — to live nodes, then through `nodeIndex` to exported node indices, in `jointNodes` order — the order the vertex `JOINTS_*` indices address.
2. Emit one `skins` entry per distinct `_sourceSkin` (deduped by identity): `joints` = resolved indices; `inverseBindMatrices` = one MAT4/FLOAT accessor over `_sourceSkin.inverseBindMatrices` — verbatim in pass-through, `C·M·C` per matrix in converting passes. Skins carry no `name` (Lite retains none).
3. Patch `skin` onto every node holding a primitive of this mesh, and emit the mesh's `JOINTS_*` / `WEIGHTS_*` attributes.

When a joint fails to resolve (missing stamps, restructured hierarchy), the skin is skipped with `Skin for mesh "<name>" has unresolvable joints; exporting the mesh unskinned.`, and the mesh emits without `JOINTS_*` / `WEIGHTS_*` — a valid rest-pose mesh. A skeleton without `_sourceSkin` (hand-assembled) takes the same fallback with its own message: `Mesh "<name>" has a skeleton without retained glTF skin data; exporting the mesh unskinned.`

---

## Animation Export — `export-animations.ts`

One glTF animation per `scene.animationGroups` entry carrying `_gltfMixer` (the loader-retained `[clip, restNodes, skeletonBindings]` triple), named `group.name`. Groups without `_gltfMixer` (manual property-animation groups) log `Animation group "<name>" has no glTF-clip data; skipping.`

### Clip contract

Only `clip` is read on export; the tuple's other elements (`NodeRest[]` rest-pose records and `SkeletonBinding[]`) are runtime binding state outside the input surface. The exporter's read surface of `clip`, per `animation/types.ts`:

```typescript
// animation/types.ts (existing) — read surface only
interface AnimationChannel { samplerIdx: number; nodeIdx: number; path: TargetPath; /* + PATH_POINTER-only writer fields */ }
interface AnimationSampler { input: Float32Array; output: Float32Array; interpolation: InterpMode; }
interface AnimationClip   { name: string; channels: readonly AnimationChannel[]; samplers: readonly AnimationSampler[]; duration: number; frameRate?: number; }
```

The numeric constants are `animation/types.ts`'s `PATH_*` / `INTERP_*` exports, imported rather than re-declared; the invariants table keeps the pinned values honest:

| `path` | glTF `target.path` | Output layout per key |
| --- | --- | --- |
| 0 (`PATH_TRANSLATION`) | `"translation"` | VEC3 |
| 1 (`PATH_ROTATION`) | `"rotation"` | VEC4 (xyzw) |
| 2 (`PATH_SCALE`) | `"scale"` | VEC3 |
| 3 (`PATH_WEIGHTS`) | `"weights"` | SCALAR × morph-target count |
| 4 (`PATH_POINTER`) | — | skipped (channels carry `nodeIdx = −1` and load-time writer closures) |

`interpolation` (`INTERP_LINEAR` / `INTERP_STEP` / `INTERP_CUBICSPLINE`): 0 → LINEAR (omitted as the glTF default) · 1 → STEP · 2 → CUBICSPLINE (output holds `[inTangent, value, outTangent]` triplets per key). `input` is seconds.

### Emission

Lite's clip model matches glTF (seconds-domain samplers, packed outputs, CUBICSPLINE `[inTangent, value, outTangent]` triplets), so export is a pass-through with no resampling or baking:

- **Samplers**: `input` and `output` arrays embed verbatim, deduped by array identity; `interpolation` and `target.path` per the clip contract; input accessors carry min/max.
- **Channels**: each channel resolves its target through `targetedAnimations[i].target` — the loader builds this array 1:1 with `clip.channels`, and for node and weights channels the target is the live `SceneNode` (for weights, the `TransformNode` holding the morphed mesh) — falling back to the group's **home-root** `sourceNodes` lookup of `channel.nodeIdx` (home root = the collected root of the group's first bound `SceneNode` target) when the binding is absent. `target.node` is the resolved node's exported index (for a folded mesh, its absorbing node's). A channel whose target resolves to no exported node is dropped with `Animation channel target (node <i>) is not in the exported scene; skipping channel.`
- **Pointer channels** (`PATH_POINTER`) resolve to load-time writer closures whose JSON pointers are not retained; each logs `KHR_animation_pointer channel in "<name>" is skipped on export.`
- **Weights channels** target the exported node holding the morph-target mesh.
- **Converting-pass targets** get per-key conversion per the policy. Pass-through targets embed byte-identical.
- An animation ending with zero channels is dropped.

Playback state (`isPlaying`, `speedRatio`, `loopAnimation`, `weight`, masks, blending) is runtime configuration outside the glTF data model and is left unread.

---

## GLB Assembly — `export-glb.ts`

Byte-compatible with the loader's `gltf-glb-parser.ts`:

```
Header (12 bytes):  magic 0x46546C67 ("glTF" LE) · version 2 · total length
JSON chunk:         length · type 0x4E4F534A ("JSON") · UTF-8 JSON, padded to 4 with 0x20
BIN chunk:          length · type 0x004E4942 ("BIN\0") · binary, padded to 4 with 0x00
```

JSON is compact (`JSON.stringify`) and encoded with `TextEncoder`. The BIN chunk is present only when the buffer has bytes. Result: `new Blob([bytes], { type: "model/gltf-binary" })`.

## Determinism & Ordering

- Node order: root collection order (meshes → lights → camera → animation targets), then depth-first child order.
- Array order: first-emission order for every top-level array; bufferView byte order follows the alignment sort; the alignment sort is stable (insertion order within one alignment class).
- `extensionsUsed` / `extensionsRequired`: insertion order, made stable by the fixed writer order.
- Top-level JSON member order is fixed (see Order of Operations, step 10), so the byte contract survives reimplementation.
- No timestamps or random identifiers. Two exports of an unchanged scene are byte-identical — for rung-1 `url` images this assumes the re-fetch returns stable payloads; readback-sourced images are self-contained.

## Default-Value Omission (consolidated)

| Property | Omitted when |
| --- | --- |
| node `translation` / `rotation` / `scale` / `matrix` | ≈ `[0,0,0]` / `[0,0,0,1]` / `[1,1,1]` / identity (ε 0.001) |
| `primitive.mode` | 4 (TRIANGLES) |
| `baseColorFactor` | ≈ `[1,1,1,1]` |
| `metallicFactor` / `roughnessFactor` | 1 |
| `alphaMode` | OPAQUE |
| `alphaCutoff` | 0.5 |
| `normalTexture.scale` / `occlusionTexture.strength` | 1 |
| `emissiveFactor` | ≈ `[0,0,0]` |
| `doubleSided` | false |
| sampler `wrapS` / `wrapT` | REPEAT |
| whole sampler | all fields default |
| light `color` / `intensity` / `range` | `[1,1,1]` / 1 / `MAX_VALUE` |
| `spot.outerConeAngle` | π/4 |
| `perspective.zfar` | `farPlane ≥ 1e6` |
| `KHR_texture_transform` `offset` / `scale` / `rotation` / `texCoord` | `[0,0]` / `[1,1]` / 0 / 0 |
| animation `interpolation` | LINEAR |
| extension factor defaults | per writer digests |
| top-level arrays / `scene` / `buffers` | empty |

## Warnings & Errors (consolidated)

**Thrown** (promise rejection): winding reversal required on a `TRIANGLE_STRIP` primitive; GPU readback failure surfaced by the device. Everything else degrades.

**Warn-and-continue** (message → consequence): no retained CPU geometry → node without mesh · unmapped material family → primitive without material · 1×1 factor-fold texel unreadable (null engine) → factor `[1,1,1,1]` · clearcoat IOR / F0 remap → field skipped · spot exponent ≠ 1 → falloff approximated · hemispheric light → skipped · unresolvable skin joints → mesh unskinned · skeleton without retained skin data → mesh unskinned · unreadable texture pixels → texture slot omitted · unrecoverable sampler → default sampling · instance color alpha → RGB only · combined material-wide and per-texture UV transforms → per-texture wins · camera fixup with residual transform or children → camera as its own node · null-engine orthographic aspect → `xmag = ymag` · property-animation group → skipped · pointer channel → skipped · channel target outside export → channel dropped. Each distinct message logs once per call.

---

## Babylon.js Equivalence Map

| Babylon Lite exporter | Babylon.js serializer (v9.21.2) |
| --- | --- |
| `exportSceneAsGlb(scene): Promise<Blob>` | `GLTF2Export.GLBAsync(scene, name)` → `GLTFData.files` |
| fixed behavior set | `IExportOptions` (rows below give the mapping) |
| whole scene exports; caller restructures to filter | `shouldExportNode` predicate |
| conversion-root stripping, always on | `removeNoopRootNodes: true` |
| `metadata.gltf.extras` → `extras` | `metadataSelector` default |
| samplers pass through unresampled | `animationSampleRate`, interpolation inference, baking |
| attributes export when retained | `exportUnusedUVs` UV pruning |
| uncompressed geometry | `meshCompressionMethod: "Draco"` |
| static ordered writer array | `RegisterExtension` registry, per-export instances |
| pass split via loader root shape `(−1,1,1)` | pass split via `useRightHandedSystem` + `IsNoopNode` |
| same mirror, quaternion sign-pattern, `Rotate180Y` | identical conversion math |
| winding from `_authoredSign` × pass kind | winding from `_getEffectiveOrientation` × `wasAddedByNoopNode` |
| per-slot textureInfo | shared `ITextureInfo` per texture |
| image per `GPUTexture`; sampler-pool inversion | image per `InternalTexture` + MIME; sampler table |
| retained bytes else readback; storage-row order | cached bytes else `GetTextureDataAsync`; readback when `invertY` set |
| verbatim embeds cover png / jpeg / webp; KTX2 and AVIF sources re-encode through readback (rung 1 of the image ladder is the landing seam for further payload-preserving formats) | cached KTX2 / WebP / AVIF bytes relocate under `KHR_texture_basisu` / `EXT_texture_webp` / `EXT_texture_avif` (used + required) |
| spec-gloss re-emitted via the archived extension + MR fallback | spec-gloss re-solved to metallic-roughness per texel |
| same Standard→MR formulas | `_ConvertToGLTFPBRMetallicRoughness` |
| same emissive-strength normalization | `KHR_materials_emissive_strength` |
| light collapse onto identity-transform parent | `IsChildCollapsible` / `CollapseChildIntoParent` |
| spot cone from the full `angle` (`outerConeAngle = angle / 2`; inner at its schema default) | `innerConeAngle = innerAngle / 2`, `outerConeAngle = angle / 2` |
| camera fixup collapse (`(−a, a, a)`, pristine shape only; residual → own node + warning) | camera parent collapse (`(−1,1,1)`; residual composed into the parent via `CollapseChildIntoParent`) |
| skins from `_sourceSkin` + `_gltfNodeIndex` | skins from `Bone.getAbsoluteInverseBindMatrix()` + linked nodes |
| morph deltas pass through (position, normal) | morph deltas recomputed (position, normal, tangent, color) |
| line and point primitives carry their assigned material | `LinesMesh` / `GreasedLineBaseMesh` emit a minimal per-submesh color material |
| thin instances → `EXT_mesh_gpu_instancing` | same extension from `thinInstanceGetWorldMatrices()` |
| GLB framing | identical |

Serializer concepts with no Lite counterpart in this spec's scope are absent from this document; the seams above (writer list, inputs table, image ladder) are where each would land.

---

## Dependencies

- **Math**: `mat4Decompose`, `mat4Multiply`, `mat4Invert`, `quatFromRotationMatrix`, `srgbByteToLinear`; the conversion formulas in `export-handedness.ts` are self-contained.
- **Scene state**: the Inputs table — retained CPU arrays, `SkeletonData`, `MorphTargetData`, `ThinInstanceData`, `AnimationGroup._gltfMixer`. Retention of `_cpuTangents` / `_cpuUv2s` / `_cpuColors` / `_cpuGpuIndices` requires `enableDeviceLostSceneRecovery` at load time (see the geometry retention gate).
- **Engine**: `_device` for readback and blits; primary surface canvas (the engine is the primary surface) for camera aspect; `VERSION` for `asset.generator`.
- **Resource pool**: the `@internal` `_samplerDescFor(engine, sampler)` reverse lookup in `resource/gpu-pool.ts`.
- **Loader stamps**: `SceneNode._gltfNodeIndex` (stamped in `buildNode`) and `SkeletonData._sourceSkin` (stamped in `gltf-feature-skeleton.ts` `applyMesh`).
- **Clip constants**: the numeric `path` / `interpolation` values in the clip contract are imported from `animation/types.ts` (`PATH_*`, `INTERP_*`), never re-declared.
- **glTF JSON types**: `GltfRoot` / `GltfMaterial` and the other document interfaces are the loader's glTF 2.0 typings, imported unchanged — the exporter declares no schema of its own.
- **Web platform**: `TextEncoder`, `CompressionStream("deflate")`, `fetch` (rung-1 `url` recovery), `Blob`. No DOM, no canvas; worker-safe.
- **No third-party code.** PNG encoding, GLB framing, and conversions are in-module.

---

## Test Specification

Four layers for this module, mapped onto TESTING.md's categories (unit · plumbing · parity · perf · bundle): Vitest unit tests over fabricated plain-data scenes, Playwright integration tests over real exports (a new `tests/lite/export/` suite in the plumbing category), a glTF-Validator gate this module introduces, and a visual parity suite adapted from the Babylon.js serializer's visualization tests. Because Lite entities are plain data, unit-test stubs are object literals — no engine or GPU required.

### Unit tests — Vitest, `tests/lite/unit/export-gltf/`

| Test | Assertion |
| --- | --- |
| handedness: quaternion | sign-pattern result ≡ `quat(C·mat(q)·C⁻¹)` over randomized unit quaternions; largest component non-negative |
| handedness: position / matrix | negate-X; `C·M·C` element-for-element |
| handedness: Rotate180Y | `(x,y,z,w) → (−z,w,x,−y)`; applied twice ≡ identity up to sign |
| winding rule | the three policy cases; strip reversal throws; LINES/POINTS untouched; non-indexed reversal synthesizes `(0,2,1,…)` at the width the vertex count needs; mode mapping from `_topology` and `_primitive.topology` |
| root collection | meshes → lights → camera → animation-target order; an animated meshless `TransformNode` root exports; two loaded hierarchies with colliding `_gltfNodeIndex` stamps resolve channels and joints within their own roots |
| node TRS omission | ε-default TRS omitted; matrix nodes verbatim (pass-through) and converted (converting) |
| mesh grouping and dedup | identity-TRS children fold into parent primitives; identical signatures share one mesh; fold fences (skeleton / thin-instance / morph agreement) split incompatible siblings into own nodes; a `Mesh` with children never absorbs; folded meshes resolve through `nodeIndex` to the absorbing node |
| Standard→MR | base color = `linear(diffuse) × 0.5`; roughness at P = 64 (the Babylon.js conversion test's pinned value) and at the 0 / 256 / 1024 clamp boundaries; texture slot mapping incl. `normalTexture.scale = 1 / bumpLevel` |
| PBR core mapping | factor/texture/alpha/occlusion rules row by row |
| 1×1 folding | base color → sRGB-decoded factor; ORM → G/B factors; no image emitted |
| emissive strength | `m ≤ 1` plain factor; `m > 1` normalized + strength; texture-only → `[1,1,1]` |
| writers: unlit / ior / specular | triggers and omissions; IOR-only material emits no `specularFactor` |
| writers: transmission / volume / dispersion / diffuse-transmission | factor mapping; synthesized tint omits attenuation; `20 / strength` inverse; zero-thickness fence |
| writers: clearcoat / sheen / iridescence / anisotropy | field mapping; sheen packed-roughness re-reference; `atan2` rotation inverse |
| writer: spec-gloss | extension payload, MR fallback, ORM texture cleared |
| texture transform | field mapping; rotation sign round-trips against a loader-imported reference; identity emits nothing |
| sampler mapping | all filter combinations → 9984–9987; wrap modes; default omitted; pool-key parse round trip |
| BufferBuilder | alignment sort, 4-byte offsets, deferred patching, dedup, min/max |
| GLB framing | magic, version, lengths, 0x20 / 0x00 padding, chunk types |
| PNG encoder | encode → `DecompressionStream` inflate → pixel equality; storage-row order |
| animations | sampler byte equality, numeric path table, interpolation mapping, CUBICSPLINE layout, input min/max, home-root channel scoping, skip rules |
| skins | joint resolution scoped to the mesh's root, IBM pass-through and `C·M·C`, unresolvable-joint fallback, skeleton-without-`_sourceSkin` fallback |
| thin instances | TRS decomposition, identity-attribute omission, `_COLOR_0` and alpha warning, negative-determinant canonical (−Y) decomposition round trip |
| lights | block defaults, `outerConeAngle = angle/2`, collapse rule, hemispheric skip |
| cameras | perspective `yfov` / `znear`, `zfar` omitted at the `≥ 1e6` sentinel, ortho `xmag` / `ymag` fallbacks (incl. null-engine `xmag = ymag`), pristine fixup collapse and the residual → own-node refusal, `Rotate180Y`, `aspectRatio` omission under a null engine |
| null-engine images | retained-source reuse; orientation gate; slot omission |
| empty scene | asset-only glTF (no `scenes`, no `buffers`) |
| metadata | node / mesh / material `extras` round trip; first contributor wins on folded meshes |
| determinism | two exports of one scene are byte-identical |

### Loader-convention invariants

Exporter rules that invert a specific loader convention, paired with the tests that keep each pair honest:

| Invariant (loader convention ↔ exporter rule) | Enforcing tests |
| --- | --- |
| `uAng` stores glTF `rotation` verbatim ↔ re-emitted unchanged | texture transform (unit) · E-15 |
| `_authoredSign = −1` on glTF-loaded meshes ↔ the pass-through winding table | winding rule (unit) · E-1 |
| `angle` stores the full cone ↔ `outerConeAngle = angle / 2` | lights (unit) · E-9 |
| ORM texel packing R=occlusion / G=roughness / B=metallic ↔ `ormTexture` re-emitted as `metallicRoughnessTexture` | 1×1 folding + PBR core mapping (unit) · E-17 |
| sheen roughness packed in the color texture's alpha ↔ `sheenRoughnessTexture` re-references `texture` | writers: clearcoat / sheen / iridescence / anisotropy (unit) · E-20 |
| loader conversion root `(−1,1,1)` ↔ root stripping + pass-through state | no-root-conversion-node (integration) · E-1 |
| camera fixup `(−a, a, a)` with zero translation, identity rotation, `Rotate180Y` camera-local ↔ pristine fixup collapse | cameras (unit) · E-10 |
| clip numeric constants (`PATH_*` 0–4, `INTERP_*` 0–2 in `animation/types.ts`) ↔ the clip-contract tables | animations (unit) · E-3 / E-4 |
| Standard bump strength renders as `1 / bumpLevel` ↔ `normalTexture.scale = 1 / bumpLevel` | Standard→MR (unit) · E-24 |

### Integration tests — Playwright, `tests/lite/export/`

Build or load a scene, export, parse the Blob with the loader's GLB parser, assert structurally; reimport with `loadGltf(engine, blob)` where marked. The Babylon.js `glTFSerializer.test.ts` suite maps as follows:

| Babylon.js integration test | Status here |
| --- | --- |
| standard → metallic roughness / `_SolveMetallic` | ported to the unit layer (conversion + spec-gloss tests) |
| empty scene → asset-only | ported to the unit layer |
| sphere geometry | ported — `createSphere` accessors, winding, min/max |
| translation / scale / rotationQuaternion / combined animations | ported — clip groups round-trip channels and sampler bytes |
| single-component translation animation | covered by the full-vector ports (Lite clips are full-vector) |
| point / spot / directional / multiple lights | ported |
| scene and node metadata | adapted — node / mesh / material extras at the unit layer; `SceneContext` carries no metadata, so scene-level `extras` is out of scope |
| instances share one mesh | ported — shared geometry re-exports as one mesh, N nodes |
| instances without their source mesh | adapted — remove one sharing node before export |
| no root conversion node in output | ported — `__root__` stripped, roots at top level |
| node animations targeting a meshless root (RH scene) | merged into the group form — Lite animations are clip groups |
| animation group targeting a meshless root (RH scene) | ported — group channel onto an empty `TransformNode` |
| shared texture not duplicated | ported — one image, one texture, two materials |
| RH transforms unconverted | ported — pass-through byte equality |
| LH transforms consistently converted | ported — against hand-computed references |
| children of unexported nodes reparented | adapted — `removeFromScene` before export is the filtering contract |
| shared float `MatricesIndicesKind` conversion | adapted — u8 vs u16 joint width preservation |
| KTX2 → `KHR_texture_basisu` | adapted — KTX2 sources export as blit-decoded PNG (scene E-13) |
| WebP → `EXT_texture_webp` | ported — retained WebP bytes relocate under the extension |

The Babylon.js unit suite (`test/unit/glTF/glTFMaterialExporter.test.ts` — cached-byte reuse under `invertY` with no GPU fallback, Blob-typed internal buffers, URL re-fetch through `Tools.LoadFileAsync`) maps onto the unit layer's null-engine images rows.

Two gates run over every integration and parity output:

- **glTF-Validator** (`gltf-validator`, dev dependency): zero errors; zero warnings besides the archived-extension notice on spec-gloss outputs.
- **Round-trip idempotence**: `export(load(export(load(asset))))` is byte-identical to `export(load(asset))` for each parity source asset.

### Visual parity suite — Playwright, `tests/lite/parity/scenes/`

Each scene follows the repo's parity conventions (committed golden, `scene-config.json` entry with `maxMad`, thumbnail, bundle ceiling). The export twist: the page builds or loads the source scene with `enableDeviceLostSceneRecovery` active (so gated attributes — tangents, uv2, colors — are retained; see the geometry retention gate), calls `exportSceneAsGlb`, reimports the Blob with `loadGltf`, and renders the **reimported** scene against the golden. `?seekTime=` freezes animated scenes. Numeric scene ids follow `scene-config.json` order; the tables use stable E-numbers.

Adapted from the Babylon.js `"GLTF Serializer"` entries in `packages/tools/tests/test/visualization/config.json` (playground ids and reference images kept as provenance):

| E# | Scene (slug) | Babylon.js source — playgroundId · reference image | Adaptation | Tier |
| --- | --- | --- | --- | --- |
| E-1 | `export-negative-world-matrix` | with Negative World Matrix, 4 variants (LH/RH × once/twice) — `#KX53VK#88` · `glTFSerializerNegativeWorldMatrix.png` | native-built and glTF-loaded negative-scale hierarchies; single and double round trip | A |
| E-2 | `export-shared-buffers` | Shared Buffer Conversions — `#KX53VK#85` · `glTFSerializerSharedBufferConversions.png` | meshes sharing geometry with mixed conversion needs | B |
| E-3 | `export-skinning-animation` | Skinning and Animation (+RH) — `#DMZBX1#1/2` · `gltfSerializerSkinningAndAnimation.png` | skinned, animated asset round trip, frozen mid-clip | A |
| E-4 | `export-morph-animation` | Morph Target Animation — `#84M2SR#107` · `gltfSerializerMorphTargetAnimation.png` | morphed mesh, weights channel | A |
| E-5 | `export-morph-animation-group` | Morph Target Animation Group — `#T087A8#29` · `gltfSerializerMorphTargetAnimationGroup.png` | group-driven weights, non-zero rest weights | B |
| E-6 | `export-draco-source` | KHR draco mesh compression — `#F8BF8N#3` · `glTFSerializerKhrDracoMeshCompression.png` | Draco source asset: decoded at load, exported as plain accessors | B |
| E-7 | `export-clearcoat` | KHR materials clearcoat — `#9N6CLU#23` · `glTFSerializerKhrMaterialsClearcoat.png` | clearcoat factors and textures | A |
| E-8 | `export-gpu-instancing` | KHR gpu instancing — `#1Q2BWN#10` · `glTFSerializerKhrGpuInstancing.png` | thin instances → extension → thin instances | A |
| E-9 | `export-punctual-lights` | KHR punctual light LH/RH — `#FLXW8B#27` · `glTFSerializerKHRPunctualLightLH/RH.png` | native lights (converting) and glTF lights (pass-through) | A |
| E-10 | `export-camera` | Camera, 4 variants (LH/RH × round trip once/twice) — `#O0M0J9#25` · `glTFSerializerCameraLeftHand/RightHand.png` | native camera and imported camera with fixup collapse; double round trip | B |
| E-11 | `export-rotation-conversion` | Rotation conversion LH — `#UK7FLI#1` · `glTFSerializerRotationConversionLH.png` | nested rotated nodes through the converting pass | A |
| E-12 | `export-camera-animation` | camera rotation animation, 4 variants (RH→LH, RH→RH, LH→RH, LH→LH) — `#3A00GJ#42` · `glTFSerializerCameraRotationAnimation.png` | imported animated camera round trip (Lite scenes are single-handed, so one scene covers the surviving legs) | B |
| E-13 | `export-texture-roundtrip` | un/compressed texture roundtrip — `#8NTR5X#8` · `glTFSerializerTextureExport.png` (errorRatio 0.1) | PNG readback next to KTX2 blit-decode; tight MAD | A |
| E-14 | `export-multimaterial` | multimaterial with raw texture — `#KU72PX` · `glTFSerializerMultimaterial.png` | multi-primitive node, distinct materials, pixels-sourced texture | B |
| E-15 | `export-texture-transform` | Export GLTF Extension KHR_texture_transform — `#20OAV9#15148` · `exportGltfKHRTextureTransform.png` | offset/scale/rotation/texCoord round trip | A |

**Tiers.** Tier A runs on PRs touching `export-gltf/`, the loader, or materials. Tier B joins the nightly full-parity run. Goldens follow GUIDANCE (path convention) and are captured once from the Babylon.js reference render, never regenerated at test time: committed under `reference/lite/sceneN-<slug>/babylon-ref-golden.png`; parity tests compare against goldens only.

### Bundle-size tests

- **Isolation**: scenes without an `exportSceneAsGlb` import carry zero exporter bytes — per-scene manifests match a build with the exporter's modules absent; the loader stamps and `_samplerDescFor` are the audited exceptions, budgeted at single-digit bytes.
- **Ceiling**: the export demo scene (E-16, also the lab card) carries the `maxRawKB` ceiling on its `scene-config.json` entry; ceiling changes follow §2 rule 9.

---

## File Manifest

Sizes are approximate. Rows for files outside `export-gltf/` cover the exporter-owned lines those files host.

| File | Size | Role |
| --- | --- | --- |
| `export-gltf.ts` | entry, root partitioning, orchestration, JSON assembly |
| `export-context.ts` | `ExportContext`, `MaterialExtensionWriter`, warn helper |
| `export-handedness.ts` | mirror conversions, quaternion sign-pattern, `Rotate180Y`, winding rule |
| `export-buffers.ts` | `BufferBuilder`: bufferViews, accessors, alignment, min/max |
| `export-glb.ts` | GLB framing → Blob |
| `export-nodes.ts` | traversal, TRS/matrix emission, extras, mesh grouping and dedup |
| `export-geometry.ts` | attributes, indices, modes, morph targets, accessor caching |
| `export-materials.ts` | dispatch, PBR core, Standard→MR, writer list and sweep |
| `export-textures.ts` | texture/sampler funnel, pool inversion, per-slot textureInfo |
| `export-images.ts` | source ladder, readback, blit decode, PNG encode, 1×1 reads |
| `export-cameras.ts` | camera node, fixup collapse, projections |
| `export-skins.ts` | skins, IBMs, joint resolution, fallback |
| `export-animations.ts` | groups → animations, channel resolution, conversion, skips |
| `ext/export-ext-lights-punctual.ts` | lights array, node placement, collapse |
| `ext/export-ext-instancing.ts` | thin instances → `EXT_mesh_gpu_instancing` |
| `ext/export-ext-texture-transform.ts` | textureInfo transform extension |
| `ext/export-ext-*.ts` | per-writer digests above |
| `resource/gpu-pool.ts` | `@internal _samplerDescFor` reverse lookup — the exporter's engine-side seam |
| `loader-gltf/load-gltf.ts` | `_gltfNodeIndex` stamp in `buildNode` |
| `loader-gltf/gltf-feature-skeleton.ts` | `_sourceSkin` stamp |
| `scene-config.json` | E-1 … E-24 parity scenes; E-16's entry also carries the export demo `maxRawKB` ceiling |
| `tests/lite/unit/export-gltf/*.test.ts` | unit layer |
| `tests/lite/export/*.spec.ts` | integration layer, validator, idempotence gates |
| `tests/lite/parity/scenes/export-*.spec.ts` | visual parity suite (E-1 … E-24) |
