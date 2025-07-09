# cucumber# Cucumber Bot: User Guide & Feature Reference

This document explains how to interact with the Cucumber Bot, its full feature set, and how to add or configure slash commands in your Slack App.

---

## 1. Overview

Cucumber Bot is a round‐robin scheduler for Slack. It lets teams manage recurring tasks (code reviews, meeting hosts, etc.) by maintaining a dynamic queue of users or user groups. When you invoke the bot, it:

1. Picks the next person in the queue
2. DMs them to **Accept** or **Skip**
3. If skipped (or unavailable), pushes them to the queue’s tail and tries the next
4. Announces the result back in the original channel

Socket Mode is used, so no public HTTPS endpoint is required—just run the bot code and ensure the `xapp-…` token is set.

---

## 2. Prerequisites

- **Bot & App Tokens** in your local `.env`:  
  ```dotenv
  SLACK_BOT_TOKEN=xoxb-…
  SLACK_APP_TOKEN=xapp-…
  SLACK_SIGNING_SECRET=…
  ```
- **OAuth Scopes**:  
  - `commands`, `chat:write`, `im:write`  
  - `channels:read`, `channels:join`  
  - `groups:read`, `groups:write` (if using in private channels)
- **Socket Mode** enabled in your Slack App settings

---

## 3. Slash Command: `/cucumber`

### 3.1 Usage

In any public or private channel where the bot is present, type:

```
/cucumber @user1 @user2 <!subteam^S123|@team> #channel
```

- **@user**, **@team**, or **#channel** mentions define the rotation membership.
- If the queue is empty (first run), Cucumber initializes it in the order you specify.
- The bot will DM the first member and await their response.

### 3.2 Responses

- In‐channel acknowledgment:  
  `Asking @alice…`
- DM to picked user with **Accept** / **Skip** buttons.
- In‐channel announcements:
  - On **Accept**: `@alice accepted the task!`
  - On **Skip**: `@alice was skipped—trying next…` and the cycle continues.

---

## 4. Action Buttons & Flow

1. **Accept**  
   - Immediately ends the rotation for this invocation and announces acceptance.
2. **Skip**  
   - Returns the user to the tail of the queue.  
   - Bot posts a skip notice, then will either continue automatically (if you integrate auto-reinvoke) or prompt users to run `/cucumber` again.


---

## 5. Feature Set

- **Round‐Robin, Stateful Queues**: Remembers order across invocations.
- **Skip + Requeue**: Skipped users return to the end; no one gets tried twice in one cycle until all have been attempted.
- **Socket Mode**: No need for public URLs or ngrok—bot connects via WebSocket.
- **JSON‐backed Store**: Simple `rotations.json` file stores per-channel queues.
- **Auto‐Join**: Bot automatically calls `conversations.join` before posting to ensure it’s a channel member.
- **Multi‐Member Support**: Accepts individual users and user groups (`<!subteam^…>`).

---

## 6. Inviting the Bot

If you ever see `not_in_channel` errors, ensure the bot is a member of the channel:
```bash
/invite @CucumberBot
```
or grant the `channels:join` scope and let the bot join programmatically.

---

## 7. Adding or Modifying Slash Commands

1. **Go to** [api.slack.com/apps] → *Your App* → **Slash Commands**.  
2. **Create New Command** (or edit `/cucumber`):
   - **Command**: `/cucumber`
   - **Request URL**: *Not used in Socket Mode* (can be left blank or set to any valid HTTPS URL).
   - **Short Description**: e.g., "Start a new rotation pick."
   - **Usage Hint**: `@user1 @user2 @team`.
3. **Save Changes**.  
4. **Re‐install App** under **OAuth & Permissions** if you add new scopes.


---

## 8. Common Troubleshooting

- **Missing Dependencies**: `npm install @slack/bolt dotenv`
- **ENV Variables Not Loaded**: Ensure `require('dotenv').config()` sits at the very top of `index.js`.
- **App‐Level Token Errors**: Verify `SLACK_APP_TOKEN` is set to your `xapp-…` value.
- **`not_in_channel`**: Invite the bot or use `conversations.join` in code.

---

For further customization or questions, feel free to reach out. Happy scheduling! 🎉