export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const editable = target.closest("input, textarea, select, [contenteditable='true'], [contenteditable='']");
  return Boolean(editable || target.isContentEditable);
}

export function getNextQueueIndex(
  currentIndex: number,
  itemCount: number,
  direction: "next" | "previous",
): number {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0) return direction === "next" ? 0 : itemCount - 1;

  const delta = direction === "next" ? 1 : -1;
  return Math.max(0, Math.min(itemCount - 1, currentIndex + delta));
}
