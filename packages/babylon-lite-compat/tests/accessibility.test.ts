import { describe, expect, it } from "vitest";
import { NullEngine } from "../src/engine/engine";
import { TransformNode } from "../src/meshes/meshes";
import { Scene } from "../src/scene/scene";
import { ActionManager, ExecuteCodeAction } from "../src/actions/actions";

describe("compat accessibility metadata", () => {
    it("stores descriptive ARIA without deriving semantics from actions", () => {
        const scene = new Scene(new NullEngine());
        const mesh = new TransformNode("Cube", scene);
        mesh.accessibilityTag = {
            name: "Red cube",
            description: "A decorative cube",
            role: "img",
            aria: { "aria-roledescription": "scene object" },
        };
        const manager = new ActionManager();
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {}));
        mesh.actionManager = manager;

        expect(mesh.accessibilityTag).toEqual({
            name: "Red cube",
            description: "A decorative cube",
            role: "img",
            aria: { "aria-roledescription": "scene object" },
        });
        scene.dispose();
    });
});
