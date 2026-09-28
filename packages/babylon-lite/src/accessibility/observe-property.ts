interface PropertyWatch {
    listeners: Set<() => void>;
    restore: () => void;
}

let watches: WeakMap<object, Map<PropertyKey, PropertyWatch>> | undefined;

/** @internal Reversible, shared observation. Property accessors never capture subscribers or scenes. */
export function observeProperty(target: object, key: PropertyKey, listener: () => void): () => void {
    const registry = (watches ??= new WeakMap());
    let properties = registry.get(target);
    if (!properties) {
        properties = new Map();
        registry.set(target, properties);
    }
    let watch = properties.get(key);
    if (!watch) {
        const own = Object.getOwnPropertyDescriptor(target, key);
        let descriptor = own;
        for (let prototype: object | null = Object.getPrototypeOf(target); !descriptor && prototype; prototype = Object.getPrototypeOf(prototype)) {
            descriptor = Object.getOwnPropertyDescriptor(prototype, key);
        }
        if (own?.configurable === false || (descriptor && ("value" in descriptor ? descriptor.writable === false : !descriptor.set))) {
            throw new Error(`Cannot observe read-only accessibility property ${String(key)}.`);
        }
        let value: unknown = Reflect.get(target, key);
        const read = (): unknown => (descriptor?.get ? descriptor.get.call(target) : value);
        const write = (next: unknown): void => {
            const previous = read();
            if (descriptor?.set) {
                descriptor.set.call(target, next);
            } else {
                value = next;
            }
            if (read() !== previous) {
                for (const callback of watches?.get(target)?.get(key)?.listeners ?? []) {
                    callback();
                }
            }
        };
        Object.defineProperty(target, key, { configurable: true, enumerable: own?.enumerable ?? true, get: read, set: write });
        watch = {
            listeners: new Set(),
            restore: () => {
                if (Object.getOwnPropertyDescriptor(target, key)?.get !== read) {
                    return;
                }
                if (own) {
                    Object.defineProperty(target, key, "value" in own ? { ...own, value: read() } : own);
                } else {
                    Reflect.deleteProperty(target, key);
                    if (!descriptor?.set && value !== undefined) {
                        Reflect.set(target, key, value);
                    }
                }
            },
        };
        properties.set(key, watch);
    }
    watch.listeners.add(listener);
    return () => {
        watch.listeners.delete(listener);
        if (watch.listeners.size === 0) {
            watch.restore();
            properties.delete(key);
            if (properties.size === 0) {
                registry.delete(target);
            }
        }
    };
}
