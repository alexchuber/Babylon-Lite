/**
 * Babylon.js-compatible Actions: `ActionManager`, `Action`, the common concrete
 * actions, and `Condition` variants.
 *
 * Dispatch triggers through `ActionManager.processTrigger`, or opt into
 * element-scoped keyboard input with `attachActionManagerKeyboard`.
 */

import type { Scene } from "../scene/scene.js";

/** Babylon.js `ActionManager` trigger constants (subset). */
export const ActionManagerTriggers = {
    NothingTrigger: 0,
    OnPickTrigger: 1,
    OnLeftPickTrigger: 2,
    OnRightPickTrigger: 3,
    OnCenterPickTrigger: 4,
    OnPickDownTrigger: 5,
    OnDoublePickTrigger: 6,
    OnPickUpTrigger: 7,
    OnPickOutTrigger: 16,
    OnPointerOverTrigger: 9,
    OnPointerOutTrigger: 10,
    OnEveryFrameTrigger: 11,
    OnKeyDownTrigger: 14,
    OnKeyUpTrigger: 15,
} as const;

/** Trigger identifier with an optional key name, legacy numeric key code, or event predicate. */
export interface ActionTriggerOptions {
    trigger: number;
    parameter?: string | number | ((event: ActionEvent) => boolean);
}

/** Event data passed to an action, including the original DOM input event. */
export interface ActionEvent {
    source: unknown;
    pointerX: number;
    pointerY: number;
    meshUnderPointer: unknown;
    additionalData?: unknown;
    sourceEvent?: Event;
}

/** Base class for actions. `execute` is implemented by subclasses. */
export abstract class Action {
    public trigger: number;
    /** Condition gating execution. When set, `execute` runs only if it evaluates true. */
    public condition: Condition | undefined;

    private _nextActiveAction: Action | null = null;

    public constructor(
        public triggerOptions: number | ActionTriggerOptions,
        condition?: Condition
    ) {
        this.trigger = typeof triggerOptions === "number" ? triggerOptions : triggerOptions.trigger;
        this.condition = condition;
    }

    /** The optional key filter supplied with the trigger. */
    public getTriggerParameter(): ActionTriggerOptions["parameter"] {
        return typeof this.triggerOptions === "number" ? undefined : this.triggerOptions.parameter;
    }

    public abstract execute(evt?: ActionEvent): void;

    /** Chain another action to run after this one (Babylon.js `then`). */
    public then(action: Action): Action {
        this._nextActiveAction = action;
        return action;
    }

    /** @internal Run this action (honouring its condition) and any chained action. */
    public _executeCurrent(evt?: ActionEvent): void {
        if (this.condition && !this.condition.isValid()) {
            return;
        }
        this.execute(evt);
        this._nextActiveAction?._executeCurrent(evt);
    }
}

/** Runs a user callback when triggered. */
export class ExecuteCodeAction extends Action {
    public constructor(
        trigger: number | ActionTriggerOptions,
        private readonly _func: (evt?: ActionEvent) => void,
        condition?: Condition
    ) {
        super(trigger, condition);
    }

    public execute(evt?: ActionEvent): void {
        this._func(evt);
    }
}

/** Sets `target[propertyPath] = value` when triggered. */
export class SetValueAction extends Action {
    public constructor(
        trigger: number | ActionTriggerOptions,
        private readonly _target: Record<string, unknown>,
        private readonly _propertyPath: string,
        private readonly _value: unknown,
        condition?: Condition
    ) {
        super(trigger, condition);
    }

    public execute(): void {
        setByPath(this._target, this._propertyPath, this._value);
    }
}

/** Adds `value` to `target[propertyPath]` when triggered. */
export class IncrementValueAction extends Action {
    public constructor(
        trigger: number | ActionTriggerOptions,
        private readonly _target: Record<string, unknown>,
        private readonly _propertyPath: string,
        private readonly _value: number,
        condition?: Condition
    ) {
        super(trigger, condition);
    }

