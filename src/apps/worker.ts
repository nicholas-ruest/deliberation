import { setTimeout } from 'node:timers/promises';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
process.once('SIGINT', () => controller.abort());

while (!controller.signal.aborted) {
  await setTimeout(1_000, undefined, { signal: controller.signal }).catch(() => undefined);
}
