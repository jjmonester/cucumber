// index.js
require('dotenv').config();

const { App, SocketModeReceiver, LogLevel } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');
const { CronJob } = require('cron');

// ─── Timezone Options ──────────────────────────────────────────────────────────
const TIMEZONE_OPTIONS = [
  { text: { type: 'plain_text', text: 'UTC-12:00' }, value: 'Etc/GMT+12' },
  { text: { type: 'plain_text', text: 'UTC-11:00' }, value: 'Etc/GMT+11' },
  { text: { type: 'plain_text', text: 'UTC-10:00' }, value: 'Etc/GMT+10' },
  { text: { type: 'plain_text', text: 'UTC-09:00' }, value: 'Etc/GMT+9' },
  { text: { type: 'plain_text', text: 'UTC-08:00' }, value: 'Etc/GMT+8' },
  { text: { type: 'plain_text', text: 'UTC-07:00' }, value: 'Etc/GMT+7' },
  { text: { type: 'plain_text', text: 'UTC-06:00' }, value: 'Etc/GMT+6' },
  { text: { type: 'plain_text', text: 'UTC-05:00' }, value: 'Etc/GMT+5' },
  { text: { type: 'plain_text', text: 'UTC-04:00' }, value: 'Etc/GMT+4' },
  { text: { type: 'plain_text', text: 'UTC-03:00' }, value: 'Etc/GMT+3' },
  { text: { type: 'plain_text', text: 'UTC-02:00' }, value: 'Etc/GMT+2' },
  { text: { type: 'plain_text', text: 'UTC-01:00' }, value: 'Etc/GMT+1' },
  { text: { type: 'plain_text', text: 'UTC+00:00' }, value: 'Etc/GMT+0' },
  { text: { type: 'plain_text', text: 'UTC+01:00' }, value: 'Etc/GMT-1' },
  { text: { type: 'plain_text', text: 'UTC+02:00' }, value: 'Etc/GMT-2' },
  { text: { type: 'plain_text', text: 'UTC+03:00' }, value: 'Etc/GMT-3' },
  { text: { type: 'plain_text', text: 'UTC+04:00' }, value: 'Etc/GMT-4' },
  { text: { type: 'plain_text', text: 'UTC+05:00' }, value: 'Etc/GMT-5' },
  { text: { type: 'plain_text', text: 'UTC+06:00' }, value: 'Etc/GMT-6' },
  { text: { type: 'plain_text', text: 'UTC+07:00' }, value: 'Etc/GMT-7' },
  { text: { type: 'plain_text', text: 'UTC+08:00' }, value: 'Etc/GMT-8' },
  { text: { type: 'plain_text', text: 'UTC+09:00' }, value: 'Etc/GMT-9' },
  { text: { type: 'plain_text', text: 'UTC+10:00' }, value: 'Etc/GMT-10' },
  { text: { type: 'plain_text', text: 'UTC+11:00' }, value: 'Etc/GMT-11' },
  { text: { type: 'plain_text', text: 'UTC+12:00' }, value: 'Etc/GMT-12' },
  { text: { type: 'plain_text', text: 'UTC+13:00' }, value: 'Etc/GMT-13' },
  { text: { type: 'plain_text', text: 'UTC+14:00' }, value: 'Etc/GMT-14' },
];


// ─── Persistent Stores ─────────────────────────────────────────────────────────
class NestedStore {
  constructor(file) {
    this.filePath = path.resolve(__dirname, file);
    this._load();
  }
  _load() {
    try { this.data = JSON.parse(fs.readFileSync(this.filePath)); }
    catch { this.data = {}; this._save(); }
  }
  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
  get(channel) { return this.data[channel] || {}; }
  getItem(channel, key) { return (this.data[channel] || {})[key]; }
  setItem(channel, key, value) {
    if (!this.data[channel]) this.data[channel] = {};
    this.data[channel][key] = value;
    this._save();
  }
  deleteItem(channel, key) {
    if (this.data[channel] && typeof this.data[channel][key] !== 'undefined') {
      delete this.data[channel][key];
      this._save();
    }
  }
}

