import { jsonSchema } from "ai";
import { z } from "zod";

export function toToolJsonSchema<T>(schema: z.ZodTypeAny) {
  return jsonSchema<T>(schema.toJSONSchema());
}
