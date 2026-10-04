// =====================================================
//  backend/server.js — Express REST API Server
//  IoT Smart Water Tank Monitor — Semester 3 Project
//
//  Run with:  node backend/server.js   (from IOT folder)
//             OR double-click START SERVER.bat
//
//  Dashboard: http://localhost:3000
//  Swagger:   http://localhost:3000/api-docs
// =====================================================

const express    = require('express');
const cors       = require('cors');
const fs         = require('fs');
const path       = require('path');
const http       = require('http');
const https      = require('https');
const os         = require('os');
const { Server } = require('socket.io');
const swaggerUi  = require('swagger-ui-express');
const swaggerDef = require('./swagger');
const push       = require('./notifications');
const localtunnel = require('localtunnel');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
const PORT   = process.env.PORT || 3000;

let publicTunnelUrl = null;
let publicIp = null;

process.on('uncaughtException', (err) => {
  console.warn('[SERVER SAFEGUARD] Uncaught error recovered:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.warn('[SERVER SAFEGUARD] Unhandled promise rejection recovered:', reason);
});

/**
 * Fetch the public IP address for remote access diagnostics.
 */
function fetchPublicIp() {
  return new Promise((resolve) => {
    https.get('https://api.ipify.org?format=json', { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try {
          publicIp = JSON.parse(data).ip;
          resolve(publicIp);
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

/**
 * Initialize secure public HTTPS tunnel for remote access from outside Wi-Fi.
 */
async function initPublicTunnel() {
  try {
    await fetchPublicIp();
    const tunnel = await localtunnel({ port: PORT }).catch(() => null);
    if (!tunnel) return;
    publicTunnelUrl = tunnel.url;

    console.log('\n🌐 ════════════════════════════════════════════════════════════');
    console.log('  REMOTE INTERNET ACCESS (Anywhere / Mobile Data / 4G / 5G):');
    console.log(`  👉  ${publicTunnelUrl}`);
    if (publicIp) {
      console.log(`  🔑  Tunnel Password (if prompted on first phone visit): ${publicIp}`);
    }
    console.log('════════════════════════════════════════════════════════════════\n');

    tunnel.on('close', () => {
      publicTunnelUrl = null;
    });

    tunnel.on('error', (err) => {
      console.warn('⚠️ [REMOTE ACCESS] Tunnel notice:', err ? err.message : 'transient');
    });
  } catch (err) {
    console.warn('⚠️ [REMOTE ACCESS] Tunnel unavailable (Render deployment active).');
  }
}

/**
 * Get local IPv4 addresses for network hardware syncing.
 */
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const k in interfaces) {
    for (const net of interfaces[k]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses.length > 0 ? addresses : ['127.0.0.1'];
}

// ── Paths ─────────────────────────────────────────────
const DB_PATH      = path.join(__dirname, 'db.json');
const FRONTEND_DIR = path.join(__dirname, '..');

// ── Tank Configuration ────────────────────────────────
const SENSOR_TOTAL_HEIGHT = 21.0; // Calibrated height: 11.6cm water + 9.4cm air gap = 21.0cm
const TANK_HEIGHT         = 20.0; // 100% full water capacity height (cm)
const MOTOR_ON_THRESHOLD  = 20;
const MOTOR_OFF_THRESHOLD = 90;
const BUZZER_LOW          = 20;
const BUZZER_HIGH         = 90;
const MAX_HISTORY         = 50;
const MAX_NOTIFICATIONS   = 200;


/* ==================================================
   MIDDLEWARE
   ================================================== */
app.use(cors());
app.use(express.json());
app.use(express.static(FRONTEND_DIR));


/* ==================================================
   SWAGGER UI — http://localhost:3000/api-docs
   ================================================== */
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDef, {
  customSiteTitle: 'Water Tank API — Swagger Docs',
  customCss: `
    .swagger-ui .topbar { background-color: #1a3a5c; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .info .title { color: #1a3a5c; }
  `,
}));


/* ==================================================
   SOCKET.IO — Real-time notification broadcasts
   ================================================== */
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

/**
 * Broadcast a notification to all connected clients.
 */
function broadcastNotification(notification) {
  io.emit('notification:new', notification);
}

/**
 * Broadcast unread count update to all connected clients.
 */
function broadcastUnreadCount(count) {
  io.emit('notification:unread_count', { count });
}


/* ==================================================
   DATABASE HELPERS
   ================================================== */
function readDB() {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));

    // Backward-compat: settings
    if (!data.settings) {
      data.settings = {
        motorOnThreshold: 20, motorOffThreshold: 90,
        buzzerLowThreshold: 20, buzzerHighThreshold: 90,
        scheduleEnabled: false, scheduleTime: '05:00',
      };
    }
    if (data.settings.scheduleEnabled === undefined) data.settings.scheduleEnabled = false;
    if (data.settings.scheduleTime    === undefined) data.settings.scheduleTime    = '05:00';

    if (!data.subscriptions) data.subscriptions = [];
    if (!data.pushState)     data.pushState     = { lastAlert: null, stallNotified: false, lastScheduledTrigger: null };
    if (data.pushState.lastScheduledTrigger === undefined) data.pushState.lastScheduledTrigger = null;
    if (!data.motor.onSince) data.motor.onSince = null;
    if (data.motor.sourceEmpty === undefined) data.motor.sourceEmpty = false;

    // Notification store
    if (!data.notifications)      data.notifications      = [];
    if (!data.notificationState)  data.notificationState  = {};
    // Dry-run tracker lives in notificationState
    if (data.notificationState.dryRunTracker === undefined) {
      data.notificationState.dryRunTracker = null;
    }


    return data;
  } catch {
    return {
      sensor: { tankHeight: TANK_HEIGHT, sensorDistance: 5, waterLevel: 15, waterPercentage: 75, timestamp: new Date().toISOString() },
      motor:  { status: false, mode: 'auto', lastChanged: new Date().toISOString(), onSince: null, sourceEmpty: false },
      buzzer: { status: false, lastChanged: new Date().toISOString() },
      settings: { motorOnThreshold: 20, motorOffThreshold: 90, buzzerLowThreshold: 20, buzzerHighThreshold: 90, scheduleEnabled: false, scheduleTime: '05:00' },
      history: [],
      subscriptions: [],
      pushState: { lastAlert: null, stallNotified: false, lastScheduledTrigger: null },
      notifications: [],
      notificationState: {},
    };
  }
}

function writeDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[DB] Write error:', err.message);
  }
}


