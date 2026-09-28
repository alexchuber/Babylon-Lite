import { afterEach, describe, expect, it, vi } from "vitest";

import {
    ActionManager,
    ExecuteCodeAction,
    SetValueAction,
    IncrementValueAction,
    ValueCondition,
    PredicateCondition,
    ValueConditionOperators,
    ActionManagerTriggers,
    attachActionManagerKeyboard,
} from "../src/actions/actions";
import type { ActionEvent } from "../src/actions/actions";

class TestKeyboardEvent extends Event {
    public readonly charCode = 0;
    public readonly isComposing: boolean;
    public readonly ctrlKey: boolean;
    public readonly altKey: boolean;
    public readonly metaKey: boolean;

    public constructor(
        type: string,
        public readonly key: string,
        public readonly keyCode = 0,
        options: KeyboardEventInit = {}
    ) {
        super(type, { cancelable: true });
        this.isComposing = options.isComposing ?? false;
        this.ctrlKey = options.ctrlKey ?? false;
        this.altKey = options.altKey ?? false;
        this.metaKey = options.metaKey ?? false;
    }
}

function keyEvent(key: string, keyCode = 0): ActionEvent {
    return { source: null, pointerX: 0, pointerY: 0, meshUnderPointer: null, sourceEvent: new TestKeyboardEvent("keydown", key, keyCode) };
}

describe("ActionManager", () => {
    it("dispatches actions matching a trigger", () => {
        const manager = new ActionManager();
        const fn = vi.fn();
        manager.registerAction(new ExecuteCodeAction(ActionManagerTriggers.OnPickTrigger, fn));
        manager.processTrigger(ActionManagerTriggers.OnPickTrigger);
        expect(fn).toHaveBeenCalledTimes(1);
        // A different trigger does not fire it.
        manager.processTrigger(ActionManagerTriggers.OnPointerOverTrigger);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("exposes triggers as a static and reports specific triggers", () => {
        expect(ActionManager.Triggers.OnPickTrigger).toBe(1);
        const manager = new ActionManager();
        manager.registerAction(new ExecuteCodeAction(ActionManagerTriggers.OnPickTrigger, () => {}));
        expect(manager.hasSpecificTrigger(ActionManagerTriggers.OnPickTrigger)).toBe(true);
        expect(manager.hasSpecificTrigger(ActionManagerTriggers.OnPickUpTrigger)).toBe(false);
    });

    it("matches the pinned Babylon.js keyboard, pointer, and frame trigger constants", () => {
        expect(ActionManagerTriggers.OnPointerOverTrigger).toBe(9);
        expect(ActionManagerTriggers.OnPointerOutTrigger).toBe(10);
        expect(ActionManagerTriggers.OnEveryFrameTrigger).toBe(11);
        expect(ActionManagerTriggers.OnKeyDownTrigger).toBe(14);
        expect(ActionManagerTriggers.OnKeyUpTrigger).toBe(15);
        for (const [name, value] of Object.entries(ActionManagerTriggers)) {
            expect(Reflect.get(ActionManager, name)).toBe(value);
        }
    });

    it("matches case-insensitive string keys, named keys, numeric key codes, and unfiltered triggers", () => {
        const manager = new ActionManager();
        const stringKey = vi.fn();
        const namedKey = vi.fn();
        const numericKey = vi.fn();
        const anyKey = vi.fn();
        const options = { trigger: ActionManager.OnKeyDownTrigger, parameter: "a" };
        const action = new ExecuteCodeAction(options, stringKey);
        expect(action.triggerOptions).toBe(options);
        expect(action.getTriggerParameter()).toBe("a");
        manager.registerAction(action);
        manager.registerAction(new ExecuteCodeAction({ trigger: ActionManager.OnKeyDownTrigger, parameter: "Enter" }, namedKey));
        manager.registerAction(new ExecuteCodeAction({ trigger: ActionManager.OnKeyDownTrigger, parameter: 65 }, numericKey));
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnKeyDownTrigger, anyKey));

        const event = keyEvent("A", 65);
        manager.processTrigger(ActionManager.OnKeyDownTrigger, event);
        expect(stringKey).toHaveBeenCalledExactlyOnceWith(event);
        expect(numericKey).toHaveBeenCalledExactlyOnceWith(event);
        expect(namedKey).not.toHaveBeenCalled();
        manager.processTrigger(ActionManager.OnKeyDownTrigger, keyEvent("Enter", 13));
        expect(namedKey).toHaveBeenCalledOnce();
        expect(stringKey).toHaveBeenCalledOnce();
        expect(anyKey).toHaveBeenCalledTimes(2);
    });

    it("supports legacy character codes without confusing keyup, keydown, and every-frame actions", () => {
        const manager = new ActionManager();
        const keyUp = vi.fn();
        const frame = vi.fn();
        manager.registerAction(new ExecuteCodeAction({ trigger: ActionManager.OnKeyUpTrigger, parameter: "a" }, keyUp));
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnEveryFrameTrigger, frame));
        manager.processTrigger(ActionManager.OnKeyDownTrigger, keyEvent("a", 65));
        expect(keyUp).not.toHaveBeenCalled();
        expect(frame).not.toHaveBeenCalled();
        manager.processTrigger(ActionManager.OnKeyUpTrigger, keyEvent("", 65));
        expect(keyUp).toHaveBeenCalledOnce();
        manager.processTrigger(ActionManager.OnEveryFrameTrigger);
        expect(frame).toHaveBeenCalledOnce();
    });

    it("preserves manual no-event dispatch while rejecting a nonkeyboard source event", () => {
        const manager = new ActionManager();
        const fn = vi.fn();
        manager.registerAction(new ExecuteCodeAction({ trigger: ActionManager.OnKeyDownTrigger, parameter: "a" }, fn));
        manager.processTrigger(ActionManager.OnKeyDownTrigger);
        manager.processTrigger(ActionManager.OnKeyDownTrigger, { ...keyEvent("a"), sourceEvent: new Event("click") });
        expect(fn).toHaveBeenCalledOnce();
        expect(fn).toHaveBeenCalledWith(undefined);
    });

    it("passes the original action event to keyboard predicate filters", () => {
        const manager = new ActionManager();
        const event = keyEvent("a", 65);
        const predicate = vi.fn((candidate: ActionEvent) => candidate === event);
        const executed = vi.fn();
        manager.registerAction(new ExecuteCodeAction({ trigger: ActionManager.OnKeyDownTrigger, parameter: predicate }, executed));
        manager.processTrigger(ActionManager.OnKeyDownTrigger, event);
        manager.processTrigger(ActionManager.OnKeyDownTrigger, keyEvent("b", 66));
        expect(predicate).toHaveBeenCalledTimes(2);
        expect(executed).toHaveBeenCalledExactlyOnceWith(event);
    });
});

