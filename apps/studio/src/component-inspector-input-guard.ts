const previousNumbers = new WeakMap<HTMLInputElement, number>();

function numericComponentInput(target: EventTarget | null): HTMLInputElement | null {
  if (!(target instanceof HTMLInputElement)) return null;
  if (target.type !== 'number' && target.type !== 'range') return null;
  return target.closest('.kx-component-inspector') ? target : null;
}

function remember(event: Event): void {
  const input = numericComponentInput(event.target);
  if (!input) return;
  const value = Number(input.value);
  if (Number.isFinite(value)) previousNumbers.set(input, value);
}

function suppressNoopInput(event: Event): void {
  const input = numericComponentInput(event.target);
  if (!input) return;
  const value = Number(input.value);
  if (!Number.isFinite(value)) return;
  const previous = previousNumbers.get(input);
  if (previous != null && Math.abs(previous - value) <= Number.EPSILON) {
    // PlayCanvas-style numeric editing does not emit an editor command when the
    // effective value did not change. Prevent the component inspector's target
    // listener from producing a no-op ScenePatch / document refresh, which can
    // otherwise replace the focused control during rapid consecutive edits.
    event.stopImmediatePropagation();
    return;
  }
  previousNumbers.set(input, value);
}

document.addEventListener('focusin', remember, true);
document.addEventListener('input', suppressNoopInput, true);
document.addEventListener('change', remember, true);
