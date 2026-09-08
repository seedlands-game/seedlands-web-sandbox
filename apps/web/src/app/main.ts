const atlasReady = fetch(`${import.meta.env.BASE_URL}assets/voxel-atlas.webp`, {
  cache: 'force-cache',
  priority: 'high',
}).then((response) => {
  if (!response.ok) throw new Error(`World texture preload failed (${response.status}).`);
  return response.blob();
});

void import('./bootstrap')
  .then(({ initializeSeedlands }) =>
    initializeSeedlands({
      ...window.__SEEDLANDS_INITIAL_OPTIONS__,
      resourceReady: atlasReady,
    }),
  )
  .catch((error: unknown) => console.error('Seedlands runtime failed to initialize.', error));
