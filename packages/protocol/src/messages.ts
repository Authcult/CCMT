import { z } from "zod";

export const ActorSchema = z.enum(["web", "relay", "agent"]);

const terminalInputSchema = z.object({
  type: z.literal("terminal.input"),
  payload: z.object({ data: z.string().min(1) }),
});

const terminalOutputSchema = z.object({
  type: z.literal("terminal.output"),
  payload: z.object({ data: z.string(), stream: z.enum(["stdout", "stderr"]).default("stdout") }),
});

const terminalResizeSchema = z.object({
  type: z.literal("terminal.resize"),
  payload: z.object({ cols: z.number().int().positive(), rows: z.number().int().positive() }),
});

const terminalSignalSchema = z.object({
  type: z.literal("terminal.signal"),
  payload: z.object({ signal: z.enum(["SIGINT", "SIGTERM"]) }),
});

const sessionStateSchema = z.object({
  type: z.literal("session.state"),
  payload: z.object({ state: z.enum(["connecting", "ready", "disconnected"]), detail: z.string().optional() }),
});

const terminalExitSchema = z.object({
  type: z.literal("terminal.exit"),
  payload: z.object({ code: z.number().int().nullable(), reason: z.string().optional() }),
});

const sessionErrorSchema = z.object({
  type: z.literal("session.error"),
  payload: z.object({ code: z.string(), message: z.string() }),
});

export const FrameBodySchema = z.discriminatedUnion("type", [
  terminalInputSchema,
  terminalOutputSchema,
  terminalResizeSchema,
  terminalSignalSchema,
  sessionStateSchema,
  terminalExitSchema,
  sessionErrorSchema,
]);

export const FrameSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  ts: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  from: ActorSchema,
  target: ActorSchema.optional(),
  type: z.string().min(1),
  payload: z.unknown(),
});

export type Actor = z.infer<typeof ActorSchema>;
export type FrameBody = z.infer<typeof FrameBodySchema>;

export type Frame = {
  v: 1;
  id: string;
  ts: number;
  sessionId: string;
  from: Actor;
  target?: Actor;
} & FrameBody;

export function parseFrame(input: unknown): Frame {
  const frame = FrameSchema.parse(input);
  const body = FrameBodySchema.parse({ type: frame.type, payload: frame.payload });

  return {
    v: 1,
    id: frame.id,
    ts: frame.ts,
    sessionId: frame.sessionId,
    from: frame.from,
    target: frame.target,
    ...body,
  };
}

export function makeFrame(args: {
  sessionId: string;
  from: Actor;
  target?: Actor;
  body: FrameBody;
  id?: string;
}): Frame {
  return {
    v: 1,
    id: args.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    sessionId: args.sessionId,
    from: args.from,
    target: args.target,
    ...args.body,
  };
}
