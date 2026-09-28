# @babylonjs/lite-compat

An **opt-in Babylon.js-shaped compatibility layer** implemented on top of the
[Babylon Lite](../babylon-lite/) public API. It exists to give Babylon.js apps a
low-friction migration runway to Babylon Lite's WebGPU renderer.

```ts
import { WebGPUEngine, Scene, ArcRotateCamera, HemisphericLight, MeshBuilder, StandardMaterial, Vector3, Color3 } from "@babylonjs/lite-compat";

const engine = new WebGPUEngine(canvas);
await engine.initAsync();

const scene = new Scene(engine);
const camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 2.5, 5, new Vector3(0, 0, 0), scene);
camera.attachControl(canvas, true);
new HemisphericLight("light", new Vector3(0, 1, 0), scene);

const box = MeshBuilder.CreateBox("box", { size: 1 }, scene);
const mat = new StandardMaterial("mat", scene);
mat.diffuseColor = new Color3(1, 0, 0);
box.material = mat;

engine.runRenderLoop(() => scene.render());
```

## Drop-in migration: keep your Babylon.js imports

If you have an existing Babylon.js app, you don't have to rewrite a single import.
This package ships a bundler plugin that **rewrites `@babylonjs/*` imports onto the
compat layer at build time**, so your `@babylonjs/core`, `@babylonjs/loaders`,
`@babylonjs/addons`, `@babylonjs/materials`, and `@recast-navigation/*` imports
resolve to `@babylonjs/lite-compat` instead.

```ts
// Your code stays exactly as it was — no edits needed:
import { Scene, ArcRotateCamera, MeshBuilder } from "@babylonjs/core";
```

Add the plugin for your bundler:

**Vite**

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { liteCompat } from "@babylonjs/lite-compat/vite";

export default defineConfig({
    plugins: [liteCompat()],
});
```

**Rollup** (also works with Rolldown)

```js
// rollup.config.js
import { liteCompat } from "@babylonjs/lite-compat/rollup";

export default {
    plugins: [liteCompat()],
};
```

**Webpack** (also works with Rspack)

```js
// webpack.config.js
const { LiteCompatPlugin } = require("@babylonjs/lite-compat/webpack");

module.exports = {
    plugins: [new LiteCompatPlugin()],
};
```

**esbuild**

```js
import { build } from "esbuild";
import { liteCompat } from "@babylonjs/lite-compat/esbuild";

