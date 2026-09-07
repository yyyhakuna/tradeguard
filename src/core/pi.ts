/**
 * pi hook contracts — now the REAL types, re-exported from the installed packages.
 *
 * This file used to hand-copy pi's types so the skeleton could run without pi.
 * pi is now a real dependency (`@earendil-works/pi-agent-core`, which pulls its
 * core message/content types from `@earendil-works/pi-ai`), so we simply re-export
 * the genuine definitions. Every engine/policy/trace import stays pointed here, so
 * the whole codebase now type-checks against pi v0.85.1's actual contract.
 *
 * Names kept identical to before so nothing else had to change:
 *   ToolCall              ← pi-ai `ToolCall`            (== agent-core `AgentToolCall`)
 *   AssistantMessage      ← pi-ai
 *   BeforeToolCallContext / BeforeToolCallResult
 *   AfterToolCallContext  / AfterToolCallResult
 *   AgentContext, AgentToolResult   ← agent-core
 */

export type {
  AssistantMessage,
  ToolCall,
  TextContent,
  ImageContent,
} from "@earendil-works/pi-ai";

export type {
  AgentContext,
  AgentToolResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
} from "@earendil-works/pi-agent-core";
