import { describe, expect, it } from "vitest";
import { collectToolCallsFromDocument } from "./tool-call-scanner";

describe("content tool-call scanner", () => {
  it("collects complete tool calls from assistant response elements", () => {
    document.body.innerHTML = `
      <article style="width:300px;height:120px">
        <pre>
{"type":"function_call_start","name":"list_directory","call_id":7}
{"type":"parameter","key":"path","value":"F:\\\\web_agents"}
{"type":"function_call_end","call_id":7}
        </pre>
      </article>
    `;

    const calls = collectToolCallsFromDocument(document, undefined, new Set());

    expect(calls).toHaveLength(1);
    expect(calls[0]?.call.name).toBe("list_directory");
    expect(calls[0]?.fingerprint).toBe('7:list_directory:{"path":"F:\\\\web_agents"}');
  });

  it("skips calls whose fingerprint has already been executed", () => {
    document.body.innerHTML = `
      <article style="width:300px;height:120px">
{"type":"function_call_start","name":"list_directory","call_id":7}
{"type":"parameter","key":"path","value":"F:\\\\web_agents"}
{"type":"function_call_end","call_id":7}
      </article>
    `;

    const seen = new Set(['7:list_directory:{"path":"F:\\\\web_agents"}']);

    expect(collectToolCallsFromDocument(document, undefined, seen)).toEqual([]);
  });

  it("keeps identical tool calls from different response elements distinct", () => {
    const callText = `
{"type":"function_call_start","name":"list_directory","call_id":7}
{"type":"parameter","key":"path","value":"F:\\\\web_agents"}
{"type":"function_call_end","call_id":7}
    `;
    document.body.innerHTML = `
      <article style="width:300px;height:120px">${callText}</article>
      <article style="width:300px;height:120px">${callText}</article>
    `;

    const calls = collectToolCallsFromDocument(document, undefined, new Set());

    expect(calls).toHaveLength(2);
    expect(calls[0]?.element).not.toBe(calls[1]?.element);
  });
});