const configStore = new NestedStore('configs.json');
const queueStore  = new NestedStore('rotations.json');

// ─── Bolt + Socket Mode setup ─────────────────────────────────────────────────
const socketReceiver = new SocketModeReceiver({
  appToken: process.env.SLACK_APP_TOKEN,
  logLevel: LogLevel.DEBUG
});
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver: socketReceiver,
  logLevel: LogLevel.DEBUG
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
async function ensureBotInChannel(client, channel) {
  try { await client.conversations.join({ channel }); } catch {}
}

function toNativeDate(dateObj) {
  if (!dateObj) return null;
  if (dateObj instanceof Date) return dateObj;
  if (typeof dateObj.toJSDate === 'function') return dateObj.toJSDate();
  if (typeof dateObj.toDate === 'function') return dateObj.toDate();
  return null;
}

function formatDateObject(dateObj) {
  const nativeDate = toNativeDate(dateObj);
  return nativeDate ? nativeDate.toDateString() : 'Invalid Date';
}


const WEEKDAY_MAP = { mon:1, tue:2, wed:3, thu:4, fri:5, sat:6, sun:0 };
const activeTimers = {};
const activeMessages = {};

// ─── Build "New Rotation" view ─────────────────────────────────────────────────
function buildNewRotationView(channel, preName = '') {
  const existingConfig = preName ? configStore.getItem(channel, preName) : null;
  const existingQueue = preName ? queueStore.getItem(channel, preName) : null;

  let initialTimezoneOption;
  if (existingConfig && existingConfig.tz) {
      initialTimezoneOption = TIMEZONE_OPTIONS.find(opt => opt.value === existingConfig.tz);
  }

  const initialSummaryOptions = [];
  if (existingConfig?.postWeeklySummary) {
    initialSummaryOptions.push({ text: { type: 'plain_text', text: 'Post a weekly schedule summary' }, value: 'postWeeklySummary' });
  }
  if (existingConfig?.summaryOnlyOnMondays) {
    initialSummaryOptions.push({ text: { type: 'plain_text', text: 'Only post the summary on Mondays' }, value: 'summaryOnlyOnMondays' });
  }

  const frequencyOptions = [
      { text: { type: 'plain_text', text: 'Weekly' }, value: 'weekly' },
      { text: { type: 'plain_text', text: 'Fortnightly' }, value: 'fortnightly' },
      { text: { type: 'plain_text', text: 'Monthly (every 4 weeks)' }, value: 'monthly' }
  ];

  let initialFrequencyOption;
  if (existingConfig && existingConfig.frequency) {
    initialFrequencyOption = frequencyOptions.find(opt => opt.value === existingConfig.frequency);
  }
  
  return {
    type: 'modal',
    callback_id: 'cucumber_new',
    private_metadata: JSON.stringify({ channel, editingName: preName }),
    title: { type:'plain_text', text: preName ? 'Edit Rotation' : 'New Rotation' },
    close: { type:'plain_text', text:'Cancel' },
    submit: { type:'plain_text', text:'Save' },
    blocks: [
      { type:'input', block_id:'name_block', label:{type:'plain_text',text:'Name'},
        element:{type:'plain_text_input',action_id:'name_input',initial_value:preName} },
      { type:'input', block_id:'member_block', label:{type:'plain_text',text:'Members'},
        element:{type:'multi_users_select',action_id:'members_select',
          ...(existingQueue && existingQueue.length > 0 ? { initial_users: existingQueue } : {})
        } },
      { type: 'divider' },
      { type: 'header', text: { type: 'plain_text', text: 'Schedule' } },
      { type:'input', block_id:'frequency_block', label:{type:'plain_text',text:'Frequency'},
        element:{type:'static_select', action_id:'frequency_select',
          placeholder: { type: 'plain_text', text: 'Select frequency' },
          initial_option: initialFrequencyOption || frequencyOptions[0],
          options: frequencyOptions
        } },
      { type:'input', block_id:'schedule_days', label:{type:'plain_text',text:'On'},
        element:{type:'multi_static_select',action_id:'days_select',
          ...(existingConfig && existingConfig.days ? { initial_options: existingConfig.days.map(day => ({
            text: {type:'plain_text',text:day.charAt(0).toUpperCase() + day.slice(1)},
            value: day
          })) } : {}),
          options:[
            {text:{type:'plain_text',text:'Mon'},value:'mon'},
            {text:{type:'plain_text',text:'Tue'},value:'tue'},
            {text:{type:'plain_text',text:'Wed'},value:'wed'},
            {text:{type:'plain_text',text:'Thu'},value:'thu'},
            {text:{type:'plain_text',text:'Fri'},value:'fri'},
            {text:{type:'plain_text',text:'Sat'},value:'sat'},
            {text:{type:'plain_text',text:'Sun'},value:'sun'}
          ]
        } },
      { type:'input', block_id:'schedule_time', label:{type:'plain_text',text:'At (Time)'},
        element:{type:'plain_text_input',action_id:'time_input',
          placeholder:{type:'plain_text',text:'e.g., 09:30 or 23:00'},
          ...(existingConfig && existingConfig.time ? { initial_value: existingConfig.time } : {})
        } },
      { type:'input', block_id:'schedule_tz', label:{type:'plain_text',text:'In (Timezone)'},
        element:{type:'static_select', action_id:'tz_select',
          placeholder: { type: 'plain_text', text: 'Select a timezone' },
          ...(initialTimezoneOption && { initial_option: initialTimezoneOption }),
          options: TIMEZONE_OPTIONS
        } },
      { type: 'divider' },
      { type:'input', optional: true, block_id:'timeout_block', label:{type:'plain_text',text:'Timeout (minutes)'},
        element:{type:'plain_text_input',action_id:'timeout_input',
          placeholder:{type:'plain_text',text:'(optional) e.g., 10'},
          ...(existingConfig && existingConfig.timeout ? { initial_value: existingConfig.timeout.toString() } : {})
        } },
      { type: 'divider' },
      { type: 'input', optional: true, block_id: 'summary_options_block', label: {type: 'plain_text', text: 'Weekly Summary Options'},
        element: { type: 'checkboxes', action_id: 'summary_options_select',
          ...(initialSummaryOptions.length > 0 && { initial_options: initialSummaryOptions }),
          options: [
            { text: { type: 'plain_text', text: 'Post a weekly schedule summary' }, value: 'postWeeklySummary' },
            { text: { type: 'plain_text', text: 'Only post the summary on Mondays' }, value: 'summaryOnlyOnMondays' }
          ]
        }
      }
    ]
  };
}

