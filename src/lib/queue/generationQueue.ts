import { Queue } from "bullmq";
import type IORedis from "ioredis";
import { createQueueRedis } from "./redis";

export const GENERATION_QUEUE_NAME = "generation";

let generationQueue: Queue | null = null;
let queueConnection: IORedis | null = null;

export function getGenerationQueue() {
  if (generationQueue) return generationQueue;

  queueConnection = createQueueRedis();
  generationQueue = new Queue(GENERATION_QUEUE_NAME, {
    connection: queueConnection,
  });

  return generationQueue;
}