/* ==================================================
   BUSINESS LOGIC
   ================================================== */
function calculateFromDistance(sensorDistance, settings = {}) {
  const startThreshold = settings.motorOnThreshold  !== undefined ? settings.motorOnThreshold  : 20;
  const stopThreshold  = settings.motorOffThreshold !== undefined ? settings.motorOffThreshold : 90;
  const buzzerLow      = settings.buzzerLowThreshold  !== undefined ? settings.buzzerLowThreshold  : 20;
  const buzzerHigh     = settings.buzzerHighThreshold !== undefined ? settings.buzzerHighThreshold : 90;

  const rawLevel        = SENSOR_TOTAL_HEIGHT - sensorDistance;
  const waterLevel      = +Math.max(0, Math.min(TANK_HEIGHT, rawLevel)).toFixed(1);
  const waterPercentage = +Math.round(Math.max(0, Math.min(100, (waterLevel / TANK_HEIGHT) * 100)));

  const motorOn = waterPercentage <= startThreshold ? true
                : waterPercentage >= stopThreshold ? false
                : null;

  // Buzzer alerts on low water level (< 20%) only; stays SILENT when tank is full and motor stops
  const buzzerOn = waterPercentage < buzzerLow;

  let alertLevel, alertMessage;
  if (waterPercentage < buzzerLow) {
    alertLevel   = 'low';
    alertMessage = 'Tank is almost empty — motor switched ON automatically.';
  } else if (waterPercentage > buzzerHigh) {
    alertLevel   = 'high';
    alertMessage = 'Tank is full — motor switched OFF automatically.';
  } else {
    alertLevel   = 'normal';
    alertMessage = 'Normal water level — system is running fine.';
  }

  return { waterLevel, waterPercentage, motorOn, buzzerOn, alertLevel, alertMessage };
}

function addHistory(db, sensorDistance, waterLevel, waterPercentage, motorOn, buzzerOn) {
  const lastId = db.history.length > 0 ? db.history[db.history.length - 1].id : 0;
  db.history.push({ id: lastId + 1, sensorDistance, waterLevel, waterPercentage, motorOn, buzzerOn, timestamp: new Date().toISOString() });
  if (db.history.length > MAX_HISTORY) db.history = db.history.slice(-MAX_HISTORY);
}


/* ==================================================
   SMART NOTIFICATION ENGINE
   ================================================== */

const SERVER_START_TIME = Date.now();
const initialDb = readDB();
let lastSensorTimestamp = null; // Reset to null on server boot — await live sensor telemetry
let lastKnownHardwareConnected = null; // track connection transitions (NodeMCU ESP8266)
let stopConsecutiveHits  = 0;    // debounce counter for motor auto-stop at target threshold

/**
 * Create and store a new notification, then broadcast it.
 * Returns the notification object, or null if it was a duplicate.
 */
function createNotification(db, { type, title, message, priority }) {
  const ns = db.notificationState;

  // Duplicate prevention: check if active (unresolved) notification of same type exists
  if (ns[type] && ns[type].active) {
    return null;
  }

  const newNotif = {
    id:               Date.now(),
    notificationType: type,
    title,
    message,
    priority,        // 'critical' | 'warning' | 'success' | 'info'
    isRead:           false,
    createdAt:        new Date().toISOString(),
    resolvedAt:       null,
  };

  db.notifications.unshift(newNotif);

  // Trim to max
  if (db.notifications.length > MAX_NOTIFICATIONS) {
    db.notifications = db.notifications.slice(0, MAX_NOTIFICATIONS);
  }

  // Mark state as active
  ns[type] = { active: true, since: newNotif.createdAt };

  return newNotif;
}

/**
 * Resolve an active notification type (clear the dedup state).
 */
function resolveNotification(db, type) {
  const ns = db.notificationState;
  if (ns[type] && ns[type].active) {
    // Mark the matching notification as resolved
    const notif = db.notifications.find(n => n.notificationType === type && !n.resolvedAt);
    if (notif) notif.resolvedAt = new Date().toISOString();
    ns[type] = { active: false };
  }
}

/**
 * Core notification evaluation function — called after every sensor POST.
 */
