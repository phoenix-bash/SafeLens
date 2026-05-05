import { BadRequestException } from "@nestjs/common";
import { ZodSchema } from "zod";

export function parseSchema<T>(schema: ZodSchema<T>, value: unknown): T {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw new BadRequestException(result.error.flatten());
  }

  return result.data;
}