await build({
    plugins: [liteCompat()],
    // …
});
```

Every adapter shares one redirect table, so they map imports identically. Specifiers
outside the supported surface (e.g. `@babylonjs/gui`) are left untouched and resolve
to the real Babylon.js package — so unsupported APIs fail loudly instead of silently
mismapping. Once migration is complete you can drop the plugin and import from
`@babylonjs/lite-compat` (or native `@babylonjs/lite`) directly.

## What it is (and isn't)

- A **class-based, Babylon.js-shaped** surface over Lite's plain-data + factory API.
- **Opt-in:** import it explicitly. It installs no `BABYLON` global and has no
  module-level side effects, so it never bloats consumers that don't use it.
- **Honest:** unsupported Babylon.js APIs throw `LiteCompatError` rather than
  rendering something subtly wrong.
- **Not** a full Babylon.js reimplementation. Classic imperative particle systems,
  GUI, WebXR, decals, and other features absent from Babylon Lite are out of scope
  (Node Particle Editor graphs are partially supported).

## Supported APIs at a glance

A high-level view of which Babylon.js packages and feature areas the compat layer
covers. This is a summary of the common surface; individual properties and
overloads within a supported area may still be absent.

| Status | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| ✅     | Common surface implemented and tested where possible                    |
| ⚡     | A practical subset works; some properties/overloads are absent or throw |
| ❌     | Not supported on the current Lite API (throws `LiteCompatError`)        |

### `@babylonjs/core`

| Feature area                                                                                                                              | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------- | :----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Math (`Vector*`, `Color*`, `Quaternion`, `Matrix`, `Plane`, `Ray`, `Frustum`, `Scalar`, `Axis`/`Space`, color temperature/white balance)  |   ✅   | `Angle` / `Curve3` / `Path3D` partial                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Engine (`WebGPUEngine`, `Engine`, `ThinEngine`, `NullEngine`)                                                                             |   ⚡   | async startup + render loop; `currentSampleCount` reports the active surface's MSAA count; `beginFrame`/`endFrame`, occlusion queries, engine-wide alpha-to-coverage, and manual `scene.render()` unsupported                                                                                                                                                                                                                                                                           |
| Compute + GPU buffers (`ComputeShader`, `StorageBuffer`, `UniformBuffer`)                                                                 |   ⚡   | WGSL compute, direct/indirect dispatch, storage buffers, and compute-oriented std140 uniform buffers forward to Lite; shader registries/preprocessing, texture bindings, in-frame immediate dispatch, and Effect-oriented UBO methods remain unsupported                                                                                                                                                                                                                                |
| Scene (clear color, cameras/lights, fog, environment, observables, ready state)                                                           |   ⚡   | sync `scene.pick` forwards to Lite's CPU/AABB picker; triangle-level positions, normals, and UVs still require async `GPUPicker`; `scene.meshes` + `getMeshBy*`/`getNodeBy*` enumerate every mesh via a canonical wrapper registry; exposure/contrast/tone mapping are forwarded, while white balance and fluid rendering throw because Lite lacks their cross-cutting shader/render-pass subsystems                                                                                    |
| Cameras (`ArcRotateCamera`, `FreeCamera`/`Universal`/`Target`, `FollowCamera`, `GeospatialCamera`)                                        |   ✅   | arc controls include pointer, wheel, touch, and BJS-default Arrow-key input; orthographic bounds and projection-mode switching forward to Lite; fully unconfigured orthographic extents use Lite's `halfHeight` + aspect-ratio derivation rather than Babylon.js render dimensions; XR / device-orientation / stereoscopic rigs unsupported                                                                                                                                             |
| Lights (`Hemispheric`, `Directional`, `Point`, `Spot`)                                                                                    |   ✅   | `ClusteredLightContainer` clusters point lights (⚡ partial); `RectAreaLight` unsupported                                                                                                                                                                                                                                                                                                                                                                                               |
| Shadows (`ShadowGenerator` directional ESM/PCF, spot PCF)                                                                                 |   ⚡   | `CascadedShadowGenerator` uses Lite's native 2–4 cascade CSM                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Meshes & geometry (class chain, `MeshBuilder` primitives, transforms, thin instances, `clone`, `VertexData`, `Mesh.MergeMeshes`)          |   ⚡   | `CreateLines`/`CreateLineSystem` support fixed-topology line lists and RGBA point colors; `CreateDashedLines` supports uniform-color dashed line lists; mesh-blending tag helpers and validated mesh metadata forward to native Lite; `MergeMeshes` bakes positions/normals/UVs and rejects unsupported attributes/animation; polygon/extruded-polygon, decal/text/tiled builders, `GreasedLine*` (thick lines), `InstancedMesh`, LOD/edges/outline, and hardware instances unsupported |
| CSG / CSG2                                                                                                                                |   ✅   | over Lite boolean ops                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Gizmos (position/rotation/scale/bounding-box/light/camera + `GizmoManager`)                                                               |   ⚡   | over Lite gizmo suite; `isEnabled` toggles per-axis interactivity (display-only when disabled)                                                                                                                                                                                                                                                                                                                                                                                          |
| Materials (`StandardMaterial`, `PBRMaterial`, metallic-rough / spec-gloss, `NodeMaterial`)                                                |   ⚡   | `clone(name)` shares textures with its own renderable; fixed-slot custom WGSL `MaterialPluginBase` injection is supported (`#include`, regex replacement, and custom UBO/sampler hooks are not), while `DitheredTileFadeMaterialPlugin`, GLSL `ShaderMaterial`, `MultiMaterial`, `BackgroundMaterial`, and `OpenPBRMaterial` remain unsupported                                                                                                                                         |
| Textures (`Texture`, `RawTexture`, `RawTexture2DArray`, `RawTexture3D`, `DynamicTexture`, `HtmlTexture`, `CubeTexture`, `HDRCubeTexture`) |   ⚡   | `HDRCubeTexture` routes to native `loadHdrEnvironment`; `RawTexture2DArray` supports raw bytes, image sources/URLs, and single-file KTX2 arrays; `RawTexture3D` supports base-level RGBA8 volumes but not mip generation; `HtmlTexture` forwards native Lite DOM capture/update; `RenderTargetTexture` / `MirrorTexture` unsupported                                                                                                                                                    |
| Animation (keyframe `Animation`, easing, `Animatable`, `AnimationGroup` incl. weighted/additive blend)                                    |   ⚡   | All standard easing classes, including `PowerEase` / `BezierCurveEase`, reuse Lite's native functional curves; `beginAnimation` / `beginDirectAnimation` delegate supported float/vector/quaternion tracks to Lite property animation; unsupported tracks use an explicit compat evaluator; structural groups remain compat-owned; loaded glTF skeletal blending supported; root-motion analysis/controller APIs throw                                                                  |
| Morph targets (`MorphTarget` / `MorphTargetManager`)                                                                                      |   ✅   | over Lite morph targets                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Sprites (`SpriteManager` / `Sprite`)                                                                                                      |   ⚡   | camera-facing billboards; `SpriteMap` / packed atlas unsupported                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Behaviors / Actions (`AutoRotation`, `Framing`, `ActionManager`, conditions)                                                              |   ⚡   | Manual triggers, canvas-scoped key actions, and HTML-twin primary/secondary pick forwarding; no general pointer trigger pipeline; drag / six-DoF / XR-oriented mesh behaviors throw                                                                                                                                                                                                                                                                                                     |
| Misc (`Observable`, `Tools`, `SmartArray`, `Tags`, gradients, `PerformanceMonitor`)                                                       |   ✅   |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Audio V2 (`AudioEngineV2`, `StaticSound`, `StreamingSound`, `AudioBus`, buses/sources/analyzer)                                           |   ⚡   | over Lite's AudioV2 port; `MainAudioBus` spatial/analyzer and a second main bus unsupported                                                                                                                                                                                                                                                                                                                                                                                             |
| Physics (`HavokPlugin`, `scene.enablePhysics`/`getPhysicsEngine`, `PhysicsAggregate`/`PhysicsBody`/`PhysicsShape`)                        |   ⚡   | Native Havok V2 forwarding for common body/shape operations, thin-instance bodies, and filtered raycasts with instance indices; unrecognized enum values throw at the compat boundary                                                                                                                                                                                                                                                                                                   |
| Particles (`NodeParticleSystemSet` / `ParticleSystemSet` — Node Particle Editor)                                                          |   ⚡   | NPE snippet/JSON graphs: `Parse`/`ParseFromSnippetAsync` → `buildAsync` → `start`, incl. per-system `set.systems[i]` runtime (`start`/`animate`/`updateSpeed`/`particleTexture`). Imperative classic/GPU/solid `ParticleSystem` construction + programmatic block authoring unsupported                                                                                                                                                                                                 |
| Post-processes, layers (glow/highlight), probes, WebXR                                                                                    |   ❌   | Babylon.js wrapper classes are not implemented — use native Lite `create*Task` functions, including `createMeshBlendingPostProcessTask` with geometry-renderer tag/depth/albedo outputs                                                                                                                                                                                                                                                                                                 |

