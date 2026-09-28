export {};

declare global {
    interface Window {
        accessibilityFixture: {
            update(): void;
            hide(): void;
            remove(): void;
            reparent(): void;
            disableGroup(): void;
            clearAria(): void;
            staticItem(): void;
            dispose(): void;
            remount(): void;
            nativeControl(disabled: boolean): void;
            dynamicControl(): void;
            clear(): void;
            invalid(): { failures: number; unchanged: boolean };
        };
        accessibilityIntegration: {
            disable(): void;
            move(): void;
            dispose(): void;
            tick(): number;
        };
        accessibilityActions: {
            removePick(): void;
            addPick(): void;
            setOrder(): void;
            replaceSceneManager(): void;
            disposeManager(): void;
            invalidTag(): { failed: boolean; unchanged: boolean };
            parentSecond(): void;
            disposeParent(): void;
            recursive(enabled: boolean): void;
        };
    }
}
