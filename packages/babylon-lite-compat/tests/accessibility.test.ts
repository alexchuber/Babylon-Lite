import { describe, expect, it } from "vitest";
import { NullEngine } from "../src/engine/engine";
import { Scene } from "../src/scene/scene";
import { TransformNode } from "../src/meshes/meshes";
import { mapBabylonImport } from "../src/bundler-resolve";

describe("compat accessibility metadata", () => {
    it("snapshots Babylon-style tags and notifies replacement without mutating native transforms", () => {
        const scene = new Scene(new NullEngine());
        const node = new TransformNode("Piano", scene);
        const changes: string[] = [];
        node.onAccessibilityTagChangedObservable.add((tag) => changes.push(tag?.description ?? ""));
        const tag = { description: "Play piano", aria: { "aria-pressed": false } };
        node.accessibilityTag = tag;
        tag.description = "Unpublished change";
        expect(node.accessibilityTag?.description).toBe("Play piano");
        node.accessibilityTag = { description: "Stop piano", aria: { "aria-pressed": true } };
        expect(changes).toEqual(["Play piano", "Stop piano"]);
        scene.dispose();
    });

    it("maps only implemented public accessibility entry points", () => {
        expect(mapBabylonImport("@babylonjs/accessibility")).toBe("core");
        expect(mapBabylonImport("@babylonjs/accessibility/HtmlTwin/htmlTwinRenderer")).toBe("core");
        expect(mapBabylonImport("@babylonjs/accessibility/HtmlTwin/htmlTwinRenderer.js")).toBe("core");
        expect(mapBabylonImport("@babylonjs/accessibility/HtmlTwin/htmlTwinGUIItem")).toBeNull();
        expect(mapBabylonImport("@babylonjs/gui")).toBeNull();
    });
});
