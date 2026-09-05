/**
 * Structural shims for the pi hook contracts.
 *
 * These mirror the real types exported by `@earendil-works/pi-agent`
 * (packages/agent/src/types.ts). We keep local copies so this skeleton runs
 * standalone without building all of pi. In real integration, delete this file
 * and import the identical types from the package instead:
 *
 *   import type {
 *     BeforeToolCallContext, BeforeToolCallResult,
 *     AfterToolCallContext,  AfterToolCallResult,
 *   } from "@earendil-works/pi-agent";
 *
 * The shapes below are copied verbatim from pi so the swap is a no-op.
 */

/** A tool call block emitted by the assistant (pi-ai `ToolCall`). */
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, any>;
}

/** Minimal view of the assistant message that requested the call. */
export interface AssistantMessage {
  role: "assistant";
  /** Mixed content blocks; we only care about text (reasoning) + toolCall blocks. */
  content: Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    arguments?: Record<string, any>;
  }>;
}

export interface AgentContext {
  sessionId?: string;
  [k: string]: unknown;
}

export interface BeforeToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: ToolCall;
  args: unknown;
  context: AgentContext;
}

/** Returning `{ block: true }` prevents the tool from executing. */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
  terminate?: boolean;
}

export interface AgentToolResult<T = unknown> {
  content: Array<{ type: "text"; text: string }>;
  details?: T;
  isError?: boolean;
}

export interface AfterToolCallContext {
  assistantMessage: AssistantMessage;
  toolCall: ToolCall;
  args: unknown;
  result: AgentToolResult;
  isError: boolean;
  context: AgentContext;
}

export interface AfterToolCallResult {
  content?: Array<{ type: "text"; text: string }>;
  details?: unknown;
  isError?: boolean;
  terminate?: boolean;
}
