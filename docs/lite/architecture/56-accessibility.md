# Module: Accessibility

> Package path: `packages/babylon-lite/src/accessibility/`

## Purpose

Accessibility exposes meaningful objects through a logical tree and real HTML controls. The optional scene adapter observes native Lite scene objects; the DOM layer does not require a rendering backend. No Babylon GUI, React, HTML capture, or GPU pass is involved.

This reference describes the implemented contracts, including deliberate substitutions for Babylon.js. See [Add accessible scene controls](../06-accessibility.md) for application recipes and `/lite/accessibility.html` for the runnable lab example.

## Contents

- [Public API surface](#public-api-surface)
- [Internal architecture](#internal-architecture)
- [Pipeline configuration](#pipeline-configuration)
- [Shader logic and projection](#shader-logic-and-projection)
- [State machine and lifecycle](#state-machine-and-lifecycle)
- [Babylon.js equivalence map](#babylonjs-equivalence-map)
- [Dependencies](#dependencies)
- [Test specification](#test-specification)
- [File manifest](#file-manifest)

## Public API surface

Every native value and type below is exported by name from the `babylon-lite` root, published as `@babylonjs/lite`. There is no accessibility subpath export. Public handles contain data; standalone functions supply behavior. The declarations below omit `@internal` fields.

### Tags and logical trees

```typescript
export interface AccessibilityTag {
    name?: string;
    description?: string;
    role?: string;
    hidden?: boolean;
    disabled?: boolean;
    tabIndex?: 0 | -1;
    aria?: Readonly<Record<`aria-${string}`, string | number | boolean | null | undefined>>;
    eventHandler?: {
        click?: (event: MouseEvent) => void;
        contextmenu?: (event: MouseEvent | KeyboardEvent) => void;
        focus?: (event: FocusEvent) => void;
        blur?: (event: FocusEvent) => void;
    };
}

export interface AccessibilityNodeOptions {
    tag?: AccessibilityTag | null;
    parent?: AccessibilityNode | null;
    before?: AccessibilityNode | null;
    hidden?: boolean;
    disabled?: boolean;
    target?: object;
    element?: HTMLElement;
}

export interface AccessibilityNode {
    tag: AccessibilityTag | null;
    parent: AccessibilityNode | null;
    readonly children: readonly AccessibilityNode[];
    hidden: boolean;
    disabled: boolean;
    target?: object;
    element?: HTMLElement;
}

export interface AccessibilityTree {
    readonly roots: readonly AccessibilityNode[];
    readonly disposed: boolean;
}

export function setAccessibilityTag(node: object, tag: AccessibilityTag | null): void;
export function getAccessibilityTag(node: object): AccessibilityTag | null;
export function createAccessibilityTree(): AccessibilityTree;
export function addAccessibilityNode(tree: AccessibilityTree, options: AccessibilityNodeOptions): AccessibilityNode;
export function updateAccessibilityNode(tree: AccessibilityTree, node: AccessibilityNode, patch: AccessibilityNodeOptions): void;
export function removeAccessibilityNode(tree: AccessibilityTree, node: AccessibilityNode): void;
export function batchAccessibilityUpdates(tree: AccessibilityTree, update: () => void): void;
export function onAccessibilityTreeChanged(tree: AccessibilityTree, listener: () => void): () => void;
export function disposeAccessibilityTree(tree: AccessibilityTree): void;
```

Tags are defensive frozen snapshots. The implementation copies and freezes the tag, ARIA map, and handler map; callback functions retain identity. Getters return the stored snapshot or `null`. Metadata lives in a lazily allocated external `WeakMap<object, AccessibilityTag>`, not on scene components. Cloning an object does not copy its tag or observers.

`setAccessibilityTag` publishes replacement to active scene bindings. It does not add a logical node, register a native control, or update an arbitrary `AccessibilityNode`. Standalone trees receive tags through their add/update functions.

Names and descriptions are plain text. Generated leaves use `name ?? description` as visible text. Named roles such as images, groups, and regions also receive `aria-label`, including when they have no children. Authored `aria-label` overrides this fallback; a valid `aria-labelledby` takes browser naming precedence. When both name and description exist, `description` also becomes `aria-description`. The scene adapter supplies a final name fallback from the source node's `name`.

ARIA keys must match `^aria-[a-z-]+$`; numeric values must be finite. Null or undefined values remove attributes. Booleans serialize as strings. Explicit `hidden`/`disabled` values must agree with corresponding authored `aria-hidden`/`aria-disabled` values. Tags accept only the four listed event-handler keys. Positive native `tabIndex` values throw.

Tree membership and ordering follow these rules:

- Each node handle belongs to exactly one tree. `target` is caller-owned and need not be unique.
- A missing or null parent adds a root. During update, an omitted parent preserves parentage; `null` promotes to a root.
- `before` must be a sibling in the same tree. Null appends; omission preserves the current position unless the parent changes.
- Foreign nodes, cycles, invalid sibling references, and overlapping adopted elements fail validation before structural mutation.
- Updates preserve node identity. Removing a node removes its complete logical subtree and clears source, element, and tag references.
- Mutators notify synchronously. Nested batches notify once after the outermost batch; batches coalesce notifications rather than roll back completed mutations.
- All listeners are attempted. One failure is rethrown; multiple failures become `AggregateError`.

### DOM twins

```typescript
export interface HtmlTwinOptions {
    parent: HTMLElement;
    canvas?: HTMLCanvasElement;
    label?: string;
    focusVisual?: (node: AccessibilityNode, element: HTMLElement) => (() => void) | void;
}

export interface HtmlTwin {
    readonly element: HTMLDivElement;
    readonly tree: AccessibilityTree;
}

export function createHtmlTwin(tree: AccessibilityTree, options: HtmlTwinOptions): HtmlTwin;
export function updateHtmlTwin(twin: HtmlTwin): void;
export function getHtmlTwinElement(twin: HtmlTwin, node: AccessibilityNode): HTMLElement | undefined;
export function focusHtmlTwinNode(twin: HtmlTwin, node: AccessibilityNode): boolean;
export function blurHtmlTwin(twin: HtmlTwin): void;
export function disposeHtmlTwin(twin: HtmlTwin): void;
```

The twin mounts a visible `div` with `role="region"`, `tabindex="-1"`, and `aria-label` defaulting to `"Scene"`. An explicit label must be nonempty. `parent` must be connected, outside canvas and inert subtrees, in a document with a window. An optional canvas must belong to that document.

A logical item owns an outer wrapper, its semantic element, and a separate child container. Actionable generated items use `button type="button"`; descriptions use `div`. Tagged non-actionable parents expose grouping on their outer wrapper. Separating the child container prevents nested buttons. Untagged generated descriptions are hidden while their descendants remain available.

An item is actionable when it has a click or context-menu callback. Actionable generated items require a nonempty name and accept only `role="button"` as an explicit role. Non-actionable generated items accept `group`, `region`, `note`, `img`, `heading`, `status`, `log`, `alert`, `article`, `paragraph`, `list`, `listitem`, `none`, or `presentation`. This is not a complete ARIA-widget validator. Authors remain responsible for role-specific semantics.

Supplying `element` adopts the original DOM instead of creating a description or button. The element must be in the host document, outside canvas/inert/overlay hosting, and must not contain the twin. A lazily allocated registry tracks mounted borrowed elements and removes entries on disposal. Mounts and updates reject exact, ancestor, and descendant ownership overlap across twins before moving content or changing the model. A tree also rejects overlapping owners within its own membership.

Native form state remains authoritative. Both hosting APIs preflight form-associated elements throughout the borrowed subtree. A move that loses an implicit external form owner throws. Moving the whole form, hosting inside the same form, or retaining a valid explicit `form` association is allowed. The library does not generate form IDs or rewrite submission semantics.

Tags on adopted form controls or containers cannot supply `aria-checked`, `aria-selected`, `aria-valuemin`, `aria-valuemax`, `aria-valuenow`, `aria-readonly`, or `aria-multiline`; update the real inputs instead. There is no mirrored form-value model.

### Scene binding and focus

```typescript
export interface SceneAccessibilityOptions {
    roots?: readonly (SceneNode | Camera)[];
}

export interface SceneAccessibility {
    readonly tree: AccessibilityTree;
}

export function createSceneAccessibility(scene: SceneContext, options?: SceneAccessibilityOptions): SceneAccessibility;
export function updateSceneAccessibility(adapter: SceneAccessibility): void;
export function getAccessibilityNode(adapter: SceneAccessibility, node: SceneNode | Camera): AccessibilityNode | undefined;
export function setAccessibilityParent(adapter: SceneAccessibility, source: SceneNode | Camera, parent: SceneNode | Camera | null | undefined): void;
export function disposeSceneAccessibility(adapter: SceneAccessibility): void;

export interface SceneHtmlTwinOptions extends HtmlTwinOptions, SceneAccessibilityOptions {
    focusBorder?: string;
}

export interface SceneHtmlTwin {
    readonly accessibility: SceneAccessibility;
    readonly view: HtmlTwin;
}

export function createSceneHtmlTwin(scene: SceneContext, options: SceneHtmlTwinOptions): SceneHtmlTwin;
export function disposeSceneHtmlTwin(twin: SceneHtmlTwin): void;
export function showSceneFocusIndicator(
    scene: SceneContext,
    target: Pick<SceneNode, "worldMatrix"> & { boundMin?: readonly number[]; boundMax?: readonly number[] },
    canvas: HTMLCanvasElement,
    border?: string
): () => void;
```

`SceneContext` and `SceneNode` are native Lite types. The adapter's initial scan visits retained meshes, lights, a node-shaped camera, explicit roots, and their reachable parent/child hierarchy. Bind before population to capture subsequently added empty roots. Otherwise provide `roots` for unrelated empty transforms that core storage never retained.

`getAccessibilityNode` returns a stable handle while the source remains bound. `setAccessibilityParent` requires bound source and parent objects. Null overrides to a semantic root; undefined removes the override and restores transform parentage. The function never changes source transforms.

`createSceneHtmlTwin` combines the adapter and DOM view. Its canvas defaults to `scene.surface.canvas`; a DOM canvas is required. It adds the projected marker by default, then invokes any supplied `focusVisual` callback. Blur and disposal run both cleanups. `focusBorder` defaults to `"3px solid Highlight"`.

### Native controls

```typescript
export type NativeControlOptions = {
    label: string;
    disabled?: boolean;
    document?: Document;
} & (
    | { kind: "button"; onClick?: (event: MouseEvent) => void }
    | { kind: "checkbox"; checked?: boolean; name?: string; onChange?: (checked: boolean, event: Event) => void }
    | { kind: "radio"; checked?: boolean; name?: string; onChange?: (checked: boolean, event: Event) => void }
    | { kind: "range"; min: number; max: number; step?: number; value: number; onChange?: (value: number, event: Event) => void }
    | { kind: "text"; value?: string; onChange?: (value: string, event: Event) => void }
    | { kind: "select"; choices: readonly { label: string; value: string }[]; value?: string; onChange?: (value: string, event: Event) => void }
    | { kind: "image"; src: string; disabled?: never }
    | { kind: "content"; disabled?: never }
    | { kind: "group"; disabled?: never }
);

export interface NativeControl {
    readonly element: HTMLElement;
    readonly input: HTMLElement;
    readonly kind: NativeControlOptions["kind"];
}

export function createNativeControl(options: NativeControlOptions): NativeControl;
export function disposeNativeControl(control: NativeControl): void;
```

`createNativeControl` requires a nonempty label and uses `options.document ?? document`. The control factory returns live DOM; `input` is deliberately typed as `HTMLElement` because not every kind is an input.

| Kind                | `element` / `input` | Label and event contract                                                              |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `button`            | Same native button  | Visible text, `type="button"`, original click event                                   |
| `checkbox`, `radio` | Label / input       | Enclosing visible label, `change` callback with checked state; optional native `name` |
| `range`             | Label / input       | `input` callback with `valueAsNumber`; step defaults to 1                             |
| `text`              | Label / text input  | `input` callback with current value                                                   |
| `select`            | Label / select      | Choices become native options; `change` callback with current value                   |
| `image`             | Same image          | Label becomes `alt`                                                                   |
| `content`           | Same div            | Label becomes text content                                                            |
| `group`             | Same div            | `role="group"` and label becomes `aria-label`                                         |

Range validation requires finite ordered bounds (`max >= min`), an in-range finite value, and a positive finite step when supplied. Browser range normalization still applies; the factory does not enforce a separate step lattice. Select values must be unique, and an explicitly supplied value must exist. Native radio grouping uses browser form/name rules, not a logical-tree group registry.

`disabled` initializes interactive controls. Content, image, and group kinds reject that option because they have no native disabled property. Disable a registered semantic group through its logical node, or manage live DOM state directly. Disposal removes factory listeners and the element without removing caller-installed listeners or destroying application data.

### Live HTML overlays

```typescript
export interface HtmlOverlayOptions {
    canvas: HTMLCanvasElement;
    element: HTMLElement;
    parent?: HTMLElement;
    label?: string;
    mode?: "panel" | "overlay";
}

export interface HtmlOverlay {
    readonly element: HTMLDivElement;
    readonly content: HTMLElement;
}

export function createHtmlOverlay(options: HtmlOverlayOptions): HtmlOverlay;
export function updateHtmlOverlay(overlay: HtmlOverlay): void;
export function setHtmlOverlayVisible(overlay: HtmlOverlay, visible: boolean): void;
export function disposeHtmlOverlay(overlay: HtmlOverlay): void;
```

The overlay creates a region named `"Scene controls"` by default and moves the original content into a slot. An explicit label must be nonempty. The default parent is the canvas document's body. Host and content must share the canvas document; the host must be connected and outside canvas/inert subtrees. Content inside canvas, inert content, another overlay, or a twin is rejected, as are ancestry cycles.

Omitting `mode` behaves as `"panel"`, using normal document layout. `"overlay"` uses a fixed host at the canvas's CSS rectangle with `pointer-events: none`; its content slot enables pointer events and uses `width: fit-content`. ResizeObserver, window resize, and capture-phase scroll update alignment. Other application-driven layout changes require `updateHtmlOverlay`.

The overlay does not follow mesh transforms or texture coordinates. Existing HTML texture sources remain inert and owned by the texture path; the overlay does not adopt or reactivate them.

### Related animation, audio, and compat APIs

The accessibility modules do not import animation or audio. Applications compose these separately exported APIs:

```typescript
export function getSceneAnimationsEnabled(scene: SceneContext): boolean;
export function setSceneAnimationsEnabled(scene: SceneContext, enabled: boolean): void;
export function bindAnimationManagerToScene(scene: SceneContext, manager: AnimationManager): () => void;

export interface UnmuteUIOptions {
    parentElement?: HTMLElement;
    label?: string;
    onError?: (error: unknown) => void;
}

export function createUnmuteUI(engine: AudioEngine, options?: UnmuteUIOptions): UnmuteUI;
export function setUnmuteUIEnabled(ui: UnmuteUI, enabled: boolean): void;
export function disposeUnmuteUI(ui: UnmuteUI): void;
```

Scene animation is enabled by default. The gate suppresses automatic scene-group advancement and managers explicitly bound to the scene. A manager must be stopped before binding and cannot run an autonomous clock while bound. Rebinding to the same scene returns the existing detach function; binding to another scene throws. Detach and scene disposal remove the callback without changing tasks or playback intent.

The gate preserves elapsed time without replaying disabled time. It does not stop rendering, physics, audio, input, or ordinary application callbacks. Compat `Scene.animationsEnabled` also gates its property, blend, fallback animatable, and structural-group paths. It deliberately avoids Babylon.js's possible disabled-wall-time catch-up. Reduced-motion policy belongs to the application.

The unmute button uses `type="button"`, a localized `aria-label` defaulting to `"Enable audio"`, and a visible focus outline with forced-colors support. Empty labels use the default. During unlock it disables itself and sets `aria-busy`; errors reach `onError`, then the owner window's `reportError` fallback, or a queued throw. Disposal removes its listener, styles, button, and audio-state subscription.

The compat package exposes the following facade:

```typescript
export interface IAccessibilityTag extends Omit<AccessibilityTag, "tabIndex"> {
    tabIndex?: number;
}

export interface IHTMLTwinRendererOptions {
    addAllControls?: boolean;
    parentElement?: HTMLElement;
    canvas?: HTMLCanvasElement;
    label?: string;
    roots?: readonly Node[];
    focusBorder?: string;
}

export class HTMLTwinRenderer {
    readonly tree: AccessibilityTree;
    readonly view: HtmlTwin;
    static Render(scene: Scene, options?: IHTMLTwinRendererOptions): HTMLTwinRenderer;
    refresh(): void;
    focus(source: Node): boolean;
    dispose(): void;
}

export interface ActionTriggerOptions {
    trigger: number;
    parameter?: string | number | ((event: ActionEvent) => boolean);
}

export interface ActionEvent {
    source: unknown;
    pointerX: number;
    pointerY: number;
    meshUnderPointer: unknown;
    additionalData?: unknown;
    sourceEvent?: Event;
}

export function attachActionManagerKeyboard(manager: ActionManager, element: HTMLElement, source?: unknown): () => void;
```

`Node.accessibilityTag` stores frozen metadata through native external tags, and `onAccessibilityTagChangedObservable` lazily publishes replacements. Mounted views validate replacements before the source or DOM changes. Compat tab indices must be integers at least -1. Positive values sort siblings locally, while emitted DOM tab indices remain 0 or -1.

`HTMLTwinRenderer.Render` permits one view per compat scene. Its host defaults to the canvas parent, then document body. It observes canonical wrappers and preserves their identity in action events. Supply explicit roots or bind early for otherwise unretained empty wrappers. `addAllControls: true` throws `LiteCompatError`; Babylon GUI is not imported.

Explicit tag click/context-menu callbacks override inferred actions independently. Without an explicit callback, primary activation dispatches left-pick then pick; secondary activation dispatches right-pick then pick. `ActionEvent.source` and `meshUnderPointer` are the canonical wrapper, `sourceEvent` is the original mouse or keyboard event, and pointer coordinates use `clientX`/`clientY` when present. Conditions and the existing immediate `.then()` chain remain in the action manager. This does not implement a full pointer-picking pipeline.

Each trigger uses the nearest matching manager on the object or an ancestor whose `isRecursive` is true. Manager registration, removal, disposal, and recursive-state changes update descendant actionability. Direct action-array or trigger-field edits require `renderer.refresh()`.

Assigning `scene.actionManager` stages the new canvas binding before detaching the previous binding. A rejected disposed manager leaves both the previous property and its listeners intact. Explicit `attachActionManagerKeyboard` listens only when the event target is the supplied element, excluding descendant controls, composition, consumed events, and Ctrl/Alt/Meta shortcuts. It preserves Shift, native defaults, and original events. Numeric filters compare legacy key codes; string filters compare case-insensitive `key`, with a character-code fallback. Predicate filters receive the original `ActionEvent`. Manual dispatch without an event bypasses filters, matching Babylon.js. Manager or scene disposal removes listeners.

Keyboard constants are `OnKeyDownTrigger = 14` and `OnKeyUpTrigger = 15`. Three prior compat values are corrected to Babylon.js values: pointer-over 10 → 9, pointer-out 11 → 10, and every-frame 14 → 11. Applications using named constants retain trigger identity; persisted/raw numbers require migration. Conflicting numbers cannot be safely aliased.

## Internal architecture

The tree owns ordered roots, membership, subscribers, and mounted-view validators. Its public readonly arrays alias internal mutable arrays. A node owns its child array and references caller data; it never owns a mesh, scene, audio engine, or DOM handler supplied by the application.

Each scene adapter owns a map from sources to logical nodes, unsubscribe functions, explicit/captured roots, semantic-parent overrides, removed-node tracking, and a dirty set. Membership sets distinguish each independent root/addition from the active camera. External lazy weak registries hold tags, tag observers, tag validators, shared property watches, and scene adapter membership.

Canonical add/remove operations feed `sceneNodeChanged(scene, node, added)` through an optional internal callback. The first adapter installs its consumer; the last disposal restores the previous callback. Source components never hold a scene or an adapter. Observation wraps `name`, `visible`, `parent`, and `_disposed` reversibly, preserves existing accessors, and rejects non-configurable/read-only properties. Shared property watches restore the original descriptor only after their last subscriber leaves.

The scene's `camera` property is also observed reversibly. Replacement or clearing updates camera-derived membership without refreshing unrelated scene roots. An old camera remains bound when an explicit root, canonical addition, or retained transform/semantic ancestor relationship still needs it. Setting a semantic parent propagates that membership in the same batch; reparenting away retires obsolete ancestor memberships when camera membership changes. Explicit refresh establishes retained dependencies before removing unneeded bindings. Multiple views share the property observer; the final subscriber restores the descriptor and its current value.

Before retiring camera-derived bindings, camera changes process queued dirty sources within the same tree batch. This establishes dependencies from same-task natural reparenting without scanning unrelated roots, preserving retained camera handles, semantic overrides, DOM elements, and focus.

Source notifications update actionable semantic state immediately, then queue one microtask per adapter. The microtask updates dirty source nodes inside a tree batch. Dispatch and focus also consult current source ancestry and semantic overrides, closing the interval before a queued reparent reaches the DOM. A full explicit refresh visits reachable scene contents and removes stale bindings. There is no per-frame whole-scene semantic scan.

Tree notifications carry internal dirty-node, subtree, sibling-container, and removal sets. Views update those items, propagate inherited disabled state only through affected subtrees, and reorder only changed sibling containers. Text and attributes are compared before writing, so unrelated metadata changes do not rewrite live regions. Initial mount and explicit `updateHtmlTwin` perform a full refresh. Stable items retain elements and listeners; switching between a generated description and button replaces that element and preserves logical focus when appropriate.

Each dispatch exposes its change snapshot to every subscriber. Nested notifications restore the enclosing snapshot after their complete dispatch; the outer dispatch clears its snapshot even with no subscribers or observer failures. Observer errors still propagate after all subscribers have run.

The native source-state mapping is:

| Source state                           | Logical effect                                                         |
| -------------------------------------- | ---------------------------------------------------------------------- |
| No tag                                 | No generated semantic description; descendants remain eligible         |
| `visible === false`                    | Null semantic tag for this source; visible descendants remain eligible |
| Tag `hidden` or disposed source        | Hidden subtree; disposed sources are subsequently unbound              |
| Tag `disabled`                         | Exposed but non-interactive subtree                                    |
| Camera clipping, occlusion, or opacity | No automatic semantic exclusion                                        |

Explicit semantic hidden/disabled state also accepts matching ARIA attributes. Compat additionally excludes disabled nodes and their descendants through `isEnabled()`, and excludes an invisible `AbstractMesh` subtree.

The twin tracks original/applied attributes, borrowed DOM parent/sibling positions, disabled descendants, event removers, and one active focus cleanup. Attribute restoration occurs only when the current value still matches the library-applied value. Caller replacements are not overwritten during cleanup.

## Pipeline configuration

None. Accessibility allocates no GPU buffers, textures, bind groups, render targets, compute pipelines, or render passes. Scene focus is a fixed DOM rectangle. Existing renderer output and texture capture ownership are unchanged.

## Shader logic and projection

There is no accessibility shader. `showSceneFocusIndicator` projects one focused target using existing camera math:

1. Read the canvas's CSS rectangle and backing dimensions. Resolve the camera viewport and effective aspect ratio.
2. Read the target's current world matrix. Use its eight local bounding-box corners when both bounds exist, otherwise its origin.
3. Transform each local point with the column-major world matrix: `world = M * [x, y, z, 1]`.
4. Call `projectWorldToScreenToRef` with the view matrix, view-projection matrix, viewport, backing/CSS dimensions, and camera-world floating origin when enabled.
5. Reject corners behind the camera or outside depth `[0, 1]`. Expand valid CSS bounds by 6 pixels in each direction.
6. If a corner cannot be projected, try the target origin and a 12-pixel box. Clamp a valid rectangle to the camera's CSS viewport.
7. Offset by the canvas rectangle's left/top and write fixed CSS bounds. Hide the marker when there is no usable camera, canvas extent, or visible projected rectangle.

The marker has `aria-hidden="true"` and `pointer-events: none`. It starts a requestAnimationFrame loop only while focused; cleanup cancels the frame and removes the marker. Scene disposal stops the loop. An offscreen target remains in the semantic tree, with focus visible on its DOM control.

## State machine and lifecycle

### Logical state

A node moves from absent to registered, then removed. Removed handles cannot be updated or reattached; callers create a new handle. A tree moves from live to disposed. Disposal clears node references, sends a final notification, and clears listeners/validators even when an observer throws. Repeat disposal is safe.

Scene source removal differs from direct logical subtree removal. The adapter releases the source binding and promotes still-bound logical children. Overrides pointing to a removed semantic parent return to natural parentage. Core scene removal determines which native descendants are also removed.

Scene-owned adapters install an optional terminal boundary around canonical scene cleanup. After the scene becomes terminal, the boundary disposes every owned adapter before running application cleanup. Each tree drains its view subscriptions even if a focus cleanup throws. The boundary still invokes canonical scene cleanup, then rethrows one failure or aggregates multiple failures. It does not change the order or error behavior of unrelated application disposers.

Adapter disposal restores source/camera observations, clears memberships and pending work, and disposes its tree. The last adapter restores the previous optional lifecycle hooks. Tree disposal closes mounted twins. Tag snapshots remain associated with still-live caller objects.

### Input and focus

Native buttons supply Enter/Space activation; the twin does not synthesize another click. Context-menu events and ContextMenu/Shift+F10 keydown call the secondary handler with the original event and prevent the browser menu when handled.

Availability is checked again at dispatch time, including ancestor state and disposed membership. Capture listeners block click, contextmenu, keydown, keyup, and pointerdown for unavailable items. Disabled native elements and descendants receive native disabled state where applicable, `aria-disabled`, and removal from sequential Tab order. A MutationObserver applies the same state to dynamically inserted adopted descendants.

Focus outlines use `3px solid var(--lite-accessibility-focus-color, Highlight)` with a 3-pixel offset. `focusVisual` may add application feedback and return a cleanup. Focus/blur callbacks receive the original focus events.

Initial adoption and later reconciliation preserve focus and selection in an available native control. A blur handler's newer focus destination takes precedence over restoration. If a focused item disappears or becomes unavailable without such a redirection, the twin tries the next surviving control, a nearby remaining control, and the canvas. If the canvas cannot receive focus, the region receives focus instead. Programmatic focus returns false when current source or semantic ancestry makes an object unavailable, including before a queued DOM update. For an adopted label, focus its actual `NativeControl.input` directly when needed.

### DOM ownership

Twin disposal removes library listeners/styles, releases element ownership, restores borrowed elements to their original parent/sibling where possible, and restores library-managed attributes. It returns focus to the supplied canvas only if focus was inside the twin. It does not dispose the tree or caller controls.

Overlay hiding sets `hidden` and returns contained focus to the canvas. Overlay disposal disconnects resize/scroll listeners, restores the content's original parent/sibling, and removes only its host. A previously detached content element becomes detached again. The application owns native-control disposal and overlay disposal; scene disposal does not discover independent overlays.

Factories roll back their owned setup when mounting fails. Generic twin callbacks have synchronous DOM-event semantics and no `onError` option. Applications must handle promises in their own callbacks. Tree validation errors are synchronous; scene-driven DOM reconciliation is microtask-based.

## Babylon.js equivalence map

| Babylon.js capability                                     | Lite contract                                                           | Boundary                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Node.accessibilityTag`, `IAccessibilityTag`              | Native external tag functions; compat property and observable           | Frozen replacement snapshots; native clones do not inherit tags                                            |
| HTML twin scene descriptions                              | Native logical tree and scene adapter; compat `HTMLTwinRenderer.Render` | Visible native DOM, not upstream React internals                                                           |
| Grouping and ordered discovery                            | Logical parents and sibling ordering                                    | Does not change transforms or create an ARIA tree widget                                                   |
| GUI labels, buttons, form interaction                     | `createNativeControl`, adopted HTML                                     | Capability substitute; no GUI layout, renderer, `Control`, or `AdvancedDynamicTexture`                     |
| GUI positive tab order                                    | Compat local sibling sorting; native explicit ordering                  | No positive DOM tabindex                                                                                   |
| Focus feedback on meshes                                  | Default projected DOM marker plus native focus outline                  | No edges renderer, highlight layer, or new graphics pass                                                   |
| Pick-action access                                        | Compat primary/secondary twin dispatch                                  | No general canvas pointer trigger pipeline                                                                 |
| Scene key-down/key-up actions                             | Canvas-scoped manager binding and explicit keyboard attach              | No document-wide shortcuts or synthetic form events                                                        |
| `Scene.animationsEnabled`                                 | Native gate and compat property                                         | Scene-owned clocks; no wall-time catch-up or global reduced-motion policy                                  |
| Audio unlocking/playback controls                         | Named unmute button plus labelled native controls                       | Audio lifetime remains independent                                                                         |
| Live HTML interaction                                     | `createHtmlOverlay` panel or screen-aligned overlay                     | Native live DOM substitute, not a texture-interaction manager                                              |
| `HtmlInteractionManager`, `HtmlRaycastInteractionManager` | Named unsupported compat APIs                                           | No plane/perspective transform mapping, UV raycast event forwarding, or arbitrary `InternalTexture` upload |
| HTML-in-Canvas support/polyfill helpers                   | Existing unsupported compat APIs                                        | No polyfill install/uninstall or texture-source adoption                                                   |
| Separate `HtmlMesh` CSS 3D/depth-mask behavior            | Not supplied by accessibility                                           | Do not equate it with an origin marker or canvas-aligned overlay                                           |

The compat resolver maps only `@babylonjs/accessibility`, `/index`, `/HtmlTwin/index`, and `/HtmlTwin/htmlTwinRenderer`, including `.js` suffixes on those paths. Internal React/GUI item modules and `@babylonjs/gui` remain unmapped. See [compat status](../../../packages/babylon-lite-compat/COMPAT-STATUS.md#accessibility).

## Dependencies

`accessibility-tree.ts`, `html-twin.ts`, `native-control.ts`, and `html-overlay.ts` require no runtime engine, scene, camera, or GPU imports. Metadata access uses the scene-accessibility module's tree/observation/lifecycle dependencies but does not create a scene, access DOM, or allocate registries until called.

`scene-accessibility.ts` adds type-only scene/node imports and the optional scene-lifecycle feed. The separate `scene/scene-html-twin.ts` adds existing camera projection helpers. Compat imports the public `babylon-lite` root and its canonical wrapper types/classes. No dependency or package export is added for React, GUI, DOM emulation, or ARIA interpretation.

GL applications import renderer-neutral functions from `babylon-lite` alongside `babylon-lite-gl`. Neither renderer package imports the other. This supplies DOM controls without adding a GL scene graph or instantiating a WebGPU engine.

Module imports, metadata, and logical trees work headlessly. DOM factories require a document with the browser capabilities they use; they do not emulate DOM for NullEngine or OffscreenCanvas. A native scene binding may remain headless until a DOM view is explicitly requested.

## Test specification

The following files define focused contracts. Their presence is not a claim that every test has been run in a documentation-only change.

| Test file                                                             | Contract                                                                                                                               |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/lite/unit/accessibility-tree.test.ts`                          | Identity, ordering/parentage, snapshot validation, cycles/foreign nodes, notifications, subtree disposal                               |
| `tests/lite/unit/scene-accessibility.test.ts`                         | Early binding, scalar/tag updates, shared observations, descriptor restoration, parent overrides, removals, native self-visibility     |
| `tests/lite/unit/scene-animation-manager.test.ts`                     | Explicit scene clock ownership, detachment, freeze/resume                                                                              |
| `tests/lite/unit/scene-animation-tick.test.ts`                        | Scene automatic animation gating                                                                                                       |
| `tests/lite/unit/free-camera-controls.test.ts`                        | Held-key cleanup when focus leaves canvas                                                                                              |
| `tests/lite/unit/audio/unmute-ui.test.ts`                             | Button naming, focus CSS, unlock errors, cleanup                                                                                       |
| `tests/lite/plumbing/accessibility.spec.ts`                           | Chromium semantics, Tab/activation, ARIA replacement, adopted editing, focus recovery, disabled descendants, failed ownership, remount |
| `tests/lite/plumbing/accessibility-corrections.spec.ts`               | Terminal errors, cross-view ownership, form preflight/submission, leaf AX names, preflush reparent gates, focus redirection, incremental mutations, atomic manager replacement |
| `tests/lite/plumbing/accessibility-update-contracts.spec.ts`          | AX parent/leaf transitions, structural mutation isolation, inherited state, semantic override gates |
| `tests/lite/unit/scene-accessibility-membership.test.ts`              | Incremental camera membership, retained ancestors, and semantic overrides |
| `tests/lite/plumbing/accessibility-integration.spec.ts`               | Native projected focus, camera isolation, GL live overlays, compat actions/keyboard/ordering and cleanup                               |
| `tests/lite/plumbing/accessibility-example.spec.ts`                   | Runnable example controls                                                                                                              |
| `tests/lite/plumbing/accessibility-projection.spec.ts`                | Orthographic/CSS/viewport/DPI/floating-origin focus, near-plane fallback, forced colors, live form ownership and restoration           |
| `packages/babylon-lite-compat/tests/accessibility.test.ts`            | Tag bridge and exact public import mapping                                                                                             |
| `packages/babylon-lite-compat/tests/actions.test.ts`                  | Trigger constants, original events, filters, conditions, existing chaining                                                             |
| `packages/babylon-lite-compat/tests/scene-animations-enabled.test.ts` | Compat scene animation gate                                                                                                            |
| `tests/lite/build/accessibility-treeshake.test.ts`                    | Unused feature elimination and renderer-neutral dependency isolation                                                                   |
| `tests/lite/build/public-api-types.test.ts`                           | Root exports and declarations                                                                                                          |

Targeted validation uses the existing runners:

```sh
pnpm exec vitest run --project unit tests/lite/unit/accessibility-tree.test.ts tests/lite/unit/scene-accessibility.test.ts tests/lite/unit/scene-animation-manager.test.ts
pnpm exec vitest run --project compat packages/babylon-lite-compat/tests/accessibility.test.ts packages/babylon-lite-compat/tests/actions.test.ts packages/babylon-lite-compat/tests/scene-animations-enabled.test.ts
pnpm exec vitest run --project build tests/lite/build/accessibility-treeshake.test.ts tests/lite/build/public-api-types.test.ts
pnpm exec playwright test tests/lite/plumbing/accessibility.spec.ts tests/lite/plumbing/accessibility-integration.spec.ts tests/lite/plumbing/accessibility-projection.spec.ts tests/lite/plumbing/accessibility-example.spec.ts
```

Keyboard and Chromium accessibility-tree assertions do not replace manual screen-reader and forced-colors checks. Renderer screenshot parity and performance remain user/CI work. No golden, MAD threshold, or bundle ceiling is changed by this feature's documentation.

## File manifest

| File                                                                                             | Responsibility                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `packages/babylon-lite/src/accessibility/accessibility-tree.ts`                                  | Public semantic types, frozen snapshots, membership, ordering, validation, notifications |
| `packages/babylon-lite/src/accessibility/observe-property.ts`                                    | Lazy shared property observation and descriptor restoration                              |
| `packages/babylon-lite/src/accessibility/scene-accessibility.ts`                                 | External tags, source binding, dirty queue, refresh, semantic-parent override            |
| `packages/babylon-lite/src/accessibility/html-twin.ts`                                           | DOM reconciliation, native events, focus, adopted-element ownership                      |
| `packages/babylon-lite/src/scene/scene-html-twin.ts`                                             | Combined scene/view enabler and projected marker                                         |
| `packages/babylon-lite/src/accessibility/native-control.ts`                                      | Live native control factories and listener cleanup                                       |
| `packages/babylon-lite/src/accessibility/html-overlay.ts`                                        | Live panel/canvas-aligned hosting and restoration                                        |
| `packages/babylon-lite/src/accessibility/form-ownership.ts`                                       | Shared form-association preflight for borrowed DOM                                      |
| `packages/babylon-lite/src/scene/scene-lifecycle.ts`                                             | Optional opaque scene-node, animation, and terminal cleanup hooks                       |
| `packages/babylon-lite/src/scene/scene-core.ts`, `scene-remove.ts`                               | Canonical lifecycle feeds and scene disposal                                             |
| `packages/babylon-lite/src/animation/scene-animation.ts`, `scene-animation-manager.ts`           | Optional scene gate and explicit manager binding                                         |
| `packages/babylon-lite/src/audio/unmute-ui.ts`                                                   | Named, focusable audio unlock control                                                    |
| `packages/babylon-lite/src/index.ts`                                                             | Explicit root value/type exports                                                         |
| `packages/babylon-lite-compat/src/node/node.ts`                                                  | Tag property/observable and source-change bridge                                         |
| `packages/babylon-lite-compat/src/accessibility/html-twin.ts`                                    | BJS-shaped facade over canonical wrappers and native DOM                                 |
| `packages/babylon-lite-compat/src/actions/actions.ts`, `scene/scene.ts`                          | Semantic action support, canvas-scoped keys, animation forwarding                        |
| `packages/babylon-lite-compat/src/index.ts`, `bundler-resolve.ts`                                | Public facade exports and restricted import rewrite                                      |
| `lab/lite/accessibility.html`, `lab/lite/src/accessibility.ts`                                   | Runnable native scene/control/audio example                                              |
| `lab/lite/accessibility-test.html`, `lab/lite/src/accessibility-test.ts`                         | Renderer-neutral browser fixture                                                         |
| `lab/lite/accessibility-integration-test.html`, `lab/lite/src/accessibility-integration-test.ts` | Native/GL/compat browser fixture                                                         |
| `lab/lite/src/accessibility-fixture-types.ts`                                                    | Browser fixture typing                                                                   |
