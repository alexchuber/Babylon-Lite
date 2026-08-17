# PR Draft

## Title

`feat(gltf): add scene GLB export`

## Description

## Summary

- add a tree-shakable `exportSceneGLB(scene)` API that returns a glTF 2.0 `Blob` with the `model/gltf-binary` MIME type
- export the scene mesh graph from retained CPU positions, normals, optional UVs, and indices, including transform-only ancestors and explicitly shared geometry
- match Babylon.js exporter behavior for LH-to-RH conversion, removable loader coordinate roots, authored winding/root compensation, negative scales, and deterministic GLB packing
- document the architecture and add direct GLB assertions, one re-import smoke test, one combined Babylon.js parity scene, and a separate download demo

## Scope

This first pass exports static base mesh geometry and its transform hierarchy as one `.glb`.

Materials, textures, images, cameras, lights, animations, skins, baked morph/VAT output, thin-instance expansion, metadata, glTF extensions, and `.gltf` plus sidecar files remain out of scope. Meshes with those features still export their retained base geometry where applicable.

The package API creates the `Blob`; download behavior stays in the lab demo.

## Testing

> Replace every pending value with measured results before opening the PR.

- [ ] ESLint and Prettier checks
- [ ] Babylon Lite, lab, and Lite test TypeScript projects
- [ ] focused public-seam GLB framing, hierarchy, geometry, handedness, winding, sharing, and coded-error tests
- [ ] one export/re-import smoke test
- [ ] scene 283 exporter parity against a one-time Babylon.js golden
- [ ] Rollup and webpack tree-shaking checks
- [ ] filtered smallest-scene bundle builds with no unrelated manifest movement
- [ ] glTF exporter demo download smoke
- [ ] downloaded GLB opens without modification in an independent external viewer
- [ ] final code review

Bundle sizes:

- scene 283: `[pending] KB raw` (`[pending] KB` ceiling)
- glTF exporter demo: `[pending] KB raw / [pending] KB gzip`

No existing bundle ceiling, MAD threshold, or golden reference should change for this feature.
