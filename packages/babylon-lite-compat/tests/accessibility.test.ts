import { describe, expect, it, vi } from "vitest";
import { HTMLTwinRenderer } from "../src/accessibility/html-twin";
import { ArcRotateCamera } from "../src/cameras/cameras";
import { NullEngine } from "../src/engine/engine";
import { HemisphericLight } from "../src/lights/lights";
import { Mesh, TransformNode } from "../src/meshes/meshes";
import { Vector3 } from "../src/math/vector";
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

    public getAttribute(name: string): string | null {
        return this._attributes.get(name) ?? null;
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

    it("adds explicit roots to retained scene objects", () => {
        const scene = new Scene(new NullEngine());
        const mesh = new TransformNode("Mesh");
        scene.meshes.push(mesh);
        const camera = new ArcRotateCamera("Camera", 0, 1, 10, Vector3.Zero(), scene);
        const light = new HemisphericLight("Light", Vector3.Up(), scene);
        const explicit = new TransformNode("Explicit");
        const document = new TestDocument();
        const parent = new TestElement(document);

        const renderer = HTMLTwinRenderer.Render(scene, {
            parentElement: parent as unknown as HTMLElement,
            roots: [explicit],
        });
        const targets = new Set(renderer.tree._nodes.values().map((node) => node.target));

        expect(targets).toEqual(new Set([mesh, camera, light, explicit]));
        renderer.dispose();
        scene.dispose();
    });

    it("renders description-only metadata once", () => {
        const scene = new Scene(new NullEngine());
        const root = new TransformNode("Source name");
        root.accessibilityTag = { description: "A descriptive object", role: "img" };
        const document = new TestDocument();
        const parent = new TestElement(document);

        const renderer = HTMLTwinRenderer.Render(scene, {
            parentElement: parent as unknown as HTMLElement,
            roots: [root],
        });
        const node = renderer.tree.roots[0]!;
        const item = renderer.view._items.get(node)!;
        const element = item.element as unknown as TestElement;
        const text = item.text as unknown as TestElement;

        expect(element.getAttribute("aria-label")).toBe("A descriptive object");
        expect(element.getAttribute("aria-description")).toBeNull();
        expect(text.textContent).toBe("A descriptive object");
        renderer.dispose();
        scene.dispose();
    });

    it("does not refresh accessibility for repeated visibility assignments", () => {
        const scene = new Scene(new NullEngine());
        const mesh = new Mesh("Mesh", { name: "Mesh", children: [], visible: true, receiveShadows: false } as never);
        (mesh as unknown as { _scene: Scene })._scene = scene;
        const changed = vi.fn();
        scene._accessibilityNodeChanged = changed;

        mesh.isVisible = false;
        mesh.isVisible = false;

        expect(mesh._lite.visible).toBe(false);
        expect(changed).toHaveBeenCalledOnce();
        scene.dispose();
    });

    it("creates refreshed hierarchy bindings at their final parent", () => {
        const scene = new Scene(new NullEngine());
        const roots: TransformNode[] = [];
        const document = new TestDocument();
        const parent = new TestElement(document);
        const renderer = HTMLTwinRenderer.Render(scene, {
            parentElement: parent as unknown as HTMLElement,
            roots,
        });
        const group = new TransformNode("Group");
        const children = Array.from({ length: 24 }, (_, index) => {
            const child = new TransformNode(`Child ${index}`);
            child.parent = group;
            return child;
        });
        const treeRoots = renderer.tree._roots;
        const splice = treeRoots.splice.bind(treeRoots);
        let rootDetachCount = 0;
        treeRoots.splice = ((start: number, deleteCount = treeRoots.length - start, ...items: Array<(typeof treeRoots)[number]>) => {
            if (deleteCount) {
                rootDetachCount += deleteCount;
            }
            return splice(start, deleteCount, ...items);
        }) as typeof treeRoots.splice;

        roots.push(group);
        renderer.refresh();
        treeRoots.splice = splice;

        expect(rootDetachCount).toBe(0);
        expect(renderer.tree.roots[0]?.children).toHaveLength(children.length);
        renderer.dispose();
        scene.dispose();
    });
});