function evaluateNotifications(db, prevPct, currentPct, prevMotor, currentMotor, now) {
  const ns        = db.notificationState || {};
  db.notificationState = ns;
  const generated = [];

  // ── Helper ───────────────────────────────────────────
  function emit(opts) {
    const n = createNotification(db, opts);
    if (n) {
      generated.push(n);
      broadcastNotification(n);
      console.log(`[Notif] ${opts.priority.toUpperCase()}: ${opts.title}`);

      // Dispatch native Pushover lockscreen push notification with custom sounds
      const sound = opts.priority === 'critical' ? 'siren' : (opts.priority === 'warning' ? 'falling' : 'pushover');
      const priority = opts.priority === 'critical' ? 1 : 0;
      push.sendPushover({
        title: opts.title,
        message: opts.message,
        sound: sound,
        priority: priority,
      }).catch(() => {});
    }
  }

  // ── 1. SENSOR ERROR: value out of range ──────────────
  if (currentPct < 0 || currentPct > 100) {
    emit({ type: 'sensor_error', title: '⚠️ Sensor Error', message: 'Water level reading is outside valid range (0–100%). Please check the sensor.', priority: 'critical' });
  } else {
    resolveNotification(db, 'sensor_error');
  }

  // ── 2. SENSOR TIMEOUT: no data for > 30 seconds ──────
  if (lastSensorTimestamp) {
    const secSince = (now - new Date(lastSensorTimestamp).getTime()) / 1000;
    if (secSince > 30) {
      emit({ type: 'sensor_timeout', title: '⚠️ Sensor Timeout', message: 'No sensor data received for more than 30 seconds. Please check the sensor connection.', priority: 'critical' });
    } else {
      resolveNotification(db, 'sensor_timeout');
    }
  }

  // ── 3. TANK EMPTY: level <= 5% ───────────────────────
  if (currentPct <= 5) {
    emit({ type: 'tank_empty', title: '🚨 Tank Almost Empty', message: 'Tank is almost empty. Immediate refill is recommended.', priority: 'critical' });
  } else {
    resolveNotification(db, 'tank_empty');
  }

  // ── 4. LOW WATER: level < 10% ────────────────────────
  if (currentPct > 5 && currentPct < 10) {
    emit({ type: 'low_water', title: '⚠️ Low Water Level', message: 'Water level is below 10%. Please refill the tank soon.', priority: 'warning' });
  } else if (currentPct >= 10) {
    resolveNotification(db, 'low_water');
  }

  // ── 5. TANK FILLED: level reaches 90% ────────────────
  if (prevPct < 90 && currentPct >= 90) {
    emit({ type: 'tank_filled', title: '✅ Tank Filled', message: 'Tank has reached 90% capacity.', priority: 'success' });
  } else if (currentPct < 85) {
    resolveNotification(db, 'tank_filled');
  }

  // ── 6. TANK FULL: level reaches 100% ─────────────────
  if (prevPct < 100 && currentPct >= 100) {
    emit({ type: 'tank_full', title: '✅ Tank Completely Full', message: 'Tank is completely full. Motor has been stopped.', priority: 'success' });
  } else if (currentPct < 95) {
    resolveNotification(db, 'tank_full');
  }

  // ── 7. OVERFLOW RISK: motor ON and level >= 90% ───────
  if (currentMotor && currentPct >= 90) {
    emit({ type: 'overflow_risk', title: '🚨 Overflow Warning', message: 'Tank is above 90% while the motor is still running. Turn OFF the motor immediately.', priority: 'critical' });
  } else {
    resolveNotification(db, 'overflow_risk');
  }

  // ── 8. MOTOR STATE CHANGES ────────────────────────────
  if (!prevMotor && currentMotor) {
    // Motor turned ON
    emit({ type: 'motor_started', title: 'ℹ️ Water Pump Started', message: 'Water pump started successfully.', priority: 'info' });
    resolveNotification(db, 'motor_stopped');
    // Initialize pump_failure / dry_run tracking
    if (!ns.pumpStartedAt) ns.pumpStartedAt = now;
    if (!ns.levelAtPumpStart) ns.levelAtPumpStart = currentPct;
    ns.lastLevelWhileMotorOn = currentPct;
    ns.lastLevelWhileMotorOnTime = now;
  } else if (prevMotor && !currentMotor) {
    // Motor turned OFF
    emit({ type: 'motor_stopped', title: 'ℹ️ Water Pump Stopped', message: 'Water pump stopped successfully.', priority: 'info' });
    resolveNotification(db, 'motor_started');
    resolveNotification(db, 'pump_failure');
    resolveNotification(db, 'dry_run');
    resolveNotification(db, 'overflow_risk');
    // Clear tracking
    ns.pumpStartedAt        = null;
    ns.levelAtPumpStart     = null;
    ns.lastLevelWhileMotorOn     = null;
    ns.lastLevelWhileMotorOnTime = null;
  }

  // ── 9. DRY RUN & RESOURCE EMPTY PROTECTION: motor ON but level not rising ──────────────
  //    Logic:
  //      a. When motor is ON, monitor level changes every reading.
  //      b. If within DRY_RUN_WINDOW_SEC seconds level does not rise >= DRY_RUN_MIN_RISE,
  //         no water is coming from the resource (sump/well/inlet empty).
  //      c. Force motor OFF, engage sourceEmpty lockout, and fire critical alert.
  const DRY_RUN_WINDOW_SEC  = 12;   // 12 seconds with no level increase → resource empty / dry run
  const DRY_RUN_MIN_RISE    = 0.4;  // % rise needed to prove water is flowing into tank

  if (currentMotor) {
    // Init tracker when motor is running
    if (ns.dryRunTracker === null || ns.dryRunTracker === undefined) {
      ns.dryRunTracker = { startLevel: currentPct, startTime: now, peakLevel: currentPct };
    }

    // Check if water is actively rising
    if (currentPct > ns.dryRunTracker.peakLevel) {
      ns.dryRunTracker.peakLevel = currentPct;
      const riseFromStart = currentPct - ns.dryRunTracker.startLevel;
      if (riseFromStart >= DRY_RUN_MIN_RISE) {
        // Water IS flowing from resource into tank — reset tracking window
        ns.dryRunTracker.startTime  = now;
        ns.dryRunTracker.startLevel = currentPct;
        if (db.motor.sourceEmpty || db.motor.probing) {
          db.motor.sourceEmpty = false;
          db.motor.probing = false;
          db.motor.probeStartedAt = null;
          emit({
            type:     'resource_refilled',
            title:    '✅ Resource Refilled — Pumping Water',
            message:  'Water flow confirmed from resource! Pump is now actively filling the tank.',
            priority: 'success',
          });
        }
        db.motor.sourceEmpty = false;
        db.motor.probing = false;
        db.motor.probeStartedAt = null;
        resolveNotification(db, 'source_empty');
        resolveNotification(db, 'pump_failure');
        resolveNotification(db, 'dry_run');
      }
    } else {
      // Check how long level has been stagnant
      const secElapsed = (now - ns.dryRunTracker.startTime) / 1000;
      const rise       = currentPct - ns.dryRunTracker.startLevel;

      if (secElapsed >= DRY_RUN_WINDOW_SEC && rise < DRY_RUN_MIN_RISE) {
        // ── RESOURCE EMPTY & DRY RUN CONFIRMED: force motor OFF & lock out auto-mode ──
        db.motor.status              = false;
        db.motor.mode                = 'manual';   // lock out auto-mode
        db.motor.sourceEmpty         = true;       // flag resource as empty
        db.motor.lastSourceEmptyTime = new Date().toISOString();
        db.motor.onSince             = null;
        db.motor.lastChanged         = new Date().toISOString();

        emit({
          type:     'source_empty',
          title:    '🚨 Resource Empty — Motor Stopped',
          message:  `No water detected in resource! Motor stopped after ${Math.round(secElapsed)}s to prevent dry-run damage. Will auto-retry in 30s to check if refilled.`,
          priority: 'critical',
        });
        emit({
          type:     'dry_run',
          title:    '⚠️ Dry Run Protection Activated',
          message:  'Pump running without water from resource. Motor stopped automatically. Auto-probing in 30 seconds.',
          priority: 'critical',
        });

        // Reset tracker
        ns.dryRunTracker = null;

        console.log('[RESOURCE EMPTY] ⛔ No water in resource! Motor force-stopped. Will auto-probe periodically.');
      }
    }
  } else {
    // Motor is OFF — clear tracker, but keep source_empty active until refilled or reset
    ns.dryRunTracker = null;
    if (!db.motor.sourceEmpty) {
      resolveNotification(db, 'source_empty');
      resolveNotification(db, 'pump_failure');
      resolveNotification(db, 'dry_run');
    }
  }


  // ── 10. RAPID WATER LOSS: level drops > 15% in 5 min ─
  if (!ns.rapidLossTracker) {
    ns.rapidLossTracker = { level: currentPct, time: now };
  } else {
    const minElapsed = (now - new Date(ns.rapidLossTracker.time).getTime()) / 60000;
    if (minElapsed >= 5) {
      const drop = ns.rapidLossTracker.level - currentPct;
      if (drop > 15) {
        emit({ type: 'rapid_water_loss', title: '⚠️ Rapid Water Loss', message: `Water level dropped by ${drop.toFixed(1)}% in 5 minutes. Possible leakage detected.`, priority: 'warning' });
      } else {
        resolveNotification(db, 'rapid_water_loss');
      }
      // Reset the 5-minute window
      ns.rapidLossTracker = { level: currentPct, time: now };
    }
  }

  // Broadcast updated unread count
  const unreadCount = db.notifications.filter(n => !n.isRead).length;
  broadcastUnreadCount(unreadCount);

  return generated;
}


