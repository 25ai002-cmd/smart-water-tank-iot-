// =====================================================
//  backend/notifications.js — Web Push Helper
//  IoT Smart Water Tank Monitor — Semester 3 Project
//
//  Manages VAPID keys and sends Web Push notifications
//  to subscribed browser clients.
// =====================================================

const webpush  = require('web-push');
const fs       = require('fs');
const path     = require('path');

const KEYS_PATH = path.join(__dirname, 'vapid-keys.json');

/* ──────────────────────────────────────────────────
   VAPID KEY MANAGEMENT
   Keys are generated once and persisted to disk.
   ────────────────────────────────────────────────── */

function loadOrGenerateVapidKeys() {
  if (fs.existsSync(KEYS_PATH)) {
    try {
      const keys = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
      if (keys.publicKey && keys.privateKey) {
        console.log('[Push] Loaded VAPID keys from vapid-keys.json');
        return keys;
      }
    } catch {
      console.warn('[Push] vapid-keys.json corrupt — regenerating.');
    }
  }

  // Generate new keys
  const keys = webpush.generateVAPIDKeys();
  fs.writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2), 'utf8');
  console.log('[Push] Generated new VAPID keys → vapid-keys.json');
  return keys;
}

const vapidKeys = loadOrGenerateVapidKeys();

webpush.setVapidDetails(
  'mailto:iot-watertank@project.local',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

/* ──────────────────────────────────────────────────
   SEND HELPERS
   ────────────────────────────────────────────────── */

/**
 * Send a push notification to a single subscription.
 * @param {object} subscription — PushSubscription object from browser
 * @param {object} payload      — { title, body, icon, tag, data }
 * @returns {Promise<boolean>}  — true if sent successfully
 */
async function sendNotification(subscription, payload) {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription expired or unsubscribed — caller should remove it
      return 'expired';
    }
    console.error('[Push] Send error:', err.message);
    return false;
  }
}

/**
 * Broadcast a push notification to all stored subscriptions.
 * Automatically removes expired subscriptions and returns the cleaned list.
 * @param {Array}  subscriptions — array of PushSubscription objects from db
 * @param {object} payload       — { title, body, icon, tag, data }
 * @returns {Promise<Array>}     — updated (valid) subscriptions array
 */
async function sendToAll(subscriptions, payload) {
  if (!subscriptions || subscriptions.length === 0) return subscriptions;

  const results = await Promise.all(
    subscriptions.map(sub => sendNotification(sub, payload))
  );

  // Filter out expired subscriptions
  const valid = subscriptions.filter((_, i) => results[i] !== 'expired');
  if (valid.length < subscriptions.length) {
    console.log(`[Push] Removed ${subscriptions.length - valid.length} expired subscription(s).`);
  }

  return valid;
}

const https = require('https');

const DEFAULT_PUSHOVER_API_TOKEN = 'amec2ekb4b2x69g9nidq98qfszr5r6';
const DEFAULT_PUSHOVER_USER_KEY  = 'ukbbgtkotfge6biu7168zw8oiiwds9';

/**
 * Send native push notification via Pushover API to iOS & Android devices.
 * Supports custom loud siren sounds and high-priority lockscreen popups.
 * @param {object} opts — { title, message, sound, priority, token, user }
 */
async function sendPushover({ title, message, sound, priority, token, user }) {
  const apiToken = token || process.env.PUSHOVER_API_TOKEN || DEFAULT_PUSHOVER_API_TOKEN;
  const userKey  = user  || process.env.PUSHOVER_USER_KEY  || DEFAULT_PUSHOVER_USER_KEY;

  if (!apiToken || !userKey) {
    return false; // Pushover not configured
  }

  const postData = new URLSearchParams({
    token: apiToken,
    user: userKey,
    title: title || '💧 AquaMonitor Alert',
    message: message || 'Water tank alert triggered.',
    sound: sound || 'siren', // Options: siren, falling, spacealarm, pushover, persistent
    priority: priority !== undefined ? String(priority) : '1', // 1 = high priority bypasses silent mode
  }).toString();

  return new Promise((resolve) => {
    const req = https.request('https://api.pushover.net/1/messages.json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      }
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`[Pushover] 📱 Native push sent to phone: "${title}" (${sound || 'siren'})`);
          resolve(true);
        } else {
          console.warn(`[Pushover] ⚠️ API response status ${res.statusCode}:`, data);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.warn('[Pushover] ⚠️ Request error:', err.message);
      resolve(false);
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  vapidPublicKey: vapidKeys.publicKey,
  sendNotification,
  sendToAll,
  sendPushover,
};
