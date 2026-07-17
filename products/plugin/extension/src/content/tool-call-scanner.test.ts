import { describe, expect, it } from "vitest";
import { collectToolCallsFromDocument } from "./tool-call-scanner";
import { getProviderById } from "../providers/catalog";

const chatgpt = getProviderById("chatgpt");

describe("content tool-call scanner", () => {
  it("collects complete tool calls from assistant response elements", () => {
    document.body.innerHTML = `
      <article data-testid="conversation-turn-1" style="width:300px;height:120px">
        <div data-message-author-role="assistant" style="width:280px;height:100px"><pre>
{"type":"function_call_start","name":"list_directory","call_id":7}
{"type":"parameter","key":"path","value":"F:\\\\web_agents"}
{"type":"function_call_end","call_id":7}
        </pre></div>
      </article>
    `;

    const calls = collectToolCallsFromDocument(document, chatgpt, new Set());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.call.name).toBe("list_directory");
    expect(calls[0]?.fingerprint).toBe('7:list_directory:{"path":"F:\\\\web_agents"}');
  });

  it("skips calls whose fingerprint has already been executed", () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant" style="width:300px;height:120px">
{"type":"function_call_start","name":"list_directory","call_id":7}
{"type":"parameter","key":"path","value":"F:\\\\web_agents"}
{"type":"function_call_end","call_id":7}
      </div>
    `;

    const seen = new Set(['7:list_directory:{"path":"F:\\\\web_agents"}']);

    expect(collectToolCallsFromDocument(document, chatgpt, seen)).toEqual([]);
  });

  it("keeps identical tool calls from different response elements distinct", () => {
    const callText = `
{"type":"function_call_start","name":"list_directory","call_id":7}
{"type":"parameter","key":"path","value":"F:\\\\web_agents"}
{"type":"function_call_end","call_id":7}
    `;
    document.body.innerHTML = `
      <div data-message-author-role="assistant" style="width:300px;height:120px">${callText}</div>
      <div data-message-author-role="assistant" style="width:300px;height:120px">${callText}</div>
    `;

    const calls = collectToolCallsFromDocument(document, chatgpt, new Set());

    expect(calls).toHaveLength(2);
    expect(calls[0]?.element).not.toBe(calls[1]?.element);
  });

  it("never executes a tool-call example contained in a user message", () => {
    document.body.innerHTML = `
      <article data-testid="conversation-turn-user" style="width:300px;height:140px">
        <div data-message-author-role="user" style="width:280px;height:120px">
{"type":"function_call_start","name":"read_text_file","call_id":1}
{"type":"parameter","key":"path","value":"F:\\\\web_agents\\\\README.md"}
{"type":"function_call_end","call_id":1}
        </div>
      </article>
    `;

    expect(collectToolCallsFromDocument(document, chatgpt, new Set())).toEqual([]);
  });

  it("deduplicates nested selectors for one assistant message", () => {
    document.body.innerHTML = `
      <article data-testid="conversation-turn-2" style="width:300px;height:140px">
        <div data-message-author-role="assistant" style="width:280px;height:120px">
{"type":"function_call_start","name":"list_directory","call_id":8}
{"type":"parameter","key":"path","value":"F:\\\\web_agents"}
{"type":"function_call_end","call_id":8}
        </div>
      </article>
    `;

    const calls = collectToolCallsFromDocument(document, chatgpt, new Set());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.call.callId).toBe("8");
  });

  it("fails closed when a provider has no declared assistant selectors", () => {
    document.body.innerHTML = `
      <article style="width:300px;height:120px">
{"type":"function_call_start","name":"list_directory","call_id":9}
{"type":"function_call_end","call_id":9}
      </article>
    `;

    expect(collectToolCallsFromDocument(document, undefined, new Set())).toEqual([]);
  });
});