/* ==================================================
   API ROUTES
   ================================================== */

// ── Root ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ── VAPID public key ────────────────────────────────
app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: push.vapidPublicKey });
});

// ── Subscribe / Unsubscribe ─────────────────────────
app.post('/api/subscribe', (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ success: false, error: 'Valid PushSubscription required.' });
  }
  const db = readDB();
  const exists = db.subscriptions.some(s => s.endpoint === subscription.endpoint);
  if (!exists) { db.subscriptions.push(subscription); writeDB(db); }
  res.json({ success: true, message: 'Subscribed to push notifications.' });
});

app.delete('/api/subscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ success: false, error: 'endpoint is required.' });
  const db = readDB();
  db.subscriptions = db.subscriptions.filter(s => s.endpoint !== endpoint);
  writeDB(db);
  res.json({ success: true, message: 'Unsubscribed.' });
});

// ── GET /api/sensor ─────────────────────────────────
app.get('/api/sensor', (req, res) => {
  res.json(readDB().sensor);
});

// ── POST /api/sensor — NodeMCU sends data here ──────
app.post('/api/sensor', (req, res) => {
  const { sensorDistance } = req.body;

  if (sensorDistance === undefined || isNaN(sensorDistance)) {
    return res.status(400).json({ success: false, error: 'sensorDistance (number) is required.' });
  }
  const rawDist  = parseFloat(sensorDistance);
  const dist     = Math.max(0.0, isNaN(rawDist) ? 0.0 : rawDist);
  const db       = readDB();
  const prevPct  = db.sensor.waterPercentage;
  const prevMotor= db.motor.status;
  const settings = db.settings;
  const now      = Date.now();

  // Auto-clear sourceEmpty lockout if water percentage in tank has risen by >= 1.0%
  const currentWaterLevel = +Math.max(0, Math.min(TANK_HEIGHT, SENSOR_TOTAL_HEIGHT - dist)).toFixed(1);
  const currentWaterPct   = +Math.round(Math.max(0, Math.min(100, (currentWaterLevel / TANK_HEIGHT) * 100)));
  if (db.motor.sourceEmpty && currentWaterPct >= prevPct + 1.0) {
    db.motor.sourceEmpty = false;
    resolveNotification(db, 'source_empty');
    resolveNotification(db, 'dry_run');
    console.log('[SOURCE] Water level increased — resource empty lockout cleared.');
  }

  // ── SMART AUTO-RETRY ON RESOURCE REFILL (30 SECONDS) ──────────────
  // If resource was empty and tank is not full, auto-probe every 30s to check if source is refilled
  const RETRY_INTERVAL_MS = 30000;
  const stopThresh = settings.motorOffThreshold !== undefined ? settings.motorOffThreshold : 90;
  let autoProbingNow = false;

  if (db.motor.sourceEmpty && currentWaterPct < stopThresh) {
    const lastEmpty = db.motor.lastSourceEmptyTime ? new Date(db.motor.lastSourceEmptyTime).getTime() : 0;
    if (now - lastEmpty >= RETRY_INTERVAL_MS && !db.motor.status) {
      console.log('[AUTO-RETRY] 🔄 30s elapsed: Auto-starting pump to test if water resource has been refilled...');
      db.motor.status              = true;
      db.motor.mode                = 'auto';
      db.motor.onSince             = new Date().toISOString();
      db.motor.lastSourceEmptyTime = new Date().toISOString();
      if (!db.notificationState) db.notificationState = {};
      db.notificationState.dryRunTracker = { startLevel: currentWaterPct, startTime: now, peakLevel: currentWaterPct };
      autoProbingNow = true;
    }
  }

  let { waterLevel, waterPercentage, motorOn, buzzerOn, alertLevel, alertMessage } =
    calculateFromDistance(dist, settings);

  // 🚨 HARD SAFETY & FAST AUTO-STOP LOGIC (0.5s instant cutoff on threshold detection):
  if (dist <= 2.0 || waterPercentage >= stopThresh) {
    motorOn = false;
    db.motor.status = false;
    db.motor.onSince = null;
    stopConsecutiveHits = 0;
  } else {
    stopConsecutiveHits = 0;
  }

  // 🚨 RESOURCE EMPTY PROTECTION & MOTOR CONTROL:
  if (db.motor.sourceEmpty && !db.motor.status && !autoProbingNow) {
    motorOn = false;
    db.motor.status = false;
    db.motor.onSince = null;
  } else if (db.motor.sourceEmpty && (db.motor.status || autoProbingNow)) {
    // 30s Auto-probe in progress — keep pump running during probe window
    motorOn = true;
    db.motor.status = true;
  } else if (!db.motor.sourceEmpty && motorOn !== null) {
    if (motorOn && !prevMotor) {
      db.motor.onSince = new Date().toISOString();
      db.pushState.stallNotified = false;
    } else if (!motorOn && prevMotor) {
      db.motor.onSince = null;
    }
    db.motor.status      = motorOn;
    db.motor.mode        = 'auto'; // Automatically switch to Auto Mode on threshold trigger
    db.motor.lastChanged = new Date().toISOString();
  }

  // Update sensor data
  db.sensor = {
    tankHeight:      TANK_HEIGHT,
    sensorDistance:  +dist.toFixed(1),
    waterLevel,
    waterPercentage,
    timestamp:       new Date().toISOString(),
  };

  // ── SMART NOTIFICATION ENGINE ─────────────────────
  evaluateNotifications(db, prevPct, waterPercentage, prevMotor, db.motor.status, now);

  // ── DYNAMIC BUZZER LOGIC ────────────────────────────
  // Buzzer activates ONLY when water level is <= dynamic Start Threshold set on Dashboard (e.g. 40%)
  // Buzzer stays 100% SILENT whenever water level is above the decided Start Threshold!
  const startThresh = settings.motorOnThreshold !== undefined ? settings.motorOnThreshold : 20;
  const finalBuzzerOn = (waterPercentage <= startThresh);

  db.buzzer.status      = finalBuzzerOn;
  db.buzzer.lastChanged = new Date().toISOString();

  // ── LEGACY PUSH NOTIFICATIONS ─────────────────────
  if (db.subscriptions.length > 0) {
    const start = settings.motorOnThreshold;
    const stop  = settings.motorOffThreshold;
    let pushPayload = null;

    if (prevPct >= start && waterPercentage < start) {
      pushPayload = {
        tag:  'water-low', title: '💧 Tank Level Low!',
        body: `Water dropped to ${waterPercentage.toFixed(0)}% — motor has been switched ON automatically.`,
        icon: '/icons/icon-192.png', data: { url: '/' },
      };
      db.pushState.lastAlert = 'low';
      db.pushState.stallNotified = false;
    } else if (prevPct <= stop && waterPercentage > stop) {
      pushPayload = {
        tag:  'water-high', title: '🔔 Tank is Full!',
        body: `Water reached ${waterPercentage.toFixed(0)}% — motor has been switched OFF automatically.`,
        icon: '/icons/icon-192.png', data: { url: '/' },
      };
      db.pushState.lastAlert = 'high';
    } else if (db.motor.status && db.motor.onSince && !db.pushState.stallNotified && waterPercentage < start) {
      const minutesOn = (Date.now() - new Date(db.motor.onSince).getTime()) / 60000;
      if (minutesOn >= 10) {
        pushPayload = {
          tag:  'motor-stall', title: '⚠️ Motor Stall Alert!',
          body: `Motor has been running for ${Math.floor(minutesOn)} minutes but water is still at ${waterPercentage.toFixed(0)}%. Pump has been shut down automatically to prevent dry-run damage.`,
          icon: '/icons/icon-192.png', data: { url: '/' },
        };
        db.pushState.stallNotified = true;
        db.motor.status = false;
        db.motor.mode   = 'manual';
        db.motor.sourceEmpty = true;
        db.motor.onSince = null;
        db.motor.lastChanged = new Date().toISOString();
      }
    }

    if (pushPayload) {
      push.sendToAll(db.subscriptions, pushPayload).then(validSubs => {
        if (validSubs.length !== db.subscriptions.length) {
          const freshDb = readDB();
          freshDb.subscriptions = validSubs;
          writeDB(freshDb);
        }
      });
    }
  }
  // ─────────────────────────────────────────────────

  const wasDisconnected = (lastKnownHardwareConnected === false || lastKnownHardwareConnected === null);
  lastKnownHardwareConnected = true;
  lastSensorTimestamp = new Date().toISOString();

  resolveNotification(db, 'node_esp_disconnected');
  resolveNotification(db, 'sensor_timeout');

  if (wasDisconnected) {
    const connNotif = createNotification(db, {
      type:     'node_esp_connected',
      title:    '🟢 Node ESP Connected',
      message:  'NodeMCU ESP8266 connected and syncing sensor data successfully.',
      priority: 'success',
    });
    if (connNotif) {
      broadcastNotification(connNotif);
      broadcastUnreadCount(db.notifications.filter(x => !x.isRead).length);
    }
  }

  writeDB(db);

  // ── ALERT OVERRIDE: resource-empty / dry-run takes highest priority ──────
  if (db.motor.sourceEmpty || (db.notificationState.source_empty && db.notificationState.source_empty.active)) {
    alertLevel   = 'low';
    alertMessage = '🚨 Resource Empty — Motor stopped to prevent dry-run damage. Refill resource tank.';
  } else if (db.notificationState.dry_run && db.notificationState.dry_run.active) {
    alertLevel   = 'low';
    alertMessage = '⚠️ Dry Run Detected — Motor stopped. Check resource water supply.';
  }

  // Broadcast real-time sensor update to connected web clients
  const localIps = getLocalIPs();
  io.emit('sensor:data', {
    sensor: db.sensor,
    motor:  db.motor,
    buzzer: db.buzzer,
    alert:  { level: alertLevel, message: alertMessage },
    hardware: {
      connected: true,
      lastSeen: lastSensorTimestamp,
      secondsAgo: 0,
      serverIps: localIps,
      publicUrl: publicTunnelUrl,
      publicIp: publicIp,
      apiUrl: localIps.map(ip => `http://${ip}:${PORT}/api/sensor`),
    }
  });

  console.log(`[${new Date().toLocaleTimeString()}]  POST /api/sensor  dist=${dist}cm  water=${waterPercentage}%  motor=${db.motor.status ? 'ON' : 'OFF'}  buzzer=${buzzerOn ? 'ON' : 'OFF'}${db.motor.sourceEmpty ? ' [RESOURCE EMPTY LOCK]' : ''}`);

  res.json({
    sensor: db.sensor,
    motor:  db.motor,
    buzzer: db.buzzer,
    alert:  { level: alertLevel, message: alertMessage },
  });
});


