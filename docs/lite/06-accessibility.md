# Add accessible scene controls

Use accessibility tags to describe scene objects, and use native HTML controls for interaction. Lite mounts real DOM beside the canvas without importing Babylon GUI or React.

Run `pnpm dev` from this repository, then open [the accessibility example](http://localhost:5174/lite/accessibility.html). The page demonstrates object selection, scene animation pause, audio playback, and volume controls. The route is `/lite/accessibility.html`; use your server's port if it differs.

## Contents

- [Expose meaningful scene objects](#expose-meaningful-scene-objects)
- [Update descriptions and availability](#update-descriptions-and-availability)
- [Change logical grouping and focus](#change-logical-grouping-and-focus)
- [Create native controls](#create-native-controls)
- [Host live HTML](#host-live-html)
- [Pause scene animation and control audio](#pause-scene-animation-and-control-audio)
- [Use controls with GL or without a renderer](#use-controls-with-gl-or-without-a-renderer)
- [Port Babylon.js accessibility](#port-babylonjs-accessibility)
- [Check the experience](#check-the-experience)

## Expose meaningful scene objects

Import from `@babylonjs/lite`, or from `babylon-lite` inside this workspace. Accessibility has no package subpath export.

For an existing native `scene`, `canvas`, and `mesh`, create a host outside the canvas and mount the scene twin:

```typescript
import { createSceneHtmlTwin, disposeSceneHtmlTwin, setAccessibilityTag } from "@babylonjs/lite";

const controlsHost = document.createElement("section");
canvas.after(controlsHost);
canvas.tabIndex = 0;

setAccessibilityTag(mesh, {
    name: "Select model",
    description: "Select the model to show its details.",
    eventHandler: {
        click: () => {
            detailsPanel.hidden = false;
        },
    },
});

const twin = createSceneHtmlTwin(scene, {
    parent: controlsHost,
    canvas,
    label: "Model viewer",
});

// When closing this view before disposing the scene:
disposeSceneHtmlTwin(twin);
controlsHost.remove();
```

The twin exposes a named region and a native button. Tab reaches the button; Enter and Space activate it. Focusing a scene object also displays a projected marker on the canvas. The browser keeps its normal Tab and Shift+Tab behavior, including leaving the region.

Tag meaningful objects and leave decoration untagged. Untagged transforms do not hide tagged descendants. Supply `name` for the accessible name and `description` for additional information. A description without a name supplies the name instead.

Bind before adding empty transform roots, or pass them explicitly:

```typescript
const twin = createSceneHtmlTwin(scene, {
    parent: controlsHost,
    roots: [emptyTransformRoot],
});
```

Core scene storage does not retain every empty transform. A late binding cannot discover an unrelated empty root that was never retained.

## Update descriptions and availability

Replace tags with `setAccessibilityTag`. Lite copies and freezes the tag, its ARIA map, and its handler map. Mutating your original object does not update the twin.

```typescript
import { getAccessibilityTag, setAccessibilityTag } from "@babylonjs/lite";

setAccessibilityTag(mesh, {
    ...getAccessibilityTag(mesh),
    name: "Selected model",
    aria: { "aria-pressed": true },
});
```

Pass a replacement `aria` map without an old key, or give that key `null`, to remove an attribute. Pass `null` as the tag to omit the object's generated description while preserving tagged descendants.

Use `hidden: true` to hide a semantic subtree. Use `disabled: true` to keep the subtree discoverable but prevent activation and remove its controls from Tab order. Native `visible = false` suppresses that object's description; it does not implicitly hide visible children. Use the existing visibility cascade helper when you intend to change descendants too.

Do not hide a meaningful object merely because the camera clips it or another mesh occludes it. Camera clipping can hide the projected marker without removing the semantic object. The marker does not perform occlusion testing.

Canonical scene additions, removals, camera replacement, parent changes, observed scalar changes, and tag replacement synchronize automatically. Scene updates coalesce into a microtask and update affected DOM items without rewriting unrelated live content. Activation and focus check current ancestry before that microtask runs. After direct scene-array edits, call `updateSceneAccessibility(twin.accessibility)` explicitly.

Clones start without tags. To reuse a snapshot intentionally, call `setAccessibilityTag(clone, getAccessibilityTag(source))`. This also reuses the callback functions, so check whether they capture the original object.

## Change logical grouping and focus

Use semantic parents to change accessible grouping without changing transforms:

```typescript
import { focusHtmlTwinNode, getAccessibilityNode, setAccessibilityParent } from "@babylonjs/lite";

setAccessibilityParent(twin.accessibility, mesh, logicalGroup);
const node = getAccessibilityNode(twin.accessibility, mesh);
if (node) {
    focusHtmlTwinNode(twin.view, node);
}

setAccessibilityParent(twin.accessibility, mesh, undefined);
```

Both objects must belong to the binding. Pass `null` to make the object a semantic root; pass `undefined` to restore transform parentage.

Use `tabIndex: 0` to make a description keyboard-focusable, or `-1` to allow programmatic focus without a Tab stop. Native tags reject positive values. Use logical tree ordering instead.

Set `--lite-accessibility-focus-color` on the DOM host to change the control outline. Pass `focusBorder`, such as `"3px solid Highlight"`, to change the scene marker. The default uses the system `Highlight` color. Keep sufficient contrast and test forced-colors mode.

## Create native controls

`createNativeControl` returns actual live elements, not a GUI model. Append `element`, and use `input` when reading state or focusing an input inside its label.

```typescript
import { createNativeControl, disposeNativeControl } from "@babylonjs/lite";

const search = createNativeControl({
    kind: "text",
    label: "Find an object",
    value: "",
    onChange: (value) => {
        searchResults.textContent = value;
    },
});

controlsHost.append(search.element);
search.input.focus();

// When the control is no longer needed:
disposeNativeControl(search);
```

Choose `button`, `checkbox`, `radio`, `range`, `text`, `select`, `image`, `content`, or `group`. Radio buttons use their native `name` for grouping. Select controls take `choices: [{ label, value }]`. Range controls take `min`, `max`, `value`, and an optional `step`.

The `disabled` option applies to interactive controls. To disable a group and its descendants, register it in a semantic tree and update the logical node's disabled state.

Use browser properties for later value updates. For example, narrow `control.input` to `HTMLInputElement` before setting `checked` or `value`. There is no separate control-state snapshot to synchronize. Native form state owns checked and range announcements; do not duplicate those states in an accessibility tag's ARIA map.

To include a control in a logical tree, register its live element:

```typescript
import { addAccessibilityNode, createAccessibilityTree, createHtmlTwin, disposeAccessibilityTree } from "@babylonjs/lite";

const tree = createAccessibilityTree();
addAccessibilityNode(tree, { element: search.element });
const view = createHtmlTwin(tree, { parent: controlsHost, label: "Search controls", canvas });

// Disposing the tree also removes its views and restores borrowed DOM.
disposeAccessibilityTree(tree);
```

Use `updateAccessibilityNode` for tree metadata. `setAccessibilityTag` stores external object metadata; it does not register a DOM control or replace a logical node's tag.

## Host live HTML

Use `createHtmlOverlay` when you already have a form or panel. The overlay moves the original element; inputs, selection, application listeners, and dynamic children remain live.

```typescript
import { createHtmlOverlay, disposeHtmlOverlay, setHtmlOverlayVisible, updateHtmlOverlay } from "@babylonjs/lite";

const overlay = createHtmlOverlay({
    canvas,
    element: form,
    parent: controlsHost,
    label: "Viewer settings",
    mode: "panel",
});

setHtmlOverlayVisible(overlay, false);
setHtmlOverlayVisible(overlay, true);

// Needed after application CSS moves an overlay-mode canvas without a resize.
updateHtmlOverlay(overlay);

// Restores form to its original parent and sibling position.
disposeHtmlOverlay(overlay);
```

Choose `"panel"` for normal document layout or `"overlay"` for a fixed, screen-aligned host matching the canvas's CSS bounds. Overlay mode tracks resize and scroll. Call `updateHtmlOverlay` after other layout changes, such as application CSS transforms.

Mount outside the canvas and outside inert content. Do not give overlapping elements to separate twins, or share content between an overlay and a twin. HTML texture sources remain inert and are rejected; create separate live controls instead of adopting the texture's source element.

Preserve the original form owner when hosting inputs. Move the whole form, choose a host inside that form, or supply an already valid explicit `form` attribute. Twins and overlays reject moves that would silently remove an input from form submission or validation.

This API does not implement `HtmlInteractionManager`, `HtmlRaycastInteractionManager`, textured-plane perspective or UV hit testing, CSS 3D `HtmlMesh` behavior, arbitrary texture uploads, or HTML-in-Canvas polyfill management.

## Pause scene animation and control audio

Use the scene animation gate for scene-owned animation groups:

```typescript
import { createNativeControl, getSceneAnimationsEnabled, setSceneAnimationsEnabled } from "@babylonjs/lite";

const motion = createNativeControl({
    kind: "checkbox",
    label: "Animate scene",
    checked: getSceneAnimationsEnabled(scene),
    onChange: (enabled) => setSceneAnimationsEnabled(scene, enabled),
});
controlsHost.append(motion.element);
```

Use `bindAnimationManagerToScene(scene, manager)` to include an otherwise independent, stopped animation manager. Its returned function detaches the manager. A bound manager cannot start an autonomous clock until detached.

Disabling advancement retains animation time and playback intent; re-enabling does not replay disabled time. Rendering, input, physics, ordinary callbacks, and audio continue. Arbitrary application animation remains your responsibility. If your application honors `prefers-reduced-motion`, use the same gate to apply that policy.

Use existing audio functions such as `playSound`, `pauseSound`, `resumeSound`, and `setMasterVolume` from labelled buttons and ranges. Mount the audio-unlock control with a localized name and an error handler:

```typescript
import { createUnmuteUI, disposeUnmuteUI } from "@babylonjs/lite";

const unmute = createUnmuteUI(audioEngine, {
    parentElement: controlsHost,
    label: "Enable viewer audio",
    onError: (error) => {
        errorMessage.textContent = String(error);
    },
});

// Dispose before removing the host.
disposeUnmuteUI(unmute);
```

The unmute button has native button semantics and visible focus. Without `onError`, unlock failures reach the owner window's error-reporting path. See the example for a complete audio setup.

## Use controls with GL or without a renderer

Import renderer-neutral accessibility functions from `@babylonjs/lite` alongside your renderer:

```typescript
import { createGLEngine } from "@babylonjs/lite-gl";
import { createHtmlOverlay, createNativeControl } from "@babylonjs/lite";
```

The workspace equivalents are `babylon-lite-gl` and `babylon-lite`. Neither renderer imports the other. GL applications can use logical trees, DOM twins, controls, and overlays; `createSceneAccessibility` and `createSceneHtmlTwin` require the native Lite scene model, not a GL engine.

Metadata and logical trees work without a document. Importing the package does not access the DOM. DOM factories require a browser document; `createNativeControl` also accepts an explicit `document`. An offscreen or headless renderer does not gain an HTML view automatically.

## Port Babylon.js accessibility

Use `Node.accessibilityTag` and `HTMLTwinRenderer.Render` through the compat package:

```typescript
import { HTMLTwinRenderer } from "@babylonjs/lite-compat";

mesh.accessibilityTag = {
    description: "Select model",
    eventHandler: { click: () => showDetails(mesh) },
};
const renderer = HTMLTwinRenderer.Render(scene, { parentElement: controlsHost });

// Scene disposal also performs this cleanup.
renderer.dispose();
```

Explicit tag callbacks take precedence over inferred pick actions. Otherwise, the twin forwards supported primary and secondary pick triggers with the canonical wrapper and original DOM event. Assign `scene.actionManager` to receive canvas-scoped key triggers; it does not intercept keys in sibling form controls.

Do not import Babylon GUI to obtain these controls. `addAllControls: true` throws, and `Control`/`AdvancedDynamicTexture` are not implemented by this feature. See the [compat status](../../packages/babylon-lite-compat/COMPAT-STATUS.md#accessibility) for import mappings, trigger-number migration, and unsupported contracts.

## Check the experience

Check your application with real browser input and a screen reader:

1. Tab from before the canvas through the controls and out of the region. Repeat with Shift+Tab.
2. Activate buttons with Enter and Space. Open secondary actions with the context-menu key or Shift+F10.
3. Edit text, move a range, and select radio and select options. Confirm that the camera does not keep moving afterward.
4. Update labels, reparent a focused object, then hide or remove it. Confirm that focus remains useful.
5. Pause animation and audio independently. Resume without restarting intentionally paused animations.
6. Inspect names, descriptions, grouping, disabled state, and live updates with your target screen reader.
7. Check focus in forced colors, resize the canvas, and dispose then remount the UI.

Automated Chromium accessibility-tree and keyboard tests are engineering evidence, not accessibility certification. The [architecture reference](architecture/56-accessibility.md) defines the API, ownership, and test contracts.
