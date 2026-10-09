export function focusFeedback(element: HTMLElement | null): void {
  if (!element) return;
  element.focus();
  const bounds = element.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
    element.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }
}
