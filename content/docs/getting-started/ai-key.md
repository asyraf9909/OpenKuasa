---
title: Add your AI key
description: Chat with the assistants on your own AI key, past the 3 free questions a week.
order: 8
ask: How do I add my AI key?
screen: /account/ai
---
The OpenKuasa assistants run on an AI server (LiteLLM) in front of the models. If the server is hosted for you, you can add one key for your workspace, and everyone in it can chat on it.

## Why you need a key

Without a key, each person gets 3 free questions a week, across all the assistants. They reset every Monday at 00:00 UTC. When they are used up, chat stops until the next week, or until you add a key.

With a key, chat is billed to whoever issued it. Set a spending limit on the key where it was made if you want one. As a safety net, each person can run up to 200 chat requests a day on the key. Approving a change the assistant suggests counts as a request too. The count resets at midnight UTC (8 am Malaysia time).

## Who can do this

Only workspace owners and admins can add, change or remove the key. Members and viewers see the note **Only owners and admins can add or change the workspace key.** The demo workspace does not use a key.

On a self-hosted copy the server's own key is set once by whoever runs it, and no workspace key is needed. See [AI models and keys](/docs/developers/ai-models-and-keys).

## Before you start

Where a key comes from depends on who runs the AI server:

- **Hosted OpenKuasa:** ask for a key for the server, or create one in the AI server's own admin page. It starts with `sk-`.
- **Your own copy:** the key is the LiteLLM proxy's master key, or a virtual key made for you. Either is set as `LITELLM_API_KEY` on the server.

## Steps

1. Open the account menu (your name, top right) and click **Profile & Preferences**. In the side menu, under **Apps**, choose **AI key**. Or go straight to [AI key](/account/ai).
2. Paste the key into **AI API key**.
3. Click **Save key**.

OpenKuasa checks the key with the AI server first. The key is stored sealed (encrypted) and is never shown again. Only its last four characters are shown, so you can tell which key is in use. The status changes to **Active**.

![The Workspace key card as the demo workspace shows it: read-only, with no key](/docs-media/getting-started/ai-key.png)

_Shown from the sample workspace, where editing is switched off._

### Change or remove the key

To change it, paste a new key into **Replace with a new key** and click **Replace key**. To stop using your own key, click **Remove key**. Chat then goes back to 3 free questions a week for each person.

## Common problems

- **That does not look like an AI key. It should start with sk-.** Copy the whole key again.
- **The AI server rejected that key. Check it and try again.** The key is wrong or was deleted. Make a new one.
- **Could not reach the AI server to check the key. Please try again.** Nothing was saved. Try again in a moment.
- **This server is not set up to store workspace keys yet. The host needs AI_KEYS_ENCRYPTION_SECRET set.** Whoever runs this copy of OpenKuasa has to set that up first.
- **That question was not sent: you have reached today’s chat limit. It resets at midnight UTC (8 am Malaysia time).** You used today's 200 requests. Try again after 8 am Malaysia time.
- **Your workspace key could not be used on this server. Ask an owner to save it again.** An owner or admin should paste the key again and click **Replace key**.

## Related

- [Ask the assistants](/docs/getting-started/ask-the-assistants)
- [Invite your team](/docs/getting-started/invite-your-team)
- [AI models and keys](/docs/developers/ai-models-and-keys)
