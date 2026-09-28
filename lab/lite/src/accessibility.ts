import {
    addAnimationTask,
    addToScene,
    attachControl,
    bindAnimationManagerToScene,
    createAnimationManager,
    createAnimationTask,
    createArcRotateCamera,
    createAudioEngineAsync,
    createEngine,
    createHemisphericLight,
    createHtmlOverlay,
    createNativeControl,
    createSceneContext,
    createSceneHtmlTwin,
    createSoundAsync,
    createSphere,
    createStandardMaterial,
    createUnmuteUI,
    disposeAudioEngine,
    disposeEngine,
    disposeHtmlOverlay,
    disposeNativeControl,
    disposeScene,
    disposeUnmuteUI,
    pauseSound,
    playSound,
    registerScene,
    resumeSound,
    setAccessibilityTag,
    setMasterVolume,
    startEngine,
    unlockAudioEngineAsync,
    getSceneAnimationsEnabled,
    setSceneAnimationsEnabled,
} from "babylon-lite";

const errorMessage = document.querySelector<HTMLElement>("#error")!;
function report(error: unknown): void {
    errorMessage.textContent = String(error);
    console.error(error);
}

async function main(): Promise<void> {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas")!;
    const engine = await createEngine(canvas);
    const scene = createSceneContext(engine);
    const camera = createArcRotateCamera(-Math.PI / 2, Math.PI / 2.4, 5, { x: 0, y: 0, z: 0 });
    scene.camera = camera;
    const detachCamera = attachControl(camera, canvas, scene);
    addToScene(scene, createHemisphericLight([0, 1, 0], 1));

    // Early binding also observes subsequently added empty transform roots.
    createSceneHtmlTwin(scene, { parent: document.querySelector<HTMLElement>("#objects")!, label: "Scene objects" });
    const sphere = createSphere(engine);
    const material = createStandardMaterial();
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--cp-accent").trim();
    const channel = (offset: number): number => parseInt(accent.slice(offset, offset + 2), 16) / 255;
    material.diffuseColor = [channel(1), channel(3), channel(5)];
    sphere.material = material;
    addToScene(scene, sphere);
    let selected = false;
    const describe = (): void => {
        setAccessibilityTag(sphere, {
            name: "Select sphere",
            description: "A moving sphere in the center of the scene",
            aria: { "aria-pressed": selected },
            eventHandler: {
                click: () => {
                    selected = !selected;
                    document.querySelector("output")!.textContent = selected ? "Sphere selected" : "No object selected";
                    describe();
                },
            },
        });
    };
    describe();
    const animation = createAnimationManager();
    let elapsed = 0;
    addAnimationTask(
        animation,
        createAnimationTask((_manager, delta) => {
            elapsed += delta;
            sphere.position.x = Math.sin(elapsed / 1000) * 0.7;
        })
    );
    bindAnimationManagerToScene(scene, animation);
    // Reduced motion is this application's policy, not an engine-wide preference.
    setSceneAnimationsEnabled(scene, !matchMedia("(prefers-reduced-motion: reduce)").matches);

    const audio = await createAudioEngineAsync({ resumeOnInteraction: false, resumeOnPause: false });
    const buffer = audio.audioContext.createBuffer(1, 44100, 44100);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) {
        samples[index] = Math.sin((2 * Math.PI * 220 * index) / buffer.sampleRate) * 0.1;
    }
    const tone = await createSoundAsync(audio, buffer, { loop: true });
    setMasterVolume(audio, 0.3);
    const audioStatus = document.querySelector<HTMLOutputElement>("#audio-status")!;
    const form = document.querySelector<HTMLElement>("#form")!;
    const controls = [
        createNativeControl({
            kind: "checkbox",
            label: "Animate scene",
            checked: getSceneAnimationsEnabled(scene),
            onChange: (enabled) => setSceneAnimationsEnabled(scene, enabled),
        }),
        createNativeControl({
            kind: "button",
            label: "Play audio",
            onClick: () => {
                void unlockAudioEngineAsync(audio)
                    .then(() => {
                        playSound(tone);
                        audioStatus.textContent = "Playing audio";
                    })
                    .catch(report);
            },
        }),
        createNativeControl({
            kind: "button",
            label: "Pause audio",
            onClick: () => {
                pauseSound(tone);
                audioStatus.textContent = "Audio paused";
            },
        }),
        createNativeControl({
            kind: "button",
            label: "Resume audio",
            onClick: () => {
                resumeSound(tone);
                audioStatus.textContent = "Playing audio";
            },
        }),
        createNativeControl({ kind: "range", label: "Volume", min: 0, max: 1, step: 0.05, value: 0.3, onChange: (volume) => setMasterVolume(audio, volume) }),
    ];
    controls.forEach((control) => form.append(control.element));
    const panel = createHtmlOverlay({ canvas, element: form, parent: document.querySelector<HTMLElement>("#controls")!, label: "Playback controls", mode: "panel" });
    const unmute = createUnmuteUI(audio, { parentElement: form, label: "Enable example audio", onError: report });
    window.addEventListener(
        "pagehide",
        () => {
            detachCamera();
            disposeUnmuteUI(unmute);
            disposeHtmlOverlay(panel);
            controls.forEach(disposeNativeControl);
            disposeAudioEngine(audio);
            disposeScene(scene);
            disposeEngine(engine);
        },
        { once: true }
    );
    await registerScene(scene);
    await startEngine(engine);
    canvas.dataset.ready = "true";
}

void main().catch(report);
