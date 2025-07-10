🥒 Dill Bot
===============
Pickle is dead. Turnip was on the horizon. But Dill is here, fresh, aromatic and entirely separate from the veggies. No dev knowledge and entirely bug ridden (probably) this vibe coding experiment is an attempt to fill the void Pickle left in our world. 

Dill Bot is a Slack application designed to manage on-call rotations, daily hand-offs, and other scheduled team tasks with ease. It provides a simple, interactive interface within Slack to create, manage, and automate user queues.

## Features

### Core Functionality

-   Create, Edit, and Delete Rotations: Easily manage multiple, independent rotations within any Slack channel.
    
-   Round Robin Strategy: All rotations automatically follow a simple round-robin (first-in, first-out) queue.
    
-   Automatic Queue Reset: When a rotation completes a full cycle, the queue is automatically repopulated from the original member list and randomized to start a new cycle.
    
-   Persistent Storage: Your rotation configurations and user queues are saved locally in `configs.json` and `rotations.json`, so they persist even if the bot restarts.
    

### Slash Commands

The bot is controlled through a primary slash command, `/dill`, with several sub-commands:

-   `/dill`: Opens the main interactive modal to view and manage all rotations in the current channel.
    
-   `/dill [rotation-name]`: Manually triggers a pick from the specified rotation.
    
-   `/dill shuffle [rotation-name]`: Instantly randomizes the order of a rotation's queue.
    
-   `/dill help`: Displays a brief, ephemeral help message.
    

### Interactive UI & Workflow

-   Central Management Modal: The `/dill` command opens a user-friendly modal that lists all existing rotations and shows a preview of the next 5 upcoming picks for each.
    
-   Live UI Updates: When you save changes to a rotation, the main list automatically refreshes to show the latest state.
    
-   In-Place Message Updates: To reduce channel noise, the bot's messages update in-place. A prompt to a user transforms into a confirmation message upon acceptance, creating a single, clean record of the hand-off.
    
-   Silent Operations: When a user skips or declines, the bot silently moves to the next person in the queue without posting extra messages, keeping channels tidy.
    

### Scheduling & Automation

-   Advanced Scheduling Frequency: Configure rotations to run on a `Weekly`, `Fortnightly` (every 2 weeks), or `Monthly` (every 4 weeks) basis.
    
-   Flexible Day & Time Selection: Set schedules to run on specific days of the week at a specific time.
    
-   Global Timezones: Set the schedule for any timezone using a simple UTC offset dropdown (from `UTC-12:00` to `UTC+14:00`).
    
-   Optional Timeouts: You can set an optional timeout (in minutes). If a user doesn't respond in time, they are automatically skipped. If left blank, the bot will wait indefinitely.
    
-   Optional Weekly Summaries: For enhanced visibility, you can configure each rotation to proactively post a summary of the upcoming week's schedule, either on Mondays or on every day the rotation runs.
    

## Setup and Installation

Follow these steps to get the dill Bot running in your Slack workspace.

#### 1\. Prerequisites

-   [Node.js](https://nodejs.org/) (v14 or higher)
    
-   A Slack App with Socket Mode enabled and the required permissions/scopes.
    

#### 2\. Clone the Repository

Bash

```
git clone <your-repository-url>
cd <project-directory>
```

#### 3\. Install Dependencies

Bash

```
npm install
```

#### 4\. Configure Environment Variables

Create a file named `.env` in the root of your project directory. This file will store the necessary tokens for your Slack app.
```
# xoxb-… bot token
SLACK_BOT_TOKEN=

# xapp-… app-level token (for Socket Mode)
SLACK_APP_TOKEN=

# your Signing Secret from Slack App settings
SLACK_SIGNING_SECRET=
```

#### 5\. Run the Bot

Start the application with the following command:

Bash

```
npm start
```

If successful, you will see the message "⚡️ Dill Bot running!" in your console. You can now invite the bot to a channel in Slack and start using the `/dill` command.