// ── GET /api/status ─────────────────────────────────
app.get('/api/status', (req, res) => {
  const db  = readDB();
  const pct = db.sensor.waterPercentage;
  const buzzerLow  = db.settings ? db.settings.buzzerLowThreshold  : 20;
  const buzzerHigh = db.settings ? db.settings.buzzerHighThreshold : 90;

  const localIps = getLocalIPs();
  const lastSeenMs = lastSensorTimestamp ? new Date(lastSensorTimestamp).getTime() : null;
  const secAgo = lastSeenMs ? Math.floor((Date.now() - lastSeenMs) / 1000) : null;
  const hardwareConnected = lastSeenMs ? (secAgo <= 45) : ((Date.now() - SERVER_START_TIME) < 60000);

  let alertLevel, alertMessage;
  if (!hardwareConnected) {
    alertLevel   = 'critical';
    alertMessage = 'Node ESP is not connected — No data received from NodeMCU ESP8266. Check power and Wi-Fi connection.';
  } else if (db.motor.sourceEmpty || (db.notificationState.source_empty && db.notificationState.source_empty.active)) {
    alertLevel   = 'low';
    alertMessage = '🚨 Resource Empty — Motor stopped to prevent dry-run damage. Refill resource tank.';
  } else if (pct < buzzerLow) {
    alertLevel = 'low';    alertMessage = 'Tank is almost empty — motor switched ON automatically.';
  } else if (pct > buzzerHigh) {
    alertLevel = 'high';   alertMessage = 'Tank is full — motor switched OFF automatically.';
  } else {
    alertLevel = 'normal'; alertMessage = 'Normal water level — system is running fine.';
  }

  const unreadCount = db.notifications.filter(n => !n.isRead).length;

  res.json({
    sensor: db.sensor,
    motor: db.motor,
    buzzer: db.buzzer,
    settings: db.settings,
    alert: { level: alertLevel, message: alertMessage },
    unreadNotifications: unreadCount,
    hardware: {
      connected: hardwareConnected,
      lastSeen: lastSensorTimestamp,
      secondsAgo: secAgo,
      serverIps: localIps,
      publicUrl: publicTunnelUrl,
      publicIp: publicIp,
      apiUrl: localIps.map(ip => `http://${ip}:${PORT}/api/sensor`),
    }
  });
});