// ─── Build "Select Rotation" View Blocks ─────────────────────────
async function buildRotationsViewBlocks(channel) {
  const rotations = Object.keys(configStore.get(channel));
  const blocks = [];

  const hasRotations = rotations.some(r => {
    const cfg = configStore.getItem(channel, r);
    return typeof cfg === 'object' && cfg !== null && Array.isArray(cfg.days);
  });

  if (hasRotations) {
    blocks.push({ type: 'header', text: { type: 'plain_text', text: 'Existing rotations' } });

    for (const name of rotations) {
      const cfg = configStore.getItem(channel, name);
      if (typeof cfg !== 'object' || cfg === null || !Array.isArray(cfg.days)) continue;

      const queue = queueStore.getItem(channel, name) || [];
      let scheduleText = '_Rotation is missing a schedule (days, time, or timezone)._';
      
      if (cfg.days && cfg.days.length > 0 && cfg.time && cfg.tz && queue.length > 0) {
        try {
          const scheduleLines = getNextOccurrences(cfg, 5).map((date, i) => {
            const user = queue[i % queue.length];
            const formattedDate = formatDateObject(date);
            return `• ${formattedDate}: <@${user}>`;
          });
          scheduleText = scheduleLines.join('\n');
        } catch (error) {
          console.error(`Error calculating next dates for "${name}":`, error);
          scheduleText = '_Could not calculate schedule due to an error._';
        }
      } else if (queue.length === 0) {
        scheduleText = '_This rotation has no members in the queue._';
      }

      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*${name}*\n${scheduleText}` } });
      blocks.push({ type: 'actions', elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Edit' }, action_id: 'edit_rotation', value: name },
        { type: 'button', text: { type: 'plain_text', text: 'Delete' }, action_id: 'delete_rotation_start', value: name, style: 'danger' }
      ]});
      blocks.push({ type: 'divider' });
    }
  } else {
    blocks.push({ type: 'section', text: {
      type: 'mrkdwn',
      text: "Welcome to Cucumber Rotations! 🥒\n\nThis bot helps you manage on-call shifts and other scheduled hand-offs. There are no rotations set up in this channel yet."
    }});
  }

  blocks.push({ type: 'divider' });
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: '*Create a new rotation*' },
    accessory: { type: 'button', text: { type: 'plain_text', text: 'New Rotation' }, action_id: 'create_new', style: 'primary' }
  });

  return blocks;
}

// ─── Open "Select Rotation" modal ──────────────────────────────────────────────
async function openSelectModal(client, trigger_id, channel) {
  const blocks = await buildRotationsViewBlocks(channel);
  await client.views.open({
    trigger_id,
    view: {
      type: 'modal',
      callback_id: 'cucumber_select',
      private_metadata: channel,
      title: { type: 'plain_text', text: 'Cucumber Rotations' },
      submit: { type: 'plain_text', text: 'Done' },
      blocks
    }
  });
}

// ─── Helper function to open new rotation modal ──────────────────────────────
async function openNewRotationModal(client, trigger_id, channel, preName = '') {
  try {
    await client.views.open({
      trigger_id,
      view: buildNewRotationView(channel, preName)
    });
  } catch (error) {
    console.error('Error opening new rotation modal:', error);
  }
}

// ─── Core pick logic ───────────────────────────────────────────────────────────
async function startPick(channel, name, client) {
  let queue = queueStore.getItem(channel, name) || [];
  const cfg = configStore.getItem(channel, name) || {};
  const members = cfg.members || [];

  if (queue.length === 0) {
    if (members.length > 0) {
      console.log(`Queue for "${name}" is empty. Repopulating and shuffling.`);
      queue = [...members];
      for (let i = queue.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [queue[i], queue[j]] = [queue[j], queue[i]];
      }
    } else {
       return client.chat.postMessage({ channel, text: `Rotation *${name}* is empty and has no members configured.` });
    }
  }

  const user = queue.shift();
  queueStore.setItem(channel, name, queue);

  const d = new Date();
  const dateString = `${d.toLocaleDateString('en-US', { weekday: 'short' })}, ${d.toLocaleDateString('en-US', { month: 'long' })} ${d.getDate()}`;
  const text = `*${name}*: <@${user}>\n*Date*: ${dateString}`;

  await ensureBotInChannel(client, channel);
  const response = await client.chat.postMessage({
    channel, text: `A new rotation pick for ${name}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      { type: 'actions', block_id: 'cucumber_confirm', elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Accept' }, style: 'primary', action_id: 'accept', value: JSON.stringify({ name, user, dateString }) },
          { type: 'button', text: { type: 'plain_text', text: 'Decline' }, style: 'danger', action_id: 'decline', value: JSON.stringify({ name, user }) },
          { type: 'button', text: { type: 'plain_text', text: 'Skip' }, action_id: 'skip', value: JSON.stringify({ name, user }) }
      ]}
    ]
  });

  const key = `${channel}:${name}:${user}`;
  activeMessages[key] = response.ts;
  const timeoutMinutes = cfg.timeout;

  if (timeoutMinutes) {
    activeTimers[key] = setTimeout(
      () => handleSkip(channel, name, user, client, true),
      timeoutMinutes * 60 * 1000
    );
  }
}

