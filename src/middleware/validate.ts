import type { NextFunction, Request, Response } from "express";
import { z, type ZodType } from "zod";
import { badRequest } from "../lib/http.js";

type Schemas = { body?: ZodType; query?: ZodType; params?: ZodType };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      valid: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}

/**
 * Validates and coerces request parts. Parsed values land on req.valid
 * (Express 5 makes req.query read-only, so we never overwrite the originals).
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.valid = {};
    for (const part of ["params", "query", "body"] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? {});
      if (!result.success) {
        throw badRequest("Validation failed", z.flattenError(result.error).fieldErrors);
      }
      req.valid[part] = result.data;
    }
    next();
  };
}

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Invalid id");
export const idParams = z.object({ id: objectId });
