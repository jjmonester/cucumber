// index.js
require('dotenv').config();

const { App, SocketModeReceiver, LogLevel } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');
const { CronJob } = require('cron');

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

function formatRotationDetails(channel, name) {
  const cfg   = configStore.getItem(channel, name) || {};
  const queue = queueStore.getItem(channel, name) || [];
  const members = queue.map(u => `<@${u}>`).join(', ') || '_none_';
  const sched = cfg.days
    ? `${cfg.days.join(', ')} @ ${cfg.time} (${cfg.tz})`
    : 'Manual';
  return `*${name}*\n` +
         `• Members: ${members}\n` +
         `• Strategy: ${cfg.strategy}\n` +
         `• Retries: ${cfg.retry}\n` +
         `• Timeout: ${cfg.timeout}m\n` +
         `• Schedule: ${sched}`;
}

const WEEKDAY_MAP = { mon:1, tue:2, wed:3, thu:4, fri:5, sat:6, sun:0 };
const activeTimers = {};
const activeMessages = {}; // Track active messages to update them

// ─── Build "New Rotation" view ─────────────────────────────────────────────────
function buildNewRotationView(channel, preName = '') {
  const existingConfig = preName ? configStore.getItem(channel, preName) : null;
  const existingQueue = preName ? queueStore.getItem(channel, preName) : null;
  
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
      { type:'input', optional:true, block_id:'exclude_block', label:{type:'plain_text',text:'Exclude'},
        element:{type:'multi_users_select',action_id:'exclude_select'} },
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
          placeholder:{type:'plain_text',text:'HH:MM (24h)'},
          ...(existingConfig && existingConfig.time ? { initial_value: existingConfig.time } : {})
        } },
      { type:'input', block_id:'schedule_tz', label:{type:'plain_text',text:'Timezone'},
        element:{type:'static_select',action_id:'tz_select',
          ...(existingConfig && existingConfig.tz ? { initial_option: {
            text: {type:'plain_text',text:'Melbourne'},
            value: existingConfig.tz
          } } : {}),
          options:[
            {text:{type:'plain_text',text:'Melbourne'},value:'Australia/Melbourne'}
          ]
        } },
      { type:'input', block_id:'strategy_block', label:{type:'plain_text',text:'Strategy'},
        element:{type:'static_select',action_id:'strategy_select',
          ...(existingConfig && existingConfig.strategy ? { initial_option: {
            text: {type:'plain_text',text:existingConfig.strategy === 'roundrobin' ? 'Round Robin' : 
                   existingConfig.strategy === 'random' ? 'Random' : 'Weighted'},
            value: existingConfig.strategy
          } } : {}),
          options:[
            {text:{type:'plain_text',text:'Round Robin'},value:'roundrobin'},
            {text:{type:'plain_text',text:'Random'},value:'random'},
            {text:{type:'plain_text',text:'Weighted'},value:'weighted'}
          ]
        } },
      { type:'input', block_id:'retry_block', label:{type:'plain_text',text:'Retries'},
        element:{type:'plain_text_input',action_id:'retry_input',
          placeholder:{type:'plain_text',text:'e.g. 3'},
          ...(existingConfig && existingConfig.retry ? { initial_value: existingConfig.retry.toString() } : {})
        } },
      { type:'input', block_id:'timeout_block', label:{type:'plain_text',text:'Timeout (m)'},
        element:{type:'plain_text_input',action_id:'timeout_input',
          placeholder:{type:'plain_text',text:'e.g. 10'},
          ...(existingConfig && existingConfig.timeout ? { initial_value: existingConfig.timeout.toString() } : {})
        } }
    ]
  };
}

