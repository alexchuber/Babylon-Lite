/** Browser controls used instead of a canvas GUI renderer. Labels are visible and accessible. */
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

/** A real labelled control; append `element` to an HTML overlay or register it in a semantic tree. */
export interface NativeControl {
    readonly element: HTMLElement;
    readonly input: HTMLElement;
    readonly kind: NativeControlOptions["kind"];
    /** @internal */
    _dispose?: () => void;
}

/** Create a native HTML control. Browser keyboard/editing behavior is not emulated. */
export function createNativeControl(options: NativeControlOptions): NativeControl {
    if (!options.label.trim()) {
        throw new Error("A native control requires a nonempty label.");
    }
    if ((options.kind === "image" || options.kind === "content" || options.kind === "group") && options.disabled !== undefined) {
        throw new TypeError("Disabled state requires an interactive native control. Use a semantic group's disabled state for inherited behavior.");
    }
    if (
        options.kind === "range" &&
        (!Number.isFinite(options.min) ||
            !Number.isFinite(options.max) ||
            options.max < options.min ||
            !Number.isFinite(options.value) ||
            options.value < options.min ||
            options.value > options.max ||
            (options.step !== undefined && (!(options.step > 0) || !Number.isFinite(options.step))))
    ) {
        throw new RangeError("Range control requires finite ordered bounds, an in-range value, and a positive step.");
    }
    if (
        options.kind === "select" &&
        (new Set(options.choices.map((choice) => choice.value)).size !== options.choices.length ||
            (options.value !== undefined && !options.choices.some((choice) => choice.value === options.value)))
    ) {
        throw new Error("Select values must be unique and the initial value must exist.");
    }
    const doc = options.document ?? document;
    if (options.kind === "content" || options.kind === "group") {
        const element = doc.createElement("div");
        if (options.kind === "group") {
            element.setAttribute("role", "group");
            element.setAttribute("aria-label", options.label);
        } else {
            element.textContent = options.label;
        }
        return { element, input: element, kind: options.kind };
    }
    if (options.kind === "image") {
        const element = doc.createElement("img");
        element.src = options.src;
        element.alt = options.label;
        return { element, input: element, kind: options.kind };
    }
    if (options.kind === "button") {
        const element = doc.createElement("button");
        element.type = "button";
        element.textContent = options.label;
        element.disabled = options.disabled ?? false;
        const click = options.onClick;
        if (click) {
            element.addEventListener("click", click);
        }
        return { element, input: element, kind: options.kind, _dispose: click ? () => element.removeEventListener("click", click) : undefined };
    }
    const label = doc.createElement("label");
    label.append(doc.createTextNode(options.label));
    if (options.kind === "select") {
        const input = doc.createElement("select");
        for (const choice of options.choices) {
            const option = doc.createElement("option");
            option.value = choice.value;
            option.textContent = choice.label;
            input.append(option);
        }
        if (options.value !== undefined) {
            input.value = options.value;
        }
        input.disabled = options.disabled ?? false;
        const changed = (event: Event): void => options.onChange?.(input.value, event);
        input.addEventListener("change", changed);
        label.append(input);
        return { element: label, input, kind: options.kind, _dispose: () => input.removeEventListener("change", changed) };
    }
    const input = doc.createElement("input");
    input.type = options.kind;
    input.disabled = options.disabled ?? false;
    let changed: (event: Event) => void;
    if (options.kind === "checkbox" || options.kind === "radio") {
        input.checked = options.checked ?? false;
        input.name = options.name ?? "";
        changed = (event) => options.onChange?.(input.checked, event);
    } else if (options.kind === "range") {
        input.min = String(options.min);
        input.max = String(options.max);
        input.step = String(options.step ?? 1);
        input.value = String(options.value);
        changed = (event) => options.onChange?.(input.valueAsNumber, event);
    } else {
        input.value = options.value ?? "";
        changed = (event) => options.onChange?.(input.value, event);
    }
    const eventType = options.kind === "checkbox" || options.kind === "radio" ? "change" : "input";
    input.addEventListener(eventType, changed);
    label.append(input);
    return { element: label, input, kind: options.kind, _dispose: () => input.removeEventListener(eventType, changed) };
}

/** Remove library event handlers and the control. Caller-owned listeners remain untouched. */
export function disposeNativeControl(control: NativeControl): void {
    control._dispose?.();
    control._dispose = undefined;
    control.element.remove();
}
