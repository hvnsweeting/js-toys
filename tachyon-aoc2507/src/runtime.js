export function wallSeconds(now, previous) {
  return Math.max(0, (now - previous) / 1000);
}

export function shortcutAllowed(event) {
  return !event.ctrlKey && !event.metaKey && !event.altKey &&
      !event.shiftKey && !event.repeat;
}

export function accessStorage(getStorage, notify) {
  try {
    return getStorage();
  } catch {
    notify('Progress cannot be read in this browser.');
    return null;
  }
}