async function handleSkip(channel,name,user,client,byTimeout=false){
  const key = `${channel}:${name}:${user}`;
  if(activeTimers[key]){ clearTimeout(activeTimers[key]); delete activeTimers[key]; }

  if (activeMessages[key]) {
    try { await client.chat.delete({ channel: channel, ts: activeMessages[key] }); }
    catch (error) { console.error('Error deleting message:', error); }
    delete activeMessages[key];
  }
  
  const queue = queueStore.getItem(channel,name)||[];
  queue.push(user);
  queueStore.setItem(channel,name,queue);

  await startPick(channel,name,client);
}

async function handleDecline(channel,name,user,client){
  const key = `${channel}:${name}:${user}`;
  if(activeTimers[key]){ clearTimeout(activeTimers[key]); delete activeTimers[key]; }
  
  if (activeMessages[key]) {
    try { await client.chat.delete({ channel: channel, ts: activeMessages[key] }); }
    catch (error) { console.error('Error deleting message:', error); }
    delete activeMessages[key];
  }
  
  const queue = queueStore.getItem(channel,name)||[];
  queue.push(user);
  queueStore.setItem(channel,name,queue);

  await startPick(channel,name,client);
}

// New Helper to post weekly summaries
async function postWeeklySummary(channel, name) {
  try {
    const cfg = configStore.getItem(channel, name);
    const queue = queueStore.getItem(channel, name) || [];
    if (!cfg || queue.length === 0) return;

    const upcomingPicks = getNextOccurrences(cfg, 7);
    
    const scheduleLines = upcomingPicks.map((pickDate, i) => {
      const user = queue[i % queue.length];
      const formattedDate = formatDateObject(pickDate);
      return `• *${formattedDate}*: <@${user}>`;
    });

    await app.client.chat.postMessage({
      channel,
      text: `Weekly schedule for ${name}`,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `Upcoming schedule for ${name}`, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: scheduleLines.join('\n') } }
      ]
    });
  } catch (error) {
    console.error(`Failed to post weekly summary for ${name} in ${channel}:`, error);
  }
}