    public execute(): void {
        const current = getByPath(this._target, this._propertyPath);
        if (typeof current === "number") {
            setByPath(this._target, this._propertyPath, current + this._value);
        }
    }
}

/** Base class for action conditions. */
export abstract class Condition {
    public abstract isValid(): boolean;
}

export const ValueConditionOperators = {
    IsEqual: 0,
    IsDifferent: 1,
    IsGreater: 2,
    IsLesser: 3,
} as const;

/** Compares `target[propertyPath]` against a value with an operator. */
export class ValueCondition extends Condition {
    public constructor(
        private readonly _target: Record<string, unknown>,
        private readonly _propertyPath: string,
        private readonly _value: number,
        private readonly _operator: number = ValueConditionOperators.IsEqual
    ) {
        super();
    }

    public isValid(): boolean {
        const current = getByPath(this._target, this._propertyPath);
        if (typeof current !== "number") {
            return false;
        }
        switch (this._operator) {
            case ValueConditionOperators.IsEqual:
                return current === this._value;
            case ValueConditionOperators.IsDifferent:
                return current !== this._value;
            case ValueConditionOperators.IsGreater:
                return current > this._value;
            case ValueConditionOperators.IsLesser:
                return current < this._value;
            default:
                return false;
        }
    }
}

/** Evaluates a user predicate. */
export class PredicateCondition extends Condition {
    public constructor(private readonly _predicate: () => boolean) {
        super();
    }

    public isValid(): boolean {
        return this._predicate();
    }
}

/**
 * Babylon.js `ActionManager`. Register actions with `registerAction`, then
 * dispatch them with `processTrigger(trigger, evt?)`.
 */
export class ActionManager {
    public static readonly Triggers = ActionManagerTriggers;
    public static readonly NothingTrigger = ActionManagerTriggers.NothingTrigger;
    public static readonly OnPickTrigger = ActionManagerTriggers.OnPickTrigger;
    public static readonly OnLeftPickTrigger = ActionManagerTriggers.OnLeftPickTrigger;
    public static readonly OnRightPickTrigger = ActionManagerTriggers.OnRightPickTrigger;
    public static readonly OnCenterPickTrigger = ActionManagerTriggers.OnCenterPickTrigger;
    public static readonly OnPickDownTrigger = ActionManagerTriggers.OnPickDownTrigger;
    public static readonly OnDoublePickTrigger = ActionManagerTriggers.OnDoublePickTrigger;
    public static readonly OnPickUpTrigger = ActionManagerTriggers.OnPickUpTrigger;
    public static readonly OnPickOutTrigger = ActionManagerTriggers.OnPickOutTrigger;
    public static readonly OnPointerOverTrigger = ActionManagerTriggers.OnPointerOverTrigger;
    public static readonly OnPointerOutTrigger = ActionManagerTriggers.OnPointerOutTrigger;
    public static readonly OnEveryFrameTrigger = ActionManagerTriggers.OnEveryFrameTrigger;
    public static readonly OnKeyDownTrigger = ActionManagerTriggers.OnKeyDownTrigger;
    public static readonly OnKeyUpTrigger = ActionManagerTriggers.OnKeyUpTrigger;

    public readonly actions: Action[] = [];
    private _changed?: Set<() => void>;
    private _disposed = false;
    private _recursive = false;
    /** @internal */
    public _keyboardCleanups?: Set<() => void>;

    public constructor(private readonly _scene?: Scene) {}

    public getScene(): Scene | undefined {
        return this._scene;
    }

    /** Allow descendant scene objects to use this manager's matching pick actions. */
    public get isRecursive(): boolean {
        return this._recursive;
    }
    public set isRecursive(value: boolean) {
        if (this._recursive !== value) {
            this._recursive = value;
            this._changed?.forEach((callback) => callback());
        }
    }

    /** @internal Subscribe only when an optional consumer needs actionability updates. */
    public _subscribe(callback: () => void): () => void {
        (this._changed ??= new Set()).add(callback);
        return () => this._changed?.delete(callback);
    }

