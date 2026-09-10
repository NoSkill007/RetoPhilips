import { createTextRuntime } from '../src/text-runtime.js';
import { reviewExtraction } from '../src/observation-schema.js';
const runtime = createTextRuntime(process.env.SITESIGNAL_MODEL);
try {
  const status = await runtime.probe();
  console.log(status);
  if (status.state !== 'ready') throw new Error(status.message);
  for (const text of [
    'Visité Hospital Aurora del cliente Red Horizonte, área Norte. Vi dos tomógrafos; parecen tener ocho años.',
    'I visited Aurora Hospital. I saw one ultrasound machine made by DemoMed, model EchoDemo, serial SYN-123. Its age is unknown.',
  ]) {
    const result = await runtime.extract(text, { attempt: 1 });
    console.log(JSON.stringify({ text, ...result, reviewed: reviewExtraction(result.fields, text) }));
  }
} finally { runtime.close(); }