// ─── Slash command handler ────────────────────────────────────────────────────
app.command('/cucumber', async ({ack,body,client,say})=>{
  await ack();
  try {
    const channel = body.channel_id;
    const text = (body.text||'').trim();

    if (text.toLowerCase().startsWith('shuffle')) {
      const nameToShuffle = text.substring(7).trim();
      if (!nameToShuffle) {
        return say({ response_type: 'ephemeral', text: 'Please specify which rotation to shuffle. Usage: `/cucumber shuffle [rotation name]`' });
      }
      const rotations = configStore.get(channel);
      const rotationName = Object.keys(rotations).find(name => name.toLowerCase() === nameToShuffle.toLowerCase());

      if (!rotationName) {
        return say({ response_type: 'ephemeral', text: `Could not find a rotation named *${nameToShuffle}*.` });
      }

      const queue = queueStore.getItem(channel, rotationName) || [];
      if (queue.length < 2) {
        return say({ response_type: 'in_channel', text: `The *${rotationName}* rotation has too few members to shuffle.` });
      }

      for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
      }
      
      queueStore.setItem(channel, rotationName, queue);
      const newOrder = queue.map((u, i) => `${i+1}. <@${u}>`).join('\n');
      return say({ response_type: 'in_channel', text: `✅ The queue for *${rotationName}* has been shuffled.\n\nNew order:\n${newOrder}` });
    }

    if(text==='help'){
      return say({ response_type:'ephemeral', text:
        '*Cucumber Help*\n'+
        '• `/cucumber` → Manage rotations\n'+
        '• `/cucumber [name]` → Manually start a rotation\n' +
        '• `/cucumber shuffle [name]` → Randomize the order of a rotation queue\n' +
        '• `/cucumber help` → Show this help message'
      });
    }
    
    if(text){
      const rotations = configStore.get(channel);
      const rotationName = Object.keys(rotations).find(name => name.toLowerCase() === text.toLowerCase());
      
      if(rotationName){
        console.log(`Manual trigger: Starting rotation "${rotationName}" in channel ${channel}`);
        await say({ text:`Starting rotation *${rotationName}*...`, response_type:'in_channel'});
        return startPick(channel, rotationName, client);
      }
      
      return openNewRotationModal(client,body.trigger_id,channel,text);
    }
    await openSelectModal(client,body.trigger_id,channel);
  } catch (error) {
    console.error("A top-level error occurred in the /cucumber command handler:", error);
  }
});

