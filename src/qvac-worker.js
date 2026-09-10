try {
  const { loadModel, unloadModel } = await import('@qvac/sdk');
  const modelId = await loadModel({ modelSrc: process.argv[2], modelType: 'llamacpp-completion', modelConfig: { ctx_size: 2048 } });
  await unloadModel({ modelId });
  process.send?.({ state: 'ready', message: 'QVAC cargó y liberó el modelo local correctamente. La extracción se verificará en el siguiente ticket.' });
} catch {
  process.send?.({ state: 'unavailable', message: 'QVAC no pudo cargar el modelo. Ejecuta npm ci y npx qvac doctor durante la preparación; revisa el archivo GGUF y la memoria.' });
}
