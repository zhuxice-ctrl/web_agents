# Roundtable Session Manual Test

## Setup

1. Build the extension:
   `cd F:\web_agents-new-plugin-rewrite\extensions\web-agents-extension`
   `npm run build`
2. Load `F:\web_agents-new-plugin-rewrite\extensions\web-agents-extension\dist` in Chrome or Edge.
3. Open ChatGPT in the main tab and sign in.
4. Open the Web Agents popup and click `Detect page`.

## GPT + DeepSeek MVP

1. In ChatGPT, ask:
   `如何确定一个项目真实的开发路线，从设计到落地`
2. Wait for ChatGPT to answer.
3. In Web Agents, create a roundtable session.
4. Click `Import` and confirm the shared ledger contains the user question and GPT answer.
5. Click `Join DeepSeek`; Web Agents should open or bind the DeepSeek tab.
6. Click `Start` or `Step`.
7. Confirm DeepSeek receives a prompt containing the shared ledger.
8. After DeepSeek replies, click `Capture` on DeepSeek.
9. Confirm the shared ledger now includes the DeepSeek reply and the next provider is ChatGPT.
10. Click `Step` to send the updated context back to ChatGPT.
11. Click `Summarize` when ready to ask ChatGPT for the final plan.

## Gemini And Doubao Join

1. During an existing roundtable, click `Join Gemini`.
2. Add guidance:
   `让 Gemini 加入，重点审查落地风险和验收标准。`
3. Step to Gemini and confirm the prompt contains recent shared context and a late-join note.
4. Repeat with `Join Doubao` when the Doubao page is signed in and ready.

## Failure Recovery

1. Create a roundtable but do not bind DeepSeek.
2. Click `Start`.
3. Confirm the session pauses instead of sending text to the wrong active tab.
4. Navigate a provider page away from its chat UI.
5. Click `Step` or `Capture`.
6. Confirm Web Agents shows an error state and does not repeatedly insert/delete/send text.
