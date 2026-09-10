import {
  LLAMA_3_2_1B_INST_Q4_0,
  completion,
  loadModel,
  unloadModel,
} from "@qvac/sdk";

const modelId = await loadModel({
  modelSrc: LLAMA_3_2_1B_INST_Q4_0,
  onProgress(progress) {
    const downloadedMb = (progress.downloaded / 1e6).toFixed(1);
    const totalMb = (progress.total / 1e6).toFixed(1);
    process.stderr.write(
      `\rDescargando modelo: ${progress.percentage.toFixed(0)}% (${downloadedMb}/${totalMb} MB)`,
    );
  },
});

process.stderr.write("\nModelo cargado. Ejecutando inferencia local...\n\n");

const result = completion({
  modelId,
  history: [
    {
      role: "system",
      content:
        "Eres un extractor de datos para un prototipo de hackathon. Todos los hospitales y datos son ficticios. Devuelve solamente JSON valido, sin explicaciones.",
    },
    {
      role: "user",
      content:
        'Extrae esta observacion usando las claves hospital, ciudad, equipos. Cada equipo debe tener tipo, cantidad y antiguedad_aproximada_anos: "Estoy en Hospital Aurora, en Ciudad de Panama. Vi dos tomografos; uno parece tener ocho anos."',
    },
  ],
  stream: true,
});

for await (const token of result.tokenStream) {
  process.stdout.write(token);
}

process.stdout.write("\n");
await unloadModel({ modelId });
