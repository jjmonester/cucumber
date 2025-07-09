// index.js
require('dotenv').config();

const { App, SocketModeReceiver, LogLevel } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');

// ─── Simple JSON rotation store ───────────────────────────────────────────────
class RotationStore {
  constructor(file = 'rotations.json') {
    this.filePath = path.resolve(__dirname, file);
    this._load();
  }
  _load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.filePath));
    } catch {
      this.data = {};
      this._save();
    }
  }
  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
  getQueue(id) {
    return this.data[id] || [];
  }
  init(id, members) {
    this.data[id] = [...members];
    this._save();
  }
  pop(id) {
    const q = this.getQueue(id);
    const next = q.shift();
    this.data[id] = q;
    this._save();
    return next;
  }
  push(id, user) {
    this.data[id] = this.getQueue(id).concat(user);
    this._save();
  }
}

const store = new RotationStore();

// ─── Setup Socket Mode Receiver ────────────────────────────────────────────────
const socketReceiver = new SocketModeReceiver({
  appToken: process.env.SLACK_APP_TOKEN,
  logLevel: LogLevel.INFO
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: socketReceiver,
  logLevel: LogLevel.INFO
});

// ─── Utility: parse <@U…> and <!subteam…> mentions ────────────────────────────
function parseMembers(text = '') {
  const re = /<@([UW][A-Z0-9]+)>|<!subteam\^([A-Z0-9]+)\|[^>]+>/g;
  const ids = new Set();
  let m;
  while (m = re.exec(text)) {
    ids.add(m[1] || m[2]);
  }
  return Array.from(ids);
}

// ─── Slash handler ─────────────────────────────────────────────────────────────
app.command('/cucumber', async ({ ack, payload, say, client }) => {
  await ack();
  const rotationId = payload.channel_id;
  const members = parseMembers(payload.text);

  if (!members.length) {
    return say({ text: 'Please mention at least one @user or @group.', response_type: 'ephemeral' });
  }
  if (!store.getQueue(rotationId).length) {
    store.init(rotationationId, members);
  }

  // pick loop
  let next;
  while ((next = store.pop(rotationId))) {
    try {
      const dm = await client.conversations.open({ users: next });
      await client.chat.postMessage({
        channel: dm.channel.id,
        text: `You’ve been picked in <#${rotationId}>! Accept?`,
        blocks: [
          {
            type: 'actions',
            block_id: 'cucumber_confirm',
            elements: [
              { type: 'button', text: { type: 'plain_text', text: 'Accept' }, value: next, action_id: 'accept' },
              { type: 'button', text: { type: 'plain_text', text: 'Skip'   }, value: next, action_id: 'skip'   }
            ]
          }
        ]
      });
      return say({ text: `Asking <@${next}>…`, response_type: 'in_channel' });
    } catch {
      // unable to DM → treat as skip
      store.push(rotationId, next);
    }
  }

  await say({ text: 'No one left to try!', response_type: 'in_channel' });
});

// ─── Action handler ────────────────────────────────────────────────────────────
app.action('accept', async ({ ack, body, client }) => {
  await ack();
  const picked = body.actions[0].value;
  await client.chat.postMessage({
    channel: body.channel.id,
    text: `<@${picked}> accepted the task!`
  });
});
app.action('skip', async ({ ack, body, client }) => {
  await ack();
  const picked = body.actions[0].value;
  const rotationId = body.channel.id;
  store.push(rotationId, picked);
  await client.chat.postMessage({
    channel: rotationId,
    text: `<@${picked}> was skipped—trying next…`
  });
  // re-invoke the command flow:
  await app.client.chat.postMessage({
    channel: rotationId,
    text: `/cucumber`
  });
});

// ─── Start your Socket Mode app ───────────────────────────────────────────────
(async () => {
  await app.start();
  console.log('⚡️ Cucumber bot (Socket Mode) is running!');
})();