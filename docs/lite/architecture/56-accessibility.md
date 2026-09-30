# Module: accessibility

> Package path: `packages/babylon-lite/src/accessibility/`

## Purpose

The accessibility module stores descriptive scene metadata and projects it into passive HTML. The module does not implement controls or scene interaction.

## Public API

```ts
interface AccessibilityTag {
    name?: string;
    description?: string;
    role?: string;
    hidden?: boolean;
    disabled?: boolean;
    aria?: Readonly<Record<`aria-${string}`, string | number | boolean | null | undefined>>;
}

function setAccessibilityTag(source: object, tag: AccessibilityTag | null): void;
function getAccessibilityTag(source: object): AccessibilityTag | null;

function createSceneAccessibility(scene: SceneContext, options?: { roots?: readonly (SceneNode | Camera)[] }): SceneAccessibility;
function updateSceneAccessibility(accessibility: SceneAccessibility): void;
function getAccessibilityNode(accessibility: SceneAccessibility, source: SceneNode | Camera): AccessibilityNode | undefined;
function setAccessibilityParent(accessibility: SceneAccessibility, source: SceneNode | Camera, parent: SceneNode | Camera | null | undefined): void;
function disposeSceneAccessibility(accessibility: SceneAccessibility): void;

function createSceneHtmlTwin(scene: SceneContext, options: SceneHtmlTwinOptions): SceneHtmlTwin;
function disposeSceneHtmlTwin(twin: SceneHtmlTwin): void;
```

The root package also exports the lower-level tree and HTML twin functions.

## Internal architecture

`AccessibilityTree` owns plain nodes with immutable tag snapshots, logical parents, child arrays, availability state, and optional source references. Mutations validate before publication and notify observers after completion.

`SceneAccessibility` maps scene sources to stable accessibility nodes. It installs one optional `_accessibility` hook on `SceneContext`. Core scene code calls this hook when objects enter or leave the scene. Scenes that do not enable accessibility retain no accessibility imports or runtime allocations.

The adapter observes `name`, `visible`, `parent`, and disposal state on retained sources. It coalesces direct writes into one microtask update. `setAccessibilityTag` validates and freezes metadata before storing it in a lazy `WeakMap`, then notifies only active bindings.

`HtmlTwin` subscribes to a tree and renders one nested `div` per logical node. Each element receives:

- `role` when authored.
- `aria-label` from `name`, or from `description` when `name` is absent.
- `aria-description` when both `name` and `description` exist.
- Every authored `aria-*` attribute.
- `hidden` and `aria-disabled` when the effective state requires them.
- Text content for the name and description.

The renderer uses `textContent`, so authored text cannot inject HTML.

## Lifecycle

1. `createSceneAccessibility` rejects a second binding on the same scene.
2. The binding captures retained meshes, the active camera, and explicit roots.
3. Scene additions and removals update automatic membership.
4. Metadata and property writes schedule one microtask refresh.
5. The refresh preserves node identity, updates hierarchy and semantics, then removes stale nodes.
6. Scene disposal disposes the binding, tree, and mounted HTML.

## Interaction boundary

The module does not create native controls or interactive overlays. It adds no click, context-menu, pointer, keyboard, focus, or blur listeners. It adds no `tabindex`.

Roles and ARIA states remain declarative. Authors must provide any behavior required by an interactive role outside this module.

## Dependencies

- `scene-core.ts` provides the optional scene membership and disposal hook.
- `scene-remove.ts` reports removals through the same hook.
- `observe-property.ts` installs reversible property observation only while a binding exists.

The module has no renderer, animation, audio, picking, action, camera-control, GUI, or form-ownership dependency.

## Test specification

- Unit tests cover immutable tags, ARIA validation, hierarchy, updates, removal, disposal, scene membership, visibility, and semantic parent overrides.
- Browser tests cover readable text, role and ARIA replacement, escaped text, hierarchy updates, visibility, cleanup, and the absence of controls and tab stops.
- Build tests cover root exports, headless import, and tree-shaking when the feature is unused.

## File manifest

| File                     | Responsibility                                  |
| ------------------------ | ----------------------------------------------- |
| `accessibility-tree.ts`  | Logical model and mutations.                    |
| `html-twin.ts`           | Passive HTML projection.                        |
| `observe-property.ts`    | Reversible property observation.                |
| `scene-accessibility.ts` | Scene membership, metadata, and lifecycle sync. |
| `scene-html-twin.ts`     | Owned scene-and-HTML convenience API.           |