// ─── View & Action Handlers ───────────────────────────────────────────────────

app.view('cucumber_select', async ({ ack }) => {
  await ack();
});

app.action('create_new', async ({ack,body,client})=>{
  await ack();
  try {
    const channel = body.view.private_metadata;
    await client.views.push({ trigger_id: body.trigger_id, view: buildNewRotationView(channel) });
  } catch (error) { console.error('Error handling create_new action:', error); }
});

app.action('edit_rotation', async ({ack,body,client})=>{
  await ack();
  try {
    const channel = body.view.private_metadata;
    const name = body.actions[0].value;
    await client.views.push({ trigger_id: body.trigger_id, view: buildNewRotationView(channel, name) });
  } catch (error) { console.error('Error handling edit_rotation action:', error); }
});

app.action('delete_rotation_start', async ({ ack, body, client }) => {
  await ack();
  try {
    const channel = body.view.private_metadata;
    const name = body.actions[0].value;
    await client.views.push({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal', callback_id: 'delete_rotation_confirm',
        private_metadata: JSON.stringify({ channel, name }),
        title: { type: 'plain_text', text: 'Confirm Deletion' },
        submit: { type: 'plain_text', text: 'Delete' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [{ type: 'section', text: {
          type: 'mrkdwn',
          text: `Are you sure you want to delete the *${name}* rotation?\n\nThis action cannot be undone.`
        }}]
      }
    });
  } catch (error) { console.error('Error opening delete confirmation modal:', error.data || error); }
});

app.view('cucumber_new', async ({ack,body,view,client})=>{
  const v = view.state.values;
  const time = v.schedule_time.time_input.value;

  if (time && !/^\d{1,2}:\d{2}$/.test(time)) {
    await ack({ response_action: 'errors', errors: { 'schedule_time': 'Please use HH:MM format (e.g., 09:30 or 23:00).' } });
    return;
  }
  
  await ack();

  try {
    const metadata = JSON.parse(view.private_metadata);
    const { channel, editingName } = metadata;
    
    const name        = v.name_block.name_input.value.trim();
    const members     = v.member_block.members_select.selected_users || [];
    const days        = v.schedule_days.days_select.selected_options?.map(o=>o.value) || [];
    const frequency   = v.frequency_block.frequency_select.selected_option?.value || 'weekly';
    const tzOption    = v.schedule_tz.tz_select.selected_option;
    const tzValue     = tzOption?.value || 'Etc/GMT+0';
    const tzDisplay   = tzOption?.text?.text || 'UTC+00:00';
    const timeoutValue = v.timeout_block.timeout_input.value;
    const timeout     = timeoutValue && !isNaN(parseInt(timeoutValue)) ? parseInt(timeoutValue) : null;
    const summaryOpts = v.summary_options_block.summary_options_select.selected_options.map(o => o.value);
    const postWeeklySummary = summaryOpts.includes('postWeeklySummary');
    const summaryOnlyOnMondays = summaryOpts.includes('summaryOnlyOnMondays');

    if (editingName && editingName !== name) {
      configStore.deleteItem(channel, editingName);
      queueStore.deleteItem(channel, editingName);
    }

    configStore.setItem(channel,name,{ days, time, tz: tzValue, timeout, frequency, postWeeklySummary, summaryOnlyOnMondays, startDate: new Date().toISOString(), members });
    queueStore.setItem(channel,name,members);

    await ensureBotInChannel(client,channel);
    await client.chat.postMessage({
      channel,
      text:`Updated 🧹 *${name}*: ${members.length} members, ${frequency}, on ${days.join(', ')} @ ${time} (${tzDisplay})`
    });

    scheduleAll();
    
    if (!editingName) { await startPick(channel,name,client); }
    
    // Refresh the main view
    const newBlocks = await buildRotationsViewBlocks(channel);
    await client.views.update({
        view_id: body.view.root_view_id,
        view: {
            type: 'modal',
            callback_id: 'cucumber_select',
            private_metadata: channel,
            title: { type: 'plain_text', text: 'Cucumber Rotations' },
            submit: { type: 'plain_text', text: 'Done' },
            blocks: newBlocks
        }
    });

  } catch (error) { console.error('Error handling cucumber_new view submission:', error); }
});

