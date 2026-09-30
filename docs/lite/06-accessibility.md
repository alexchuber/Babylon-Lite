# Scene accessibility

Babylon Lite can expose scene descriptions, roles, and ARIA attributes through an HTML representation that stays synchronized with the scene.

## Describe scene objects

Attach immutable metadata with `setAccessibilityTag`:

```ts
import { setAccessibilityTag } from "@babylonjs/lite";

setAccessibilityTag(mesh, {
    name: "Mars",
    description: "The fourth planet from the Sun",
    role: "img",
    aria: {
        "aria-roledescription": "planet",
        "aria-live": "polite",
    },
});
```

`AccessibilityTag` supports these fields:

| Field         | Purpose                                                                    |
| ------------- | -------------------------------------------------------------------------- |
| `name`        | The accessible name.                                                       |
| `description` | Additional readable text. If `name` is absent, this is the name.           |
| `role`        | An authored ARIA role.                                                     |
| `hidden`      | Hides the object and its descendants from the representation.              |
| `disabled`    | Reports the object and its descendants as unavailable.                     |
| `aria`        | A map of `aria-*` attributes, including states and live-region attributes. |

Replacing the tag replaces the published semantics. Pass `null` to remove the tag.

## Mount a scene view

Create the view before scene population when you need it to retain transform-only nodes:

```ts
import { addToScene, createSceneHtmlTwin, setAccessibilityTag } from "@babylonjs/lite";

const twin = createSceneHtmlTwin(scene, {
    parent: document.body,
    label: "Solar system scene",
});

setAccessibilityTag(mesh, {
    name: "Mars",
    description: "The fourth planet from the Sun",
    role: "img",
});
addToScene(scene, mesh);
```

For transform-only objects that were added before the view was created, pass them through `roots`:

```ts
const twin = createSceneHtmlTwin(scene, {
    parent: document.body,
    roots: [logicalGroup],
});
```

The view creates nested `div` elements with readable text, authored roles, and ARIA attributes. Use roles that match the application's behavior.

## Keep the view current

The scene binding updates after:

- `setAccessibilityTag` replaces or removes metadata.
- `addToScene` adds an object.
- `removeFromScene` removes an object.
- A tracked object's `name`, `visible`, or `parent` property changes.
- The active camera changes.
- The scene is disposed.

Natural scene parentage defines the HTML hierarchy. Use `setAccessibilityParent` when the semantic hierarchy must differ from the render transform:

```ts
setAccessibilityParent(twin.accessibility, mesh, logicalGroup);
```

Pass `undefined` as the parent to restore natural scene parentage.

## Use the model without the DOM

Headless tools can create a scene binding without mounting HTML:

```ts
const accessibility = createSceneAccessibility(scene, {
    roots: [logicalGroup],
});

const node = getAccessibilityNode(accessibility, mesh);
```

The lower-level `AccessibilityTree` API can also represent non-scene hierarchies.

## Clean up

`disposeSceneHtmlTwin(twin)` removes the HTML and scene binding. Disposing the scene also disposes its accessibility tree and mounted view.

This API exposes authored semantics. It does not certify an application against WCAG or any other accessibility standard.
