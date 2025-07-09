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

function formatDateObject(dateObj) {
  if (!dateObj) return 'Invalid Date';
  if (typeof dateObj.toJSDate === 'function') {
    return dateObj.toJSDate().toDateString();
  }
  if (typeof dateObj.toDate === 'function') {
    return dateObj.toDate().toDateString();
  }
  if (typeof dateObj.toDateString === 'function') {
    return dateObj.toDateString();
  }
  return 'Invalid Date';
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
      { type:'input', block_id:'schedule_days', label:{type:'plain_text',text:'Days'},
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
      { type:'input', block_id:'schedule_time', label:{type:'plain_text',text:'Time'},
        element:{type:'plain_text_input',action_id:'time_input',
          placeholder:{type:'plain_text',text:'e.g., 09:30 or 23:00'},
          ...(existingConfig && existingConfig.time ? { initial_value: existingConfig.time } : {})
        } },
      { type:'input', block_id:'schedule_tz', label:{type:'plain_text',text:'Timezone'},
        element:{type:'static_select', action_id:'tz_select',
          placeholder: { type: 'plain_text', text: 'Select a timezone' },
          ...(initialTimezoneOption && { initial_option: initialTimezoneOption }),
          options: TIMEZONE_OPTIONS
        } },
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
            { text: { type: 'plain_text', text: 'Include list of future rotations in post' }, value: 'postWeeklySummary' },
            { text: { type: 'plain_text', text: '(If above) Only show list on Mondays' }, value: 'summaryOnlyOnMondays' }
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

  if (rotations.length > 0 && rotations.some(r => typeof configStore.getItem(channel, r) === 'object' && configStore.getItem(channel, r) !== null)) {
    blocks.push({ type: 'header', text: { type: 'plain_text', text: 'Existing rotations' } });

    for (const name of rotations) {
      const cfg = configStore.getItem(channel, name);
      if (typeof cfg !== 'object' || cfg === null || !cfg.timeout) continue;

      const queue = queueStore.getItem(channel, name) || [];
      let scheduleText = '_Rotation is missing a schedule (days, time, or timezone)._';
      
      if (cfg.days && cfg.days.length > 0 && cfg.time && cfg.tz && queue.length > 0) {
        try {
          const timeParts = cfg.time.split(':');
          if (timeParts.length !== 2) throw new Error(`Invalid time format: ${cfg.time}`);
          const [h, m] = timeParts.map(Number);
          if (isNaN(h) || isNaN(m)) throw new Error('Time contains non-numeric characters.');
          const days = cfg.days.map(d => WEEKDAY_MAP[d]).join(',');
          const cronPattern = `${m} ${h} * * ${days}`;
          const job = new CronJob(cronPattern, () => {}, null, false, cfg.tz);
          const nextDates = job.nextDates(5);
          
          const scheduleLines = nextDates.map((date, i) => {
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
  const queue = queueStore.getItem(channel, name) || [];
  if (!queue.length) {
    return client.chat.postMessage({ channel, text: `Rotation *${name}* is empty.` });
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
  const timeoutMinutes = configStore.getItem(channel, name).timeout;

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

    const days = cfg.days.map(d => WEEKDAY_MAP[d]).join(',');
    const [h, m] = cfg.time.split(':').map(Number);
    const cronPattern = `${m} ${h} * * ${days}`;
    const job = new CronJob(cronPattern, () => {}, null, false, cfg.tz);
    
    const upcomingPicks = [];
    let currentDate = new Date();
    while(upcomingPicks.length < 7) {
      let nextDate = job.nextDate(currentDate);
      if (!upcomingPicks.some(d => formatDateObject(d.date) === formatDateObject(nextDate))) {
        upcomingPicks.push({ date: nextDate });
      }
      currentDate = nextDate;
    }
    
    const scheduleLines = upcomingPicks.map((pick, i) => {
      const user = queue[i % queue.length];
      const formattedDate = formatDateObject(pick.date);
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

app.view('cucumber_new', async ({ack,view,client})=>{
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
    const tzOption    = v.schedule_tz.tz_select.selected_option;
    const tzValue     = tzOption?.value || 'Etc/GMT+0';
    const tzDisplay   = tzOption?.text?.text || 'UTC+00:00';
    const timeoutValue = v.timeout_block.timeout_input.value;
    const timeout     = timeoutValue && !isNaN(parseInt(timeoutValue)) ? parseInt(timeoutValue) : null;
    const summaryOpts = v.summary_options_block.summary_options_select.selected_options.map(o => o.value);
    const postWeeklySummary = summaryOpts.includes('postWeeklySummary');
    const summaryOnlyOnMondays = summaryOpts.includes('summaryOnlyOnMondays');

    const filtered = members;

    if (editingName && editingName !== name) {
      configStore.deleteItem(channel, editingName);
      queueStore.deleteItem(channel, editingName);
    }

    configStore.setItem(channel,name,{ days, time, tz: tzValue, timeout, postWeeklySummary, summaryOnlyOnMondays });
    queueStore.setItem(channel,name,filtered);

    await ensureBotInChannel(client,channel);
    await client.chat.postMessage({
      channel,
      text:`Updated 🧹 *${name}*: ${filtered.length} members, ${days.join(', ')} @ ${time} (${tzDisplay})`
    });

    scheduleAll();
    
    if (!editingName) { await startPick(channel,name,client); }
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
      
      pickJob = new CronJob(cronPattern, () => startPick(channel, name, app.client), null, true, cfg.tz);
      console.log(`✅ Scheduled pick job for ${name} - next run:`, pickJob.nextDate().toString());
    } catch (error) { console.error(`Error creating pick job for ${name}:`, error); }
  }

  if (cfg.postWeeklySummary && cfg.time && cfg.tz) {
    try {
      const [h, m] = cfg.time.split(':').map(Number);
      const summaryDays = cfg.summaryOnlyOnMondays ? '1' : (cfg.days || []).map(d => WEEKDAY_MAP[d]).join(',');
      if (summaryDays) {
        const summaryPattern = `${m} ${h} * * ${summaryDays}`;

        summaryJob = new CronJob(summaryPattern, () => postWeeklySummary(channel, name), null, true, cfg.tz);
        console.log(`✅ Scheduled summary job for ${name} - next run:`, summaryJob.nextDate().toString());
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