app.view('delete_rotation_confirm', async ({ ack, view, client, body }) => {
  await ack();
  try {
    const { channel, name } = JSON.parse(view.private_metadata);
    configStore.deleteItem(channel, name);
    queueStore.deleteItem(channel, name);

    const jobKey = `${channel}:${name}`;
    if (scheduledJobs.has(jobKey)) {
      const { pickJob, summaryJob } = scheduledJobs.get(jobKey);
      if (pickJob) pickJob.stop();
      if (summaryJob) summaryJob.stop();
      scheduledJobs.delete(jobKey);
      console.log(`🗑️ Deleted and unscheduled jobs for ${name}`);
    }

    await client.chat.postMessage({
      channel, text: `The *${name}* rotation has been deleted by <@${body.user.id}>.`
    });
  } catch (error) { console.error('Error deleting rotation:', error); }
});

app.action('accept', async ({ack,body,client})=>{
  await ack();
  const {name,user,dateString} = JSON.parse(body.actions[0].value);
  const channel = body.channel.id;
  const key = `${channel}:${name}:${user}`;
  
  if(activeTimers[key]) clearTimeout(activeTimers[key]);
  delete activeTimers[key];
  
  const newText = `*${name}*: <@${user}>\n*Date*: ${dateString}\n*Status*: Accepted ✅`;

  try {
    await client.chat.update({
      channel: channel,
      ts: activeMessages[key],
      text: `Rotation ${name} accepted by ${user}`,
      blocks: [ { type: 'section', text: { type: 'mrkdwn', text: newText } } ]
    });
  } catch (error) {
    console.error('Error updating message on accept:', error);
  }
  delete activeMessages[key];
});

app.action('decline', async ({ack,body,client})=>{
  await ack();
  const {name,user} = JSON.parse(body.actions[0].value);
  await handleDecline(body.channel.id,name,user,client);
});

app.action('skip', async ({ack,body,client})=>{
  await ack();
  const {name,user} = JSON.parse(body.actions[0].value);
  await handleSkip(body.channel.id,name,user,client,false);
});

// ─── Scheduling ────────────────────────────────────────────────────────────────
const scheduledJobs = new Map();

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1));
    var weekNo = Math.ceil(( ( (d - yearStart) / 86400000) + 1)/7);
    return weekNo;
}

