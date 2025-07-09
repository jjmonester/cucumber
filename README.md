🥒 Cucumber Bot
===============
Pickle is dead. Turnip was on the horizon. But Cucumber is here, fresh, crunchy and entirely un-pickled. No dev knowledge and entirely bug ridden (probably) this vibe coding experiment is an attempt to fill the void Pickle left in our world. 

Cucumber Bot is a Slack application designed to manage on-call rotations, daily hand-offs, and other scheduled team tasks with ease. It provides a simple, interactive interface within Slack to create, manage, and automate user queues.

Features
--------

### Core Functionality

*   **Create, Edit, and Delete Rotations**: Easily manage multiple, independent rotations within any Slack channel.
    
*   **Round Robin Strategy**: All rotations automatically follow a simple round-robin (first-in, first-out) queue.
    
*   **Persistent Storage**: Your rotation configurations and user queues are saved locally in configs.json and rotations.json, so they persist even if the bot restarts.
    

### Slash Commands

The bot is controlled through a primary slash command, /cucumber, with several sub-commands:

*   /cucumber: Opens the main interactive modal to view and manage all rotations in the current channel.
    
*   /cucumber \[rotation-name\]: Manually triggers a pick from the specified rotation, sending a prompt to the next user in the queue.
    
*   /cucumber shuffle \[rotation-name\]: Instantly randomizes the order of the user queue for a specific rotation.
    
*   /cucumber help: Displays a brief, ephemeral help message listing all available commands.
    

### Interactive UI & Workflow

*   **Central Management Modal**: The /cucumber command opens a user-friendly modal that lists all existing rotations, shows the next 5 upcoming picks for each, and allows you to create new rotations.
    
*   **In-Place Message Updates**: To reduce channel noise, the bot's messages update in-place. A prompt to a user transforms into a confirmation message upon acceptance, creating a single, clean record of the hand-off.
    
*   **Silent Skips & Declines**: When a user skips or declines a rotation, the bot silently moves to the next person in the queue without posting extra messages in the channel, keeping conversations focused.
    

### Scheduling & Automation

*   **Flexible Scheduling**: Configure rotations to run on specific days of the week (e.g., Mon, Wed, Fri) at a specific time.
    
*   **Global Timezones**: Set the schedule for any timezone using a simple UTC offset dropdown (from UTC-12:00 to UTC+14:00).
    
*   **Optional Timeouts**: You can set an optional timeout (in minutes) for each rotation. If a user doesn't respond within the specified time, they are automatically skipped. If left blank, the bot will wait indefinitely.
    
*   **Optional Weekly Summaries**: For enhanced visibility, you can configure each rotation to proactively post a summary of the upcoming week's schedule. This can be set to post every Monday or on every day the rotation is scheduled to run.
    

Setup and Installation
----------------------

Follow these steps to get the Cucumber Bot running in your Slack workspace.

#### 1\. Prerequisites

*   [Node.js](https://nodejs.org/) (v14 or higher)
    
*   A Slack App with Socket Mode enabled.
    

#### 2\. Clone the Repository
`git clone   cd cucumber-bot `

#### 3\. Install Dependencies

`   npm install   `

#### 4\. Configure Environment Variables

Create a file named .env in the root of your project directory. This file will store the necessary tokens for your Slack app.

*   SLACK\_BOT\_TOKEN: This is the Bot User OAuth Token, which starts with xoxb-. Find it in your Slack App's "OAuth & Permissions" page.
    
*   SLACK\_APP\_TOKEN: This is an app-level token required for Socket Mode. It starts with xapp-. Generate one on your Slack App's "Basic Information" page under the "App-Level Tokens" section.
    

Your .env file should look like this:
`SLACK_BOT_TOKEN=xoxb-xxxxxxxxxxxx-xxxxxxxxxxxxxxxx-xxxxxxxx  SLACK_APP_TOKEN=xapp-x-xxxx-xxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx   `

#### 5\. Run the Bot

Start the application with the following command:

` npm start   `

If successful, you will see the message "⚡️ Cucumber Bot running!" in your console. You can now invite the bot to a channel in Slack and start using the /cucumber command.

Usage Examples
--------------

*   **Manage Rotations**: Type /cucumber in any channel the bot is in.
    
*   **Start a Rotation Manually**: /cucumber Sweep
    
*   **Shuffle a Queue**: /cucumber shuffle Sweep
    
*   **Get Help**: /cucumber help