// ── GET /api/motor ──────────────────────────────────
app.get('/api/motor', (req, res) => { res.json(readDB().motor); });

// ── POST /api/motor ─────────────────────────────────
app.post('/api/motor', (req, res) => {
  const { status, mode } = req.body;
  if (status === undefined || typeof status !== 'boolean') {
    return res.status(400).json({ success: false, error: 'status (boolean) is required.' });
  }
  const db = readDB();
  const prevMotor = db.motor.status;

  // When manually turning pump ON, clear sourceEmpty lockout so user can test pump after refilling resource
  if (status) {
    db.motor.sourceEmpty = false;
    resolveNotification(db, 'source_empty');
    resolveNotification(db, 'dry_run');
    if (db.notificationState) db.notificationState.dryRunTracker = null;
    db.motor.onSince = new Date().toISOString();
  } else {
    db.motor.onSince = null;
  }

  db.motor.status      = status;
  db.motor.mode        = mode === 'auto' ? 'auto' : 'manual';
  db.motor.lastChanged = new Date().toISOString();
  writeDB(db);

  // Emit motor state change notifications
  const now = Date.now();
  evaluateNotifications(db, db.sensor.waterPercentage, db.sensor.waterPercentage, prevMotor, status, now);
  writeDB(db);

  console.log(`[${new Date().toLocaleTimeString()}]  Motor → ${status ? 'ON' : 'OFF'} (${db.motor.mode})`);
  res.json(db.motor);
});


// ── POST /api/motor/reset-source ────────────────────────
// Clears the Resource Empty lockout immediately when user refills the resource tank
app.post(['/api/motor/reset-source', '/api/reset-source'], (req, res) => {
  const db = readDB();
  db.motor.sourceEmpty = false;
  db.motor.lastSourceEmptyTime = null;
  db.motor.mode = 'auto';

  resolveNotification(db, 'source_empty');
  resolveNotification(db, 'dry_run');
  if (db.notificationState) {
    db.notificationState.dryRunTracker = null;
  }

  // If tank is not full, auto-start motor
  const pct = db.sensor ? db.sensor.waterPercentage : 0;
  const stopThresh = db.settings && db.settings.motorOffThreshold ? db.settings.motorOffThreshold : 90;
  if (pct < stopThresh) {
    db.motor.status = true;
    db.motor.onSince = new Date().toISOString();
  }

  db.motor.lastChanged = new Date().toISOString();
  writeDB(db);

  const localIps = getLocalIPs();
  io.emit('sensor:data', {
    sensor: db.sensor,
    motor:  db.motor,
    buzzer: db.buzzer,
    alert:  { level: 'normal', message: 'Resource refilled — pump resumed.' },
    hardware: {
      connected: lastSensorTimestamp ? ((Date.now() - new Date(lastSensorTimestamp).getTime()) / 1000 <= 15) : false,
      lastSeen: lastSensorTimestamp,
      secondsAgo: 0,
      serverIps: localIps,
      publicUrl: publicTunnelUrl,
      publicIp: publicIp,
      apiUrl: localIps.map(ip => `http://${ip}:${PORT}/api/sensor`),
    }
  });

  console.log('[SOURCE] ✅ User reset resource empty lockout. Pump resumed.');
  res.json({ success: true, motor: db.motor });
});

// ── GET /api/buzzer ─────────────────────────────────
app.get('/api/buzzer', (req, res) => { res.json(readDB().buzzer); });


// ── GET /api/settings ───────────────────────────────
app.get('/api/settings', (req, res) => { res.json(readDB().settings); });

// ── POST /api/settings ──────────────────────────────
app.post('/api/settings', (req, res) => {
  const { motorOnThreshold, motorOffThreshold, scheduleEnabled, scheduleTime } = req.body;
  const db = readDB();
  let start = db.settings.motorOnThreshold;
  let stop  = db.settings.motorOffThreshold;

  if (motorOnThreshold !== undefined) {
    if (isNaN(motorOnThreshold)) return res.status(400).json({ success: false, error: 'motorOnThreshold must be a number.' });
    start = parseInt(motorOnThreshold, 10);
    if (start < 10 || start > 50) return res.status(400).json({ success: false, error: 'Start threshold must be between 10% and 50%.' });
  }
  if (motorOffThreshold !== undefined) {
    if (isNaN(motorOffThreshold)) return res.status(400).json({ success: false, error: 'motorOffThreshold must be a number.' });
    stop = parseInt(motorOffThreshold, 10);
    if (stop > 90) return res.status(400).json({ success: false, error: 'Stop threshold cannot exceed 90%! Setting above 90% will submerge or damage the ultrasonic sensor.' });
    if (stop < 51) return res.status(400).json({ success: false, error: 'Stop threshold must be between 51% and 90%.' });
  }
  if (start >= stop) return res.status(400).json({ success: false, error: 'Start threshold must be less than Stop threshold.' });

  db.settings.motorOnThreshold   = start;
  db.settings.motorOffThreshold  = stop;
  db.settings.buzzerLowThreshold  = start;
  db.settings.buzzerHighThreshold = stop;

  if (scheduleEnabled !== undefined) db.settings.scheduleEnabled = !!scheduleEnabled;
  if (scheduleTime    !== undefined) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduleTime)) return res.status(400).json({ success: false, error: 'scheduleTime must be HH:MM.' });
    db.settings.scheduleTime = scheduleTime;
  }

  writeDB(db);
  res.json({ success: true, settings: db.settings });
});