### Accessibility

`Node.accessibilityTag` and `HTMLTwinRenderer.Render(scene, options)` expose scene objects through real HTML. Import the facade directly from `@babylonjs/lite-compat`, or use the bundler rewrite for `@babylonjs/accessibility`, `/index`, `/HtmlTwin/index`, or `/HtmlTwin/htmlTwinRenderer` (including `.js` suffixes on the paths). Internal React/GUI item modules remain unmapped.

```typescript
import { HTMLTwinRenderer } from "@babylonjs/lite-compat";

box.accessibilityTag = {
    description: "Select box",
    eventHandler: { click: () => showDetails(box) },
};
const twin = HTMLTwinRenderer.Render(scene, { parentElement: controlsHost });

// Also called automatically when the scene is disposed.
twin.dispose();
```

Tags are frozen replacement snapshots. Explicit callbacks override inferred pick actions. The default view supplies visible DOM focus and a projected scene marker. Bind early or supply `roots` for unrelated empty transforms that are not retained in scene storage.

Assign `scene.actionManager` for canvas-scoped `OnKeyDownTrigger`/`OnKeyUpTrigger` actions. Original events and key filters are preserved; editing sibling native controls does not trigger canvas actions. Use `scene.animationsEnabled` to freeze scene-owned animation without replaying disabled time.

