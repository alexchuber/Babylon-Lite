import { describe, expect, it, vi } from "vitest";
import {
    createAnimationGroups,
    createAnimationManager,
    createPropertyAnimationClip,
    createPropertyAnimationGroup,
    playAnimation,
    stepScene,
    updateAnimationManager,
    getSceneAnimationsEnabled,
    setSceneAnimationsEnabled,
} from "babylon-lite";
import { NullEngine } from "../src/engine/engine";
import { Scene } from "../src/scene/scene";
import { Animation, AnimationGroup, AnimationKeyInterpolation } from "../src/animations/animation";

function slide(name: string, mixedInterpolation = false): Animation {
    const animation = new Animation(name, "x", 10);
    animation.setKeys([
        { frame: 0, value: 0, interpolation: mixedInterpolation ? AnimationKeyInterpolation.STEP : AnimationKeyInterpolation.NONE },
        { frame: 5, value: 5 },
        { frame: 10, value: 10 },
    ]);
    return animation;
}

describe("Scene.animationsEnabled", () => {
    it("defaults to true and shares its state with the native scene", () => {
        const scene = new Scene(new NullEngine());
        expect(scene.animationsEnabled).toBe(true);
        scene.animationsEnabled = false;
        expect(getSceneAnimationsEnabled(scene._lite)).toBe(false);
        setSceneAnimationsEnabled(scene._lite, true);
        expect(scene.animationsEnabled).toBe(true);
        scene.dispose();
    });

    it("freezes native-backed, fallback, and structural animation clocks without stopping render work", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const nativeTarget = { x: 0 };
        const fallbackTarget = { x: 0 };
        const structuralTarget = { x: 0 };
        const native = scene.beginDirectAnimation(nativeTarget, [slide("native")], 0, 10);
        const fallback = scene.beginDirectAnimation(fallbackTarget, [slide("fallback", true)], 0, 10);
        const structural = new AnimationGroup("structural", scene);
        structural.addTargetedAnimation(slide("structural"), structuralTarget);
        structural.start(false);
        const beforeRender = vi.fn();
        const afterRender = vi.fn();
        scene.onBeforeRenderObservable.add(beforeRender);
        scene.onAfterRenderObservable.add(afterRender);

        stepScene(engine._lite, scene._lite, 600);
        expect(native._lite).toBeDefined();
        expect(fallback._lite).toBeUndefined();
        expect([nativeTarget.x, fallbackTarget.x, structuralTarget.x]).toEqual([6, 6, 6]);
        expect([native.masterFrame, fallback.masterFrame]).toEqual([6, 6]);
        scene.animationsEnabled = false;
        stepScene(engine._lite, scene._lite, 5000);
        stepScene(engine._lite, scene._lite, 5000);
        expect([nativeTarget.x, fallbackTarget.x, structuralTarget.x]).toEqual([6, 6, 6]);
        expect([native.masterFrame, fallback.masterFrame]).toEqual([6, 6]);
        expect(structural.isPlaying).toBe(true);
        expect(beforeRender).toHaveBeenCalledTimes(3);
        expect(afterRender).toHaveBeenCalledTimes(2);
        expect(engine.getDeltaTime()).toBe(5000);

        scene.animationsEnabled = true;
        stepScene(engine._lite, scene._lite, 100);
        expect([nativeTarget.x, fallbackTarget.x, structuralTarget.x]).toEqual([7, 7, 7]);
        expect([native.masterFrame, fallback.masterFrame]).toEqual([7, 7]);
        scene.dispose();
    });

    it("freezes loaded groups adopted by the compat weighted-blend manager", () => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        scene._lite.animationGroups = createAnimationGroups({
            clips: [{ name: "loaded", duration: 1, samplers: [], channels: [] }],
            nodes: [],
            skeletons: [],
            morphBindings: [],
            nodeTargets: [],
            excludedNodeIndices: new Set(),
            nodeNames: [],
        });
        const nativeGroup = scene._lite.animationGroups[0]!;
        const group = scene.animationGroups[0]!;
        group.weight = 0.5;
        group.play();

        stepScene(engine._lite, scene._lite, 200);
        expect(nativeGroup.currentTime).toBeCloseTo(0.2);
        scene.animationsEnabled = false;
        stepScene(engine._lite, scene._lite, 5250);
        expect(nativeGroup.currentTime).toBeCloseTo(0.2);
        scene.animationsEnabled = true;
        stepScene(engine._lite, scene._lite, 100);
        expect(nativeGroup.currentTime).toBeCloseTo(0.3);
        scene.dispose();
    });

    it("does not gate a standalone native animation manager", () => {
        const scene = new Scene(new NullEngine());
        scene.animationsEnabled = false;
        const target = { x: 0 };
        const manager = createAnimationManager();
        const clip = createPropertyAnimationClip(
            "standalone",
            [
                {
                    path: "x",
                    keys: [
                        { frame: 0, value: 0 },
                        { frame: 10, value: 10 },
                    ],
                },
            ],
            { frameRate: 10 }
        );
        const group = createPropertyAnimationGroup(manager, target, clip);
        playAnimation(group);
        updateAnimationManager(manager, 500);
        expect(target.x).toBe(5);
        scene.dispose();
    });
});
