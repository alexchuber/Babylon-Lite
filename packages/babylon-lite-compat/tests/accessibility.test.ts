import { describe, expect, it } from "vitest";
import { HTMLTwinRenderer } from "../src/accessibility/html-twin";
import { NullEngine } from "../src/engine/engine";
import { TransformNode } from "../src/meshes/meshes";
import { Scene } from "../src/scene/scene";
import { ActionManager, ExecuteCodeAction } from "../src/actions/actions";

class TestElement {
    public readonly style: Record<string, string> = {};
    public className = "";
    public hidden = false;
    public textContent = "";
    public parent: TestElement | null = null;
    public readonly children: TestElement[] = [];
    private readonly _attributes = new Map<string, string>();

    public constructor(public readonly ownerDocument: TestDocument) {}

    public get attributes(): { name: string; value: string }[] {
        return [...this._attributes].map(([name, value]) => ({ name, value }));
    }

    public setAttribute(name: string, value: string): void {
        this._attributes.set(name, value);
    }

    public removeAttribute(name: string): void {
        this._attributes.delete(name);
    }

    public append(...children: TestElement[]): void {
        for (const child of children) {
            child.remove();
            child.parent = this;
            this.children.push(child);
        }
    }

    public remove(): void {
        if (!this.parent) {
            return;
        }
        const index = this.parent.children.indexOf(this);
        if (index !== -1) {
            this.parent.children.splice(index, 1);
        }
        this.parent = null;
    }
}

class TestDocument {
    public createElement(): TestElement {
        return new TestElement(this);
    }
}

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

    it("renders explicit descendants and authored hidden state", () => {
        const scene = new Scene(new NullEngine());
        const root = new TransformNode("Root");
        const child = new TransformNode("Child");
        child.parent = root;
        root.accessibilityTag = { name: "Root", hidden: true };
        child.accessibilityTag = { name: "Child" };
        const document = new TestDocument();
        const parent = new TestElement(document);

        const renderer = HTMLTwinRenderer.Render(scene, {
            parentElement: parent as unknown as HTMLElement,
            roots: [root],
        });

        expect(renderer.tree.roots).toHaveLength(1);
        expect(renderer.tree.roots[0].children[0]?.target).toBe(child);
        expect(renderer.tree.roots[0].hidden).toBe(true);
        renderer.dispose();
        scene.dispose();
    });
});
