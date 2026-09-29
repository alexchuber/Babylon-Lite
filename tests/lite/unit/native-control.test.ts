import { expect, it, vi } from "vitest";
import { createNativeControl } from "../../../packages/babylon-lite/src/accessibility/native-control";
import type { NativeControlOptions } from "../../../packages/babylon-lite/src/accessibility/native-control";

it("rejects unsupported kinds before creating DOM", () => {
    const createElement = vi.fn();
    const options = {
        kind: "slider",
        label: "Volume",
        document: { createElement },
    } as unknown as NativeControlOptions;

    expect(() => createNativeControl(options)).toThrowError(TypeError);
    expect(createElement).not.toHaveBeenCalled();
});