    public registerAction(action: Action): Action {
        if (this._disposed) {
            throw new Error("ActionManager is disposed.");
        }
        this.actions.push(action);
        this._changed?.forEach((callback) => callback());
        return action;
    }

    public unregisterAction(action: Action): boolean {
        const index = this.actions.indexOf(action);
        if (index !== -1) {
            this.actions.splice(index, 1);
            this._changed?.forEach((callback) => callback());
            return true;
        }
        return false;
    }

    public hasSpecificTrigger(trigger: number): boolean {
        return this.actions.some((a) => a.trigger === trigger);
    }

    /** Dispatch every registered action matching `trigger`. */
    public processTrigger(trigger: number, evt?: ActionEvent): void {
        for (const action of this.actions) {
            if (action.trigger === trigger) {
                if ((trigger === ActionManager.OnKeyDownTrigger || trigger === ActionManager.OnKeyUpTrigger) && !matchesKey(action.getTriggerParameter(), evt)) {
                    continue;
                }
                action._executeCurrent(evt);
            }
        }
    }

    public isDisposed(): boolean {
        return this._disposed;
    }

    public dispose(): void {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._keyboardCleanups?.forEach((cleanup) => cleanup());
        this._keyboardCleanups?.clear();
        this.actions.length = 0;
        this._changed?.forEach((callback) => callback());
        this._changed?.clear();
    }
}

function matchesKey(parameter: ActionTriggerOptions["parameter"], actionEvent?: ActionEvent): boolean {
    if (parameter === undefined || !actionEvent) {
        return true;
    }
    if (typeof parameter === "function") {
        return parameter(actionEvent);
    }
    const event = actionEvent.sourceEvent;
    if (!event) {
        return false;
    }
    const keyCode = "keyCode" in event ? event.keyCode : undefined;
    if (typeof parameter === "number") {
        return parameter === keyCode;
    }
    const expectedKey = parameter.toLowerCase();
    if ("key" in event && typeof event.key === "string" && event.key.toLowerCase() === expectedKey) {
        return true;
    }
    const charCode = "charCode" in event && typeof event.charCode === "number" && event.charCode ? event.charCode : keyCode;
    return typeof charCode === "number" && String.fromCharCode(charCode).toLowerCase() === expectedKey;
}

/**
 * Dispatch keyboard actions while `element` itself has focus. Descendant controls,
 * composition input, consumed events, and browser shortcuts are left alone. This
 * never captures global keys, prevents defaults, or synthesizes button clicks.
 * @param manager - Action manager to dispatch keyboard triggers to.
 * @param element - Focusable scene canvas or another explicit keyboard target.
 * @returns Disposer that removes both listeners.
 */
export function attachActionManagerKeyboard(manager: ActionManager, element: HTMLElement, source: unknown = element): () => void {
    if (manager.isDisposed()) {
        throw new Error("Cannot attach keyboard actions to a disposed manager.");
    }
    const onKey = (event: KeyboardEvent): void => {
        if (event.target !== element || event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) {
            return;
        }
        manager.processTrigger(event.type === "keydown" ? ActionManager.OnKeyDownTrigger : ActionManager.OnKeyUpTrigger, {
            source,
            pointerX: 0,
            pointerY: 0,
            meshUnderPointer: null,
            sourceEvent: event,
        });
    };
    element.addEventListener("keydown", onKey);
    element.addEventListener("keyup", onKey);
    const cleanup = (): void => {
        element.removeEventListener("keydown", onKey);
        element.removeEventListener("keyup", onKey);
        manager._keyboardCleanups?.delete(cleanup);
    };
    (manager._keyboardCleanups ??= new Set()).add(cleanup);
    return cleanup;
}

function getByPath(target: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = target;
    for (const part of parts) {
        if (current == null || typeof current !== "object") {
            return undefined;
        }
        current = (current as Record<string, unknown>)[part];
    }
    return current;
}

function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split(".");
    let current: Record<string, unknown> = target;
    for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]!] as Record<string, unknown>;
        if (current == null) {
            return;
        }
    }
    current[parts[parts.length - 1]!] = value;
}