// ── GET /api/history ────────────────────────────────
app.get('/api/history', (req, res) => {
  const db    = readDB();
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const data  = [...db.history].reverse().slice(0, limit);
  res.json({ count: data.length, data });
});

// ── DELETE /api/history ─────────────────────────────
app.delete('/api/history', (req, res) => {
  const db = readDB();
  db.history = [];
  writeDB(db);
  res.json({ success: true, message: 'History cleared.' });
});


/* ==================================================
   NOTIFICATION API ROUTES
   ================================================== */

// ── GET /api/notifications ──────────────────────────
//  Query params: page, limit, type, priority, search, sort, unreadOnly
app.get('/api/notifications', (req, res) => {
  const db = readDB();
  let items = [...db.notifications];

  // Filter by type
  if (req.query.type && req.query.type !== 'all') {
    items = items.filter(n => n.priority === req.query.type);
  }

  // Search
  if (req.query.search) {
    const q = req.query.search.toLowerCase();
    items = items.filter(n =>
      n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q)
    );
  }

  // Unread only
  if (req.query.unreadOnly === 'true') {
    items = items.filter(n => !n.isRead);
  }

  // Sort
  if (req.query.sort === 'oldest') {
    items = items.reverse();
  }

  const total = items.length;
  const unread = db.notifications.filter(n => !n.isRead).length;

  // Pagination
  const page  = Math.max(1, parseInt(req.query.page)  || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const start = (page - 1) * limit;
  const data  = items.slice(start, start + limit);

  res.json({ total, unread, page, limit, totalPages: Math.ceil(total / limit), data });
});

// ── POST /api/notifications/:id/read ───────────────
app.post('/api/notifications/:id/read', (req, res) => {
  const db  = readDB();
  const id  = parseInt(req.params.id);
  const notif = db.notifications.find(n => n.id === id);
  if (!notif) return res.status(404).json({ success: false, error: 'Notification not found.' });
  notif.isRead = true;
  const unread = db.notifications.filter(n => !n.isRead).length;
  writeDB(db);
  broadcastUnreadCount(unread);
  res.json({ success: true, unread });
});

// ── POST /api/notifications/read-all ───────────────
app.post('/api/notifications/read-all', (req, res) => {
  const db = readDB();
  db.notifications.forEach(n => { n.isRead = true; });
  writeDB(db);
  broadcastUnreadCount(0);
  res.json({ success: true, unread: 0 });
});

// ── DELETE /api/notifications/:id ──────────────────
app.delete('/api/notifications/:id', (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  const idx = db.notifications.findIndex(n => n.id === id);
  if (idx === -1) return res.status(404).json({ success: false, error: 'Notification not found.' });
  db.notifications.splice(idx, 1);
  const unread = db.notifications.filter(n => !n.isRead).length;
  writeDB(db);
  broadcastUnreadCount(unread);
  res.json({ success: true, unread });
});

// ── DELETE /api/notifications ───────────────────────
app.delete('/api/notifications', (req, res) => {
  const db = readDB();
  db.notifications     = [];
  db.notificationState = {};
  writeDB(db);
  broadcastUnreadCount(0);
  res.json({ success: true, message: 'All notifications cleared.' });
});


// ── 404 handler ─────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route '${req.method} ${req.path}' not found. See /api-docs for all endpoints.` });
});


/* ==================================================
   DAILY SCHEDULE CHECKER
   ================================================== */
setInterval(() => {
  const db = readDB();
  if (!db.settings.scheduleEnabled || !db.settings.scheduleTime) return;

  const now  = new Date();
  const hh   = String(now.getHours()).padStart(2, '0');
  const mm   = String(now.getMinutes()).padStart(2, '0');
  const todayStr   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  if (`${hh}:${mm}` === db.settings.scheduleTime) {
    if (!db.pushState.lastScheduledTrigger || db.pushState.lastScheduledTrigger !== todayStr) {
      db.pushState.lastScheduledTrigger = todayStr;
      if (db.motor.sourceEmpty) {
        console.log(`[Schedule] Skipped daily schedule motor start — resource is empty!`);
        writeDB(db);
        return;
      }
      db.motor.status  = true;
      db.motor.mode    = 'auto';
      db.motor.onSince = new Date().toISOString();
      db.motor.lastChanged = new Date().toISOString();
      writeDB(db);
      console.log(`[Schedule] Motor turned ON via Daily Schedule.`);

      if (db.subscriptions.length > 0) {
        push.sendToAll(db.subscriptions, {
          tag: 'schedule-trigger', title: '📅 Daily Fresh Water Starting!',
          body: `It is ${db.settings.scheduleTime}. Starting the pump to fill the tank.`,
          icon: '/icons/icon-192.png', data: { url: '/' },
        }).then(validSubs => {
          if (validSubs.length !== db.subscriptions.length) {
            const freshDb = readDB();
            freshDb.subscriptions = validSubs;
            writeDB(freshDb);
          }
        }).catch(err => console.error('[Push] Schedule notification failed:', err));
      }
    }
  }
}, 30000);


/* ==================================================
   NODE ESP & SENSOR TIMEOUT CHECKER (every 3 seconds)
   ================================================== */
