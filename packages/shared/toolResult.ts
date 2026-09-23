import * as z from 'zod'

// A local, read-only schema for structured tool output and historical messages.
export const ToolResultSchema = z
  .object({
    content: z.array(
      z
        .object({
          type: z.string(),
          text: z.string().optional(),
          data: z.string().optional(),
          mimeType: z.string().optional()
        })
        .loose()
    ),
    isError: z.boolean().optional()
  })
  .loose()