function getNextOccurrences(cfg, count) {
    const occurrences = [];
    if (!cfg.days || cfg.days.length === 0 || !cfg.time || !cfg.tz) return occurrences;
    
    const [h, m] = cfg.time.split(':').map(Number);
    const days = cfg.days.map(d => WEEKDAY_MAP[d]);
    const rotationStartDate = new Date(cfg.startDate);
    const startWeek = getWeekNumber(rotationStartDate);
    const frequencyInterval = cfg.frequency === 'fortnightly' ? 2 : cfg.frequency === 'monthly' ? 4 : 1;

    let currentDate = new Date();
    currentDate.setSeconds(0, 0);

    while (occurrences.length < count) {
        currentDate.setDate(currentDate.getDate() + 1);
        
        if (days.includes(currentDate.getDay())) {
            const currentWeek = getWeekNumber(currentDate);
            if ((currentWeek - startWeek) % frequencyInterval === 0) {
                const newDate = new Date(currentDate.getTime());
                newDate.setHours(h, m);
                occurrences.push(newDate);
            }
        }
    }
    return occurrences;
}

function scheduleJob(channel, name, cfg) {
  const jobKey = `${channel}:${name}`;
  if (scheduledJobs.has(jobKey)) {
    const { pickJob, summaryJob } = scheduledJobs.get(jobKey);
    if(pickJob) pickJob.stop();
    if(summaryJob) summaryJob.stop();
    scheduledJobs.delete(jobKey);
  }
  
  let pickJob, summaryJob;

  if (cfg.days && cfg.days.length > 0 && cfg.time && cfg.tz) {
    try {
      const [h, m] = cfg.time.split(':').map(Number);
      const days = cfg.days.map(d => WEEKDAY_MAP[d]).join(',');
      const cronPattern = `${m} ${h} * * ${days}`;
      const rotationStartDate = new Date(cfg.startDate);
      const startWeek = getWeekNumber(rotationStartDate);
      const frequencyInterval = cfg.frequency === 'fortnightly' ? 2 : cfg.frequency === 'monthly' ? 4 : 1;
      
      pickJob = new CronJob(cronPattern, () => {
        const currentWeek = getWeekNumber(new Date());
        if ((currentWeek - startWeek) % frequencyInterval === 0) {
            console.log(`Executing pick for ${name} in week ${currentWeek}`);
            startPick(channel, name, app.client)
        } else {
            console.log(`Skipping pick for ${name} in week ${currentWeek} due to frequency settings.`);
        }
      }, null, true, cfg.tz);
      console.log(`✅ Scheduled pick job for ${name}`);
    } catch (error) { console.error(`Error creating pick job for ${name}:`, error); }
  }

  if (cfg.postWeeklySummary && cfg.time && cfg.tz) {
    try {
      const [h, m] = cfg.time.split(':').map(Number);
      const summaryDays = cfg.summaryOnlyOnMondays ? '1' : (cfg.days || []).map(d => WEEKDAY_MAP[d]).join(',');
      if (summaryDays) {
        const summaryPattern = `${m} ${h} * * ${summaryDays}`;

        summaryJob = new CronJob(summaryPattern, () => postWeeklySummary(channel, name), null, true, cfg.tz);
        console.log(`✅ Scheduled summary job for ${name}`);
      }
    } catch (error) { console.error(`Error creating summary job for ${name}:`, error); }
  }

  if (pickJob || summaryJob) {
    scheduledJobs.set(jobKey, { pickJob, summaryJob });
  }
}

function scheduleAll() {
  console.log('Scheduling all rotations...');
  
  scheduledJobs.forEach(({ pickJob, summaryJob }) => {
    if (pickJob) pickJob.stop();
    if (summaryJob) summaryJob.stop();
  });
  scheduledJobs.clear();
  
  Object.keys(configStore.data).forEach(ch => {
    Object.keys(configStore.data[ch]).forEach(n => {
      if (typeof configStore.data[ch][n] === 'object' && configStore.data[ch][n] !== null) {
        const cfg = configStore.getItem(ch, n);
        if (cfg?.days) scheduleJob(ch, n, cfg);
      }
    });
  });
  
  console.log(`Total scheduled job sets: ${scheduledJobs.size}`);
}

// ─── Start app ────────────────────────────────────────────────────────────────
(async()=>{
  await app.start();
  console.log('⚡️ Cucumber Bot running!');
  scheduleAll();
})();