// ─── Open "Select Rotation" modal ──────────────────────────────────────────────
async function openSelectModal(client, trigger_id, channel) {
  const rotations = Object.keys(configStore.get(channel));
  const blocks = [{
    type:'header',
    text:{ type:'plain_text', text:'Existing rotations' }
  }];

  if (rotations.length > 0) {
    rotations.forEach(name => {
      blocks.push({
        type:'section',
        text:{ type:'mrkdwn', text:`*${name}*` },
        accessory:{
          type:'button',
          text:{type:'plain_text',text:'Edit'},
          action_id:'edit_rotation',
          value:name
        }
      });
    });
  } else {
    blocks.push({
      type:'section',
      text:{ type:'mrkdwn', text:'_No rotations found_' }
    });
  }

  blocks.push({ type:'divider' });
  blocks.push({
    type:'section',
    text:{ type:'mrkdwn', text:'*Or create a new rotation*' },
    accessory:{
      type:'button',
      text:{ type:'plain_text', text:'New Rotation' },
      action_id:'create_new',
      style:'primary'
    }
  });

  await client.views.open({
    trigger_id,
    view:{
      type:'modal',
      callback_id:'cucumber_select',
      private_metadata:channel,
      title:{type:'plain_text',text:'Cucumber Rotations'},
      close:{type:'plain_text',text:'Cancel'},
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

// ─── Helper function to update message after action ──────────────────────────
async function updateMessageAfterAction(client, channel, ts, name, user, action) {
  try {
    const actionText = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'skipped';
    const updatedText = `**${name}** <@${user}>, ${actionText}`;
    
    await client.chat.update({
      channel,
      ts,
      text: updatedText,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: updatedText
          }
        }
      ]
    });
  } catch (error) {
    console.error('Error updating message:', error);
  }
}

// ─── Core pick logic ───────────────────────────────────────────────────────────
async function startPick(channel, name, client) {
  const queue = queueStore.getItem(channel,name)||[];
  if (!queue.length) {
    return client.chat.postMessage({ channel, text:`Rotation *${name}* is empty.` });
  }
  const user = queue.shift();
  queueStore.setItem(channel,name,queue);

  const prompt = `**${name}** <@${user}>, you're up!`;

  await ensureBotInChannel(client,channel);
  const response = await client.chat.postMessage({
    channel, text:prompt,
    blocks:[
      {type:'section',text:{type:'mrkdwn',text:prompt}},
      {type:'actions',block_id:'cucumber_confirm',elements:[
        {type:'button',text:{type:'plain_text',text:'Accept'},style:'primary',action_id:'accept',value:JSON.stringify({name,user})},
        {type:'button',text:{type:'plain_text',text:'Decline'},style:'danger',action_id:'decline',value:JSON.stringify({name,user})},
        {type:'button',text:{type:'plain_text',text:'Skip'},action_id:'skip',value:JSON.stringify({name,user})}
      ]}
    ]
  });

  // Store the message timestamp for later updates
  const key = `${channel}:${name}:${user}`;
  activeMessages[key] = response.ts;
  
  activeTimers[key] = setTimeout(
    ()=> handleSkip(channel,name,user,client,true),
    (configStore.getItem(channel,name).timeout||5)*60*1000
  );
}

async function handleSkip(channel,name,user,client,byTimeout=false){
  const key = `${channel}:${name}:${user}`;
  if(activeTimers[key]){ clearTimeout(activeTimers[key]); delete activeTimers[key]; }
  
  // Update the original message if we have the timestamp
  if (activeMessages[key]) {
    await updateMessageAfterAction(client, channel, activeMessages[key], name, user, 'skip');
    delete activeMessages[key];
  }
  
  const queue = queueStore.getItem(channel,name)||[];
  // Add user to the END of the queue (recirculation)
  queue.push(user);
  queueStore.setItem(channel,name,queue);

  const note = byTimeout?'timed out':'was skipped';
  await client.chat.postMessage({
    channel, text:`_<@${user}> ${note} — trying next in *${name}*_…`
  });
  await startPick(channel,name,client);
}

async function handleDecline(channel,name,user,client){
  const key = `${channel}:${name}:${user}`;
  if(activeTimers[key]){ clearTimeout(activeTimers[key]); delete activeTimers[key]; }
  
  // Update the original message if we have the timestamp
  if (activeMessages[key]) {
    await updateMessageAfterAction(client, channel, activeMessages[key], name, user, 'decline');
    delete activeMessages[key];
  }
  
  const queue = queueStore.getItem(channel,name)||[];
  // Add user to the END of the queue (recirculation)
  queue.push(user);
  queueStore.setItem(channel,name,queue);

  await client.chat.postMessage({
    channel, text:`_<@${user}> declined — trying next in *${name}*_…`
  });
  await startPick(channel,name,client);
}

// ─── Slash command handler ────────────────────────────────────────────────────
app.command('/cucumber', async ({ack,body,client,say})=>{
  await ack();
  const channel = body.channel_id;
  const text = (body.text||'').trim();

  if(text==='help'){
    return say({ response_type:'ephemeral', text:
      '*Cucumber Help*\n'+
      '• `/cucumber` → manage rotations\n'+
      '• `/cucumber list` → list\n'+
      '• `/cucumber [name]` → start\n'+
      '• `/cucumber help` → help'
    });
  }
  if(text==='list'){
    const names = Object.keys(configStore.get(channel));
    if(!names.length) return say({text:'_No active rotations_',response_type:'in_channel'});
    const details = names.map(n=>formatRotationDetails(channel,n)).join('\n\n');
    return say({ text:`*Active rotations:*\n${details}`, response_type:'in_channel' });
  }
  if(text){
    // Check if rotation exists (case-insensitive)
    const rotations = configStore.get(channel);
    const rotationName = Object.keys(rotations).find(name => name.toLowerCase() === text.toLowerCase());
    
    if(rotationName){
      console.log(`Manual trigger: Starting rotation "${rotationName}" in channel ${channel}`);
      await say({ text:`Starting rotation *${rotationName}*...`, response_type:'in_channel'});
      return startPick(channel, rotationName, client);
    }
    
    // If rotation doesn't exist, open modal to create it
    return openNewRotationModal(client,body.trigger_id,channel,text);
  }
  await openSelectModal(client,body.trigger_id,channel);
});

// ─── Handle "New Rotation" button ─────────────────────────────────────────────
app.action('create_new', async ({ack,body,client})=>{
  await ack();
  try {
    const channel = body.view.private_metadata;
    console.log('Creating new rotation for channel:', channel);
    await client.views.push({
      trigger_id: body.trigger_id,
      view: buildNewRotationView(channel)
    });
  } catch (error) {
    console.error('Error handling create_new action:', error);
  }
});

// ─── Handle "Edit" button ─────────────────────────────────────────────────────
app.action('edit_rotation', async ({ack,body,client})=>{
  await ack();
  try {
    const channel = body.view.private_metadata;
    const name = body.actions[0].value;
    console.log('Editing rotation:', name, 'for channel:', channel);
    await client.views.push({
      trigger_id: body.trigger_id,
      view: buildNewRotationView(channel, name)
    });
  } catch (error) {
    console.error('Error handling edit_rotation action:', error);
  }
});

// ─── Handle New Rotation submit ───────────────────────────────────────────────
app.view('cucumber_new', async ({ack,view,client})=>{
  await ack();
  try {
    const metadata = JSON.parse(view.private_metadata);
    const channel = metadata.channel;
    const editingName = metadata.editingName;
    
    const v = view.state.values;
    const name     = v.name_block.name_input.value.trim();
    const members  = v.member_block.members_select.selected_users || [];
    const excludes = v.exclude_block.exclude_select?.selected_users||[];
    const days     = v.schedule_days.days_select.selected_options?.map(o=>o.value) || [];
    const time     = v.schedule_time.time_input.value;
    const tz       = v.schedule_tz.tz_select.selected_option?.value || 'Australia/Melbourne';
    const strategy = v.strategy_block.strategy_select.selected_option?.value || 'roundrobin';
    const retry    = parseInt(v.retry_block.retry_input.value)||1;
    const timeout  = parseInt(v.timeout_block.timeout_input.value)||5;

    const filtered = members.filter(u=>!excludes.includes(u));
    if(strategy==='random') filtered.sort(()=>Math.random()-0.5);

    // If we're editing and the name changed, remove the old entry
    if (editingName && editingName !== name) {
      const oldConfig = configStore.get(channel);
      const oldQueue = queueStore.get(channel);
      delete oldConfig[editingName];
      delete oldQueue[editingName];
      configStore.data[channel] = oldConfig;
      queueStore.data[channel] = oldQueue;
      configStore._save();
      queueStore._save();
    }

    configStore.setItem(channel,name,{days,time,tz,strategy,retry,timeout});
    queueStore.setItem(channel,name,filtered);

    await ensureBotInChannel(client,channel);
    await client.chat.postMessage({
      channel,
      text:`${editingName ? 'Updated' : 'Saved'} *${name}*: ${filtered.length} members, ${days.join(', ')} @ ${time} (${tz})`
    });

    scheduleAll();
    
    // Only start pick if it's a new rotation, not an edit
    if (!editingName) {
      await startPick(channel,name,client);
    }
  } catch (error) {
    console.error('Error handling cucumber_new view submission:', error);
  }
});

// ─── Accept / Decline / Skip handlers ─────────────────────────────────────────────────
app.action('accept', async ({ack,body,client})=>{
  await ack();
  const {name,user} = JSON.parse(body.actions[0].value);
  const channel = body.channel.id;
  const key = `${channel}:${name}:${user}`;
  
  if(activeTimers[key]) clearTimeout(activeTimers[key]);
  delete activeTimers[key];
  
  // Update the original message
  if (activeMessages[key]) {
    await updateMessageAfterAction(client, channel, activeMessages[key], name, user, 'accept');
    delete activeMessages[key];
  }
  
  await client.chat.postMessage({channel,text:`*${name}*: <@${user}> accepted!`});
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
const scheduledJobs = new Map(); // Track active cron jobs

function scheduleJob(channel, name, cfg) {
  if (!cfg.days || !cfg.time || !cfg.tz) {
    console.log(`Skipping schedule for ${name} - missing config:`, { days: cfg.days, time: cfg.time, tz: cfg.tz });
    return;
  }
  
  const jobKey = `${channel}:${name}`;
  
  // Clear existing job if it exists
  if (scheduledJobs.has(jobKey)) {
    scheduledJobs.get(jobKey).destroy();
    scheduledJobs.delete(jobKey);
  }
  
  try {
    const days = cfg.days.map(d => WEEKDAY_MAP[d]).join(',');
    const [h, m] = cfg.time.split(':').map(Number);
    const cronPattern = `${m} ${h} * * ${days}`;
    
    console.log(`Scheduling ${name} for channel ${channel}:`, {
      pattern: cronPattern,
      timezone: cfg.tz,
      days: cfg.days
    });
    
    const job = new CronJob(
      cronPattern,
      async () => {
        console.log(`CRON triggered: ${name} in channel ${channel}`);
        try {
          await startPick(channel, name, app.client);
        } catch (error) {
          console.error(`Error in scheduled pick for ${name}:`, error);
        }
      },
      null,
      true, // Start immediately
      cfg.tz
    );
    
    scheduledJobs.set(jobKey, job);
    console.log(`✅ Scheduled job created for ${name} - next run:`, job.nextDate().toString());
    
  } catch (error) {
    console.error(`Error creating cron job for ${name}:`, error);
  }
}

function scheduleAll() {
  console.log('Scheduling all rotations...');
  
  // Clear all existing jobs
  scheduledJobs.forEach((job, key) => {
    job.destroy();
  });
  scheduledJobs.clear();
  
  // Schedule all rotations
  Object.keys(configStore.data).forEach(ch => {
    Object.keys(configStore.data[ch]).forEach(n => {
      const cfg = configStore.getItem(ch, n);
      if (cfg) {
        scheduleJob(ch, n, cfg);
      }
    });
  });
  
  console.log(`Total scheduled jobs: ${scheduledJobs.size}`);
}

// ─── Start app ────────────────────────────────────────────────────────────────
(async()=>{
  await app.start();
  console.log('⚡️ Cucumber Bot running with edit support!');
  scheduleAll();
})();