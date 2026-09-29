/**
 * Classify Lite source modules that must follow the established core build graph.
 *
 * Both package entry enumeration and error-code allocation use this predicate.
 * Callers may pass source-relative paths with either slash style and with or
 * without a JavaScript or TypeScript extension.
 */
export function isLiteOptionalBuildModule(modulePath: string): boolean {
    const normalized = modulePath.replace(/\\/g, "/").replace(/\.[cm]?[jt]sx?$/, "");
    return (
        normalized.startsWith("accessibility/") ||
        normalized === "animation/scene-animation" ||
        normalized === "animation/scene-animation-manager" ||
        normalized === "scene/scene-dispose-registration" ||
        normalized === "scene/scene-html-twin"
    );
}