setInterval(() => {
  const now = Date.now();
  const lastSeenMs = lastSensorTimestamp ? new Date(lastSensorTimestamp).getTime() : null;
  const secSince = lastSeenMs ? (now - lastSeenMs) / 1000 : Infinity;
  const isConnected = lastSeenMs ? (secSince <= 45) : (now - SERVER_START_TIME < 45000);

  const db = readDB();

  if (!isConnected && (now - SERVER_START_TIME >= 45000)) {
    const n = createNotification(db, {
      type:     'node_esp_disconnected',
      title:    '⚠️ Node ESP Not Connected',
      message:  lastSensorTimestamp
        ? `NodeMCU ESP8266 is not connected! No sensor data received for ${Math.round(secSince)}s. Check ESP power and Wi-Fi connection.`
        : 'NodeMCU ESP8266 is not connected. Awaiting sensor data from hardware.',
      priority: 'critical',
    });
    if (n) {
      broadcastNotification(n);
      broadcastUnreadCount(db.notifications.filter(x => !x.isRead).length);
      writeDB(db);
    }

    if (lastKnownHardwareConnected !== false) {
      lastKnownHardwareConnected = false;
      const localIps = getLocalIPs();
      io.emit('hardware:status', {
        connected: false,
        lastSeen: lastSensorTimestamp,
        secondsAgo: lastSeenMs ? Math.round(secSince) : null,
        message: 'Node ESP is not connected',
        serverIps: localIps,
      });
      io.emit('alert:update', {
        level: 'critical',
        message: 'Node ESP is not connected — No data received from NodeMCU ESP8266. Check power and Wi-Fi connection.',
      });
    }
  }
}, 3000);


/* ==================================================
   30-SECOND DRY-RUN AUTO-PROBE & RECOVERY TIMER (every 1 second)
   ================================================== */
const DRY_RUN_COOLDOWN_MS = 30000; // 30 seconds cooldown before auto-testing refilled water
const PROBE_WINDOW_MS     = 12000; // 12 seconds test window to detect water rise

setInterval(() => {
  const db = readDB();
  if (!db.motor || !db.motor.sourceEmpty) return;

  const now = Date.now();
  const lastEmpty = db.motor.lastSourceEmptyTime ? new Date(db.motor.lastSourceEmptyTime).getTime() : now;
  const elapsed = now - lastEmpty;
  const stopThresh = db.settings && db.settings.motorOffThreshold ? db.settings.motorOffThreshold : 90;
  const currentPct = db.sensor ? db.sensor.waterPercentage : 0;

  // If tank is already full, clear sourceEmpty
  if (currentPct >= stopThresh) {
    db.motor.sourceEmpty = false;
    db.motor.probing = false;
    db.motor.status = false;
    writeDB(db);
    return;
  }

  if (!db.motor.status && elapsed >= DRY_RUN_COOLDOWN_MS) {
    // ── 30s COOLDOWN ELAPSED: Auto-start pump to probe resource ──
    console.log('[AUTO-PROBE] 🔄 30 seconds elapsed since dry-run! Starting pump to check if resource has refilled...');
    db.motor.status = true;
    db.motor.mode = 'auto';
    db.motor.probing = true;
    db.motor.probeStartedAt = new Date().toISOString();
    db.motor.onSince = new Date().toISOString();
    if (!db.notificationState) db.notificationState = {};
    db.notificationState.dryRunTracker = { startLevel: currentPct, startTime: now, peakLevel: currentPct };
    writeDB(db);

    const localIps = getLocalIPs();
    io.emit('sensor:data', {
      sensor: db.sensor,
      motor:  db.motor,
      buzzer: db.buzzer,
      alert:  { level: 'low', message: '🔄 Testing resource — pump started for 12s to check if refilled...' },
      hardware: {
        connected: lastSensorTimestamp ? ((Date.now() - new Date(lastSensorTimestamp).getTime()) / 1000 <= 15) : false,
        lastSeen: lastSensorTimestamp,
        secondsAgo: 0,
        serverIps: localIps,
      }
    });
  } else if (db.motor.status && db.motor.probing) {
    // ── PROBING ACTIVE: check if probe window has timed out without water rise ──
    const probeStart = db.motor.probeStartedAt ? new Date(db.motor.probeStartedAt).getTime() : now;
    const probeElapsed = now - probeStart;

    if (probeElapsed >= PROBE_WINDOW_MS) {
      console.log('[AUTO-PROBE] ⛔ Resource still empty after 12s test! Stopping pump. Next auto-check in 30s.');
      db.motor.status = false;
      db.motor.probing = false;
      db.motor.probeStartedAt = null;
      db.motor.lastSourceEmptyTime = new Date().toISOString();
      db.motor.onSince = null;
      if (db.notificationState) db.notificationState.dryRunTracker = null;
      writeDB(db);

      const localIps = getLocalIPs();
      io.emit('sensor:data', {
        sensor: db.sensor,
        motor:  db.motor,
        buzzer: db.buzzer,
        alert:  { level: 'low', message: '🚨 Resource Still Empty — Motor stopped after 12s dry test. Next auto-check in 30s.' },
        hardware: {
          connected: lastSensorTimestamp ? ((Date.now() - new Date(lastSensorTimestamp).getTime()) / 1000 <= 15) : false,
          lastSeen: lastSensorTimestamp,
          secondsAgo: 0,
          serverIps: localIps,
        }
      });
    }
  }
}, 1000);


/* ==================================================
   START SERVER
   ================================================== */
server.listen(PORT, '0.0.0.0', () => {
  const localIps = getLocalIPs();

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  💧  Smart Water Tank Monitor — Server Started               ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  🏠  Local (this PC) →  http://localhost:${PORT}                 ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  📶  LOCAL WI-FI (Devices on the SAME Wi-Fi network):        ║');
  localIps.forEach(ip => {
    const urlStr = `  👉  http://${ip}:${PORT}`;
    console.log(`║${urlStr.padEnd(62)}║`);
  });
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log('║  🔧  HARDWARE SYNC — NodeMCU .ino (SERVER_URL):              ║');
  localIps.forEach(ip => {
    const urlStr = `  ➡   http://${ip}:${PORT}/api/sensor`;
    console.log(`║${urlStr.padEnd(62)}║`);
  });
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Swagger API Docs →  http://localhost:${PORT}/api-docs           ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Start public internet tunnel for remote phone access when running locally
  if (!process.env.RENDER) {
    initPublicTunnel();
  } else if (process.env.RENDER_EXTERNAL_URL) {
    publicTunnelUrl = process.env.RENDER_EXTERNAL_URL;
  }

  console.log('  Press Ctrl+C to stop the server.\n');
});