This is capability parity, not the full Babylon accessibility/GUI implementation. `addAllControls: true` throws. For labelled forms, use native `createNativeControl` and `createHtmlOverlay` from `@babylonjs/lite`; no Babylon GUI import is needed. The overlay is a live panel or screen-aligned host, not `HtmlInteractionManager`, UV raycasting, perspective HTML-on-mesh, or a texture-source adoption API.

**Trigger-number migration:** pointer-over is now 9 (was 10), pointer-out is 10 (was 11), and every-frame is 11 (was 14). Key-down/key-up use 14/15. Use named constants, and migrate persisted raw numbers; the collisions cannot be aliased.

See [accessibility status](COMPAT-STATUS.md#accessibility) for exact boundaries and [Add accessible scene controls](../../docs/lite/06-accessibility.md) for native recipes and the runnable example.

### `@babylonjs/loaders`

| Feature area                                                                                   | Status | Notes                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | :----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| glTF 2.0 (+ extensions), `.babylon`                                                            |   ✅   | via Lite `loadGltf` / `loadBabylon`; KHR_interactivity assets run through Lite's native flow-graph runtime                                                                                                                                   |
| `GLTF2.KHR_interactivity` public helpers                                                       |   ⚡   | pure operation/data normalization and exporter data types are implemented; BJS FlowGraph registry/parser/export planning throws with named structural blockers                                                                               |
| glTF 1.0 loader and extensions                                                                 |   ❌   | named `GLTF1` stubs throw; Lite has no legacy parser, extension registry, or material-conversion subsystem                                                                                                                                   |
| OpenPBR glTF material adapter                                                                  |   ❌   | exported at root and under `GLTF2`; throws because Lite has no OpenPBR material subsystem                                                                                                                                                    |
| OpenUSD (`USDFileLoader`)                                                                      |   ⚡   | delegates binary import, virtual files, callbacks, diagnostics, asset containers, and disposal to Lite; all four custom runtime assets must share one directory                                                                              |
| `SceneLoader` (`ImportMeshAsync` / `AppendAsync` / `LoadAssetContainerAsync`), `AssetsManager` |   ⚡   | `AssetContainer` partial                                                                                                                                                                                                                     |
| Gaussian Splatting (`.ply` / `.splat` / `.sog` / `.spz`)                                       |   ⚡   | via `GaussianSplattingMesh` and the binary-data `SPLATFileLoader` plugin surface; detached containers, unpackaged/streaming SOG, replaceable decoder policies, and full glTF-embedded (`KHR_gaussian_splatting`) variants remain unsupported |
| `OBJ` / `STL` / `FBX` / `BVH`                                                                  |   ❌   | parser/materializer subsystems are not in Lite — convert to glTF                                                                                                                                                                             |

### `@babylonjs/addons` · `@recast-navigation/*`

| Feature area                                                                           | Status | Notes                            |
| -------------------------------------------------------------------------------------- | :----: | -------------------------------- |
| `RecastJSPlugin` (navmesh, crowd, path, raycast, off-mesh links, tile-cache obstacles) |   ✅   | over Lite's native Recast-V2 API |

### `@babylonjs/materials`

| Feature area      | Status | Notes                                                                                          |
| ----------------- | :----: | ---------------------------------------------------------------------------------------------- |
| Library materials |   ⚡   | mapped onto the compat material surface where a Lite equivalent exists; unsupported ones throw |

> Specifiers outside the supported surface (e.g. `@babylonjs/gui`,
> `@babylonjs/inspector`) are left untouched by the bundler plugins and resolve to
> real Babylon.js, so unsupported APIs fail loudly instead of mis-mapping.

The intended migration path is:

```
@babylonjs/core  →  @babylonjs/lite-compat  →  babylon-lite (native)
```

## Missing an API you need?

The compat surface grows in response to real-world migration needs. If you hit a
Babylon.js API that isn't wrapped yet (or one that throws `LiteCompatError`),
[open an issue in the Babylon Lite repo](https://github.com/BabylonJS/Babylon-Lite/issues/new?template=compat-api-request.yml)
and add the **`compat`** label. Describe the API and your use case — issues with
the `compat` label feed directly into the layer's maintenance workflow.