describe("element-scoped action keyboard dispatch", () => {
    afterEach(() => vi.unstubAllGlobals());

    function createElement(): HTMLElement {
        vi.stubGlobal("document", { createElement: () => new EventTarget() });
        return document.createElement("canvas");
    }

    it("dispatches the original key events only on the attached element and disposes its listeners", () => {
        const element = createElement();
        const outside = createElement();
        const manager = new ActionManager();
        const down = vi.fn();
        const up = vi.fn();
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnKeyDownTrigger, down));
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnKeyUpTrigger, up));
        const detach = attachActionManagerKeyboard(manager, element);
        const event = new TestKeyboardEvent("keydown", "a", 65);
        element.dispatchEvent(event);
        expect(down).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source: element, sourceEvent: event }));
        expect(event.defaultPrevented).toBe(false);
        outside.dispatchEvent(new TestKeyboardEvent("keydown", "a", 65));
        expect(down).toHaveBeenCalledOnce();
        element.dispatchEvent(new TestKeyboardEvent("keyup", "a", 65));
        expect(up).toHaveBeenCalledOnce();
        detach();
        detach();
        element.dispatchEvent(new TestKeyboardEvent("keydown", "a", 65));
        element.dispatchEvent(new TestKeyboardEvent("keyup", "a", 65));
        expect(down).toHaveBeenCalledOnce();
        expect(up).toHaveBeenCalledOnce();
    });

    it("ignores consumed shortcuts, composition, modifiers, and descendant control input", () => {
        const element = createElement();
        const manager = new ActionManager();
        const fn = vi.fn();
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnKeyDownTrigger, fn));
        const detach = attachActionManagerKeyboard(manager, element);
        const consumed = new TestKeyboardEvent("keydown", "a", 65);
        consumed.preventDefault();
        element.dispatchEvent(consumed);
        for (const options of [{ isComposing: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
            element.dispatchEvent(new TestKeyboardEvent("keydown", "a", 65, options));
        }
        const descendantEvent = new TestKeyboardEvent("keydown", "a", 65);
        Object.defineProperty(descendantEvent, "target", { value: createElement() });
        element.dispatchEvent(descendantEvent);
        expect(fn).not.toHaveBeenCalled();
        detach();
    });

    it("never synthesizes a pick or click for Enter and Space on a native button", () => {
        const element = createElement();
        const manager = new ActionManager();
        const pick = vi.fn();
        manager.registerAction(new ExecuteCodeAction(ActionManager.OnPickTrigger, pick));
        element.addEventListener("click", () => manager.processTrigger(ActionManager.OnPickTrigger));
        const detach = attachActionManagerKeyboard(manager, element);
        for (const key of ["Enter", " "]) {
            element.dispatchEvent(new TestKeyboardEvent("keydown", key));
            element.dispatchEvent(new TestKeyboardEvent("keyup", key));
            expect(pick).toHaveBeenCalledTimes(key === "Enter" ? 0 : 1);
            element.dispatchEvent(new Event("click"));
        }
        expect(pick).toHaveBeenCalledTimes(2);
        detach();
    });
});

