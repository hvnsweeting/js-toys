const runPattern = /^run-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

export function generatedRunName(name) {
  const match = name.match(runPattern);
  if (!match) return false;
  const timestamp = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) && date.toISOString() === timestamp;
}

export function expiredRuns(entries, keep = 5) {
  return entries.filter(entry => entry.isDirectory() && generatedRunName(entry.name))
    .map(entry => entry.name).sort().reverse().slice(keep);
}

export function viewportSummary(passed, total, assertions) {
  return `${passed}/${total} viewports passed, ${assertions} assertions`;
}

export async function checkAndPrune(check, prune) {
  let error;
  try {
    await check();
  } catch (caught) {
    error = caught;
  }
  try {
    await prune();
  } catch (caught) {
    error ??= caught;
  }
  if (error) throw error;
}
