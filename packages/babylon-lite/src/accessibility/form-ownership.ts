/** Reject hosting moves that would silently remove a control from its application form. */
export function validateFormOwnership(element: HTMLElement, parent: HTMLElement): void {
    const controls = [element, ...element.querySelectorAll<HTMLElement>("button,fieldset,input,object,output,select,textarea")];
    for (const control of controls) {
        const form = "form" in control ? control.form : null;
        if (
            form instanceof element.ownerDocument.defaultView!.HTMLFormElement &&
            !element.contains(form) &&
            parent.closest("form") !== form &&
            !(control.getAttribute("form") === form.id && control.ownerDocument.getElementById(form.id) === form)
        ) {
            throw new Error("Hosting this control would remove its implicit form association. Move the whole form, host inside it, or provide a valid explicit form attribute.");
        }
    }
}
