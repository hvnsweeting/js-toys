export async function closeResources(resources) {
  let firstError;
  for (const resource of resources) {
    if (!resource) continue;
    try {
      await resource.close();
    } catch (error) {
      firstError ??= error;
    }
  }
  if (firstError) throw firstError;
}