describe("Actions", () => {
    it("SetValueAction assigns a nested property", () => {
        const target = { material: { alpha: 1 } };
        const manager = new ActionManager();
        manager.registerAction(new SetValueAction(ActionManagerTriggers.OnPickTrigger, target, "material.alpha", 0.5));
        manager.processTrigger(ActionManagerTriggers.OnPickTrigger);
        expect(target.material.alpha).toBe(0.5);
    });

    it("IncrementValueAction adds to a numeric property", () => {
        const target = { count: 10 };
        const manager = new ActionManager();
        manager.registerAction(new IncrementValueAction(ActionManagerTriggers.OnPickTrigger, target, "count", 5));
        manager.processTrigger(ActionManagerTriggers.OnPickTrigger);
        expect(target.count).toBe(15);
    });

    it("accepts trigger options for property actions while preserving conditions", () => {
        const target = { count: 10 };
        const manager = new ActionManager();
        manager.registerAction(new SetValueAction({ trigger: ActionManager.OnKeyDownTrigger, parameter: "r" }, target, "count", 0));
        manager.registerAction(
            new IncrementValueAction({ trigger: ActionManager.OnKeyDownTrigger, parameter: "a" }, target, "count", 5, new PredicateCondition(() => target.count < 20))
        );
        manager.processTrigger(ActionManager.OnKeyDownTrigger, keyEvent("a", 65));
        manager.processTrigger(ActionManager.OnKeyDownTrigger, keyEvent("a", 65));
        manager.processTrigger(ActionManager.OnKeyDownTrigger, keyEvent("a", 65));
        expect(target.count).toBe(20);
        manager.processTrigger(ActionManager.OnKeyDownTrigger, keyEvent("r", 82));
        expect(target.count).toBe(0);
    });

    it("chains actions with then()", () => {
        const order: number[] = [];
        const manager = new ActionManager();
        const first = new ExecuteCodeAction(ActionManagerTriggers.OnPickTrigger, () => order.push(1));
        first.then(new ExecuteCodeAction(ActionManagerTriggers.OnPickTrigger, () => order.push(2)));
        manager.registerAction(first);
        manager.processTrigger(ActionManagerTriggers.OnPickTrigger);
        expect(order).toEqual([1, 2]);
    });
});

describe("Conditions", () => {
    it("ValueCondition gates execution", () => {
        const target = { count: 3 };
        const fn = vi.fn();
        const manager = new ActionManager();
        manager.registerAction(new ExecuteCodeAction(ActionManagerTriggers.OnPickTrigger, fn, new ValueCondition(target, "count", 3, ValueConditionOperators.IsEqual)));
        manager.processTrigger(ActionManagerTriggers.OnPickTrigger);
        expect(fn).toHaveBeenCalledTimes(1);

        target.count = 4;
        manager.processTrigger(ActionManagerTriggers.OnPickTrigger);
        expect(fn).toHaveBeenCalledTimes(1); // condition now false
    });

    it("PredicateCondition evaluates a function", () => {
        let allow = false;
        const fn = vi.fn();
        const manager = new ActionManager();
        manager.registerAction(new ExecuteCodeAction(ActionManagerTriggers.OnPickTrigger, fn, new PredicateCondition(() => allow)));
        manager.processTrigger(ActionManagerTriggers.OnPickTrigger);
        expect(fn).not.toHaveBeenCalled();
        allow = true;
        manager.processTrigger(ActionManagerTriggers.OnPickTrigger);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
