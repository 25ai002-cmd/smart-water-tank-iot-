/*
 * ============================================================
 *  Smart Water Tank Monitor — NodeMCU ESP8266
 *  File    : WaterTankMonitoring.ino
 *  Project : IoT Based Smart Water Tank Monitoring & Control
 *  Subject : Internet of Things — Semester 3
 * ============================================================
 *
 *  WIRING SUMMARY
 *  ──────────────
 *  HC-SR04 VCC  → NodeMCU 3V
 *  HC-SR04 GND  → NodeMCU G
 *  HC-SR04 TRIG → NodeMCU D5 (GPIO14)
 *  HC-SR04 ECHO → NodeMCU D6 (GPIO12)
 *  Relay    VCC  → NodeMCU VIN (5V)
 *  Relay    GND  → NodeMCU G
 *  Relay    IN   → NodeMCU D2 (GPIO4)
 *  Buzzer   +    → NodeMCU D1 (GPIO5)
 *  Buzzer   -    → NodeMCU G
 *
 *  QUICK START GUIDE:
 *  ──────────────────
 *  1. Open command prompt on your PC and run "START SERVER.bat".
 *     It will show your PC's IP address (e.g. 192.168.1.15).
 *  2. Update WIFI_SSID, WIFI_PASS, and SERVER_URL below.
 *  3. In Arduino IDE select Board: "NodeMCU 1.0 (ESP-12E Module)".
 *  4. Set Serial Monitor baud rate to 115200.
 * ============================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266WiFiMulti.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

/* ===========================================================
   STEP 1 — NETWORK CONFIGURATION (MULTI-WIFI AUTO CONNECT)
   =========================================================== */

// Register all your Wi-Fi networks here.
// NodeMCU will automatically connect to whichever one is available!
ESP8266WiFiMulti wifiMulti;

void registerWiFiNetworks() {
  wifiMulti.addAP("Redmi 12 5G", "Mahesh14");  // Phone Hotspot 1
  wifiMulti.addAP("MMSY 4G",     "14192007");  // Phone Hotspot 2
  // Add more networks as needed:
  // wifiMulti.addAP("Home_WiFi_Name", "Home_WiFi_Password");
  // wifiMulti.addAP("College_WiFi",   "College_Password");
}

// Server Target URLs (Dual-Sync: Cloud + Local Laptop)
// 1. Render Cloud Server (Accessible from anywhere via mobile data / internet)
const String CLOUD_SERVER_URL = "https://smart-water-tank-iot.onrender.com/api/sensor";

// 2. Local PC Server (Set empty to route directly to Cloud Render with 0 delay)
const String LOCAL_SERVER_URL = "";

// ── PUSHOVER NATIVE NOTIFICATIONS CONFIGURATION ─────────────
const char* PUSHOVER_API_TOKEN = "amec2ekb4b2x69g9nidq98qfszr5r6";
const char* PUSHOVER_USER_KEY  = "ukbbgtkotfge6biu7168zw8oiiwds9";

/* ===========================================================
   STEP 2 — HARDWARE CONFIGURATION
   =========================================================== */

// Pin Definitions
#define TRIG_PIN    D5   // HC-SR04 Trigger pin → NodeMCU D5
#define ECHO_PIN    D6   // HC-SR04 Echo pin    → NodeMCU D6
#define RELAY_PIN   D2   // Relay IN pin        → NodeMCU D2
#define BUZZER_PIN  D1   // Buzzer positive (+) → NodeMCU D1
#define LED_PIN     LED_BUILTIN // Built-in LED on NodeMCU (GPIO2)

// Relay Module Type:
// Set to true for Active-LOW relay modules (LOW = Relay ON, HIGH = Relay OFF)
// Set to false for Active-HIGH relay modules (HIGH = Relay ON, LOW = Relay OFF)
#define RELAY_ACTIVE_LOW true

// Sensor total mounting height from bottom of tank in centimeters
const float SENSOR_TOTAL_HEIGHT = 21.0;

// Tank maximum full water capacity height in centimeters (100% full)
const float TANK_HEIGHT = 20.0;

// How often to read sensor and send data to server (milliseconds)
const unsigned long SEND_INTERVAL = 800; // 0.8 seconds (ultra-fast real-time response)

/* ===========================================================
   GLOBAL VARIABLES — do not change
   =========================================================== */

unsigned long     lastSendTime = 0;
WiFiClient        wifiClient;
WiFiClientSecure  secureClient;

// Offline autonomous dry-run & 30s auto-retest tracker
bool          offlineMotorStatus = false;
bool          offlineSourceEmpty = false;
unsigned long offlineMotorStartTime = 0;
unsigned long offlineLastEmptyTime = 0;
float         offlineStartWaterPct = -1.0;
float         lastSmoothedDistance = -1.0;
float         lastReportedDistance = -1.0;


/* ===========================================================
   SETUP — Runs once on power up / reset
   =========================================================== */

void setup() {
  Serial.begin(115200);
  delay(200);

  // Enable hardware watchdog timer to prevent lockups
  ESP.wdtEnable(8000); // 8-second hardware watchdog

  Serial.println("\n\n========================================");
  Serial.println("  💧 AquaMonitor NodeMCU ESP8266 Started ");
  Serial.println("  🔋 24/7 Continuous USB Power Mode Active ");
  Serial.println("========================================\n");

  // Configure pin modes
  pinMode(TRIG_PIN,   OUTPUT);
  pinMode(ECHO_PIN,   INPUT);
  pinMode(RELAY_PIN,  OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN,    OUTPUT);

  // Initial actuator states (OFF)
  setRelayState(false);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, HIGH); // Off for ESP8266 built-in LED (inverted logic)

  // Configure Wi-Fi stack for 24/7 resilience (auto-reconnect without flash wear)
  WiFi.persistent(false);
  WiFi.setAutoReconnect(true);
  WiFi.setAutoConnect(true);

  // Configure SSL buffer limits to allow modern Cloudflare/Render TLS cert chains
  secureClient.setBufferSizes(2048, 1024);

  // Configure Multi-WiFi and Connect
  registerWiFiNetworks();
  connectWiFi();
}

/* ===========================================================
   LOOP — Runs continuously 24/7 until physical power cut
   =========================================================== */

void loop() {
  ESP.wdtFeed(); // Feed watchdog timer on every single iteration
  unsigned long now = millis();

  // Run at specified send interval (every 3 seconds)
  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;

    // 1. Measure distance using ultrasonic sensor (runs 100% locally)
    float distance = measureDistance();

    // If measurement failed temporarily, fallback to last known distance to maintain telemetry heartbeat
    if (distance <= 0) {
      if (lastReportedDistance > 0) {
        distance = lastReportedDistance;
      } else {
        distance = 15.0f; // Safe baseline distance if no previous reading exists
      }
      Serial.println("[WARN] Sensor echo missed. Using fallback distance for keepalive telemetry.");
    }

    // 🚨 EMERGENCY HARDWARE FAILSAFE: If water gets within 2.0cm of sensor eyes, CUT OFF RELAY IMMEDIATELY!
    if (distance > 0 && distance <= 2.0) {
      Serial.println("[SAFETY EMERGENCY] Water within 2cm of sensor! Cutting off relay immediately to prevent sensor water damage!");
      setRelayState(false);
    }

    // 2. Calculate water height & percentage
    float waterLevel = constrain(SENSOR_TOTAL_HEIGHT - distance, 0.0f, TANK_HEIGHT);
    float waterPct   = constrain((waterLevel / TANK_HEIGHT) * 100.0f, 0.0f, 100.0f);

    // 3. Print sensor telemetry to Serial
    printReadings(distance, waterLevel, waterPct);

    // ── LOCAL AUTONOMOUS CONTROL (Instant Hardware Response) ──
    if (waterPct <= 20.0f) {
      setRelayState(true);
      digitalWrite(BUZZER_PIN, HIGH);
    } else if (waterPct >= 90.0f || distance <= 2.5f) {
      setRelayState(false);
      digitalWrite(BUZZER_PIN, LOW);
    } else {
      digitalWrite(BUZZER_PIN, LOW);
    }

    // 4. Check Wi-Fi state & sync
    if (wifiMulti.run() == WL_CONNECTED) {
      digitalWrite(LED_PIN, LOW); // Solid ON when connected
      sendToServer(distance);
    } else {
      // Wi-Fi offline — auto-reconnecting in background while maintaining local tank protection
      Serial.println("[OFFLINE MODE] Wi-Fi lost. Running autonomous local tank protection...");
      digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Flash LED

      // Autonomous local control with 12s dry-run & 30s auto-retest protection while offline:
      if (waterPct >= 90.0f || distance <= 3.0f) {
        setRelayState(false); // Auto stop when full
        digitalWrite(BUZZER_PIN, LOW);
        offlineMotorStatus = false;
        offlineSourceEmpty = false;
      } else if (waterPct <= 20.0f || offlineMotorStatus) {
        // Check 30s cooldown if resource was detected empty
        if (offlineSourceEmpty) {
          unsigned long offlineElapsed = now - offlineLastEmptyTime;
          if (offlineElapsed < 30000 && !offlineMotorStatus) {
            // Still in 30s cooldown: keep motor OFF
            setRelayState(false);
            digitalWrite(BUZZER_PIN, LOW);
            Serial.println("[OFFLINE DRY RUN] Resource empty! Motor in 30s cooldown before retest.");
          } else {
            // 30s elapsed or probing: start 12s test
            if (!offlineMotorStatus) {
              offlineMotorStatus = true;
              offlineMotorStartTime = now;
              offlineStartWaterPct = waterPct;
              Serial.println("[OFFLINE RETEST] 30s elapsed! Starting motor for 12s retest...");
            }
            setRelayState(true);
            digitalWrite(BUZZER_PIN, HIGH);

            // Check if water level increased during test
            if (waterPct >= offlineStartWaterPct + 0.3f) {
              offlineSourceEmpty = false; // Resource refilled!
              Serial.println("[OFFLINE REFILL] Water level increased! Resource refilled.");
            } else if (now - offlineMotorStartTime >= 12000) {
              // 12s dry test passed with no rise: stop motor and wait 30s again
              setRelayState(false);
              digitalWrite(BUZZER_PIN, LOW);
              offlineMotorStatus = false;
              offlineSourceEmpty = true;
              offlineLastEmptyTime = now;
              Serial.println("[OFFLINE DRY RUN] No water rise after 12s! Motor stopped. Retesting in 30s.");
            }
          }
        } else {
          // Normal motor start when empty
          if (!offlineMotorStatus) {
            offlineMotorStatus = true;
            offlineMotorStartTime = now;
            offlineStartWaterPct = waterPct;
          }
          setRelayState(true);
          digitalWrite(BUZZER_PIN, HIGH);

          if (waterPct >= offlineStartWaterPct + 0.3f) {
            offlineMotorStartTime = now;
            offlineStartWaterPct = waterPct;
          } else if (now - offlineMotorStartTime >= 12000) {
            // 12s dry run detected!
            setRelayState(false);
            digitalWrite(BUZZER_PIN, LOW);
            offlineMotorStatus = false;
            offlineSourceEmpty = true;
            offlineLastEmptyTime = now;
            Serial.println("[OFFLINE DRY RUN] 12s with no water rise! Motor stopped. Retesting in 30s.");
          }
        }
      } else {
        digitalWrite(BUZZER_PIN, LOW);
      }
    }
  }

  yield(); // Feed ESP8266 background system tasks
}

/* ===========================================================
   FUNCTION: connectWiFi
   Searches and connects to any available registered Wi-Fi network.
   =========================================================== */

void connectWiFi() {
  Serial.println("Searching and connecting to available registered Wi-Fi...");

  WiFi.mode(WIFI_STA);

  int attempts = 0;
  while (wifiMulti.run() != WL_CONNECTED && attempts < 30) {
    delay(500);
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Flash LED while connecting
    Serial.print(".");
    attempts++;
  }

  if (wifiMulti.run() == WL_CONNECTED) {
    digitalWrite(LED_PIN, LOW); // Turn LED solid ON when connected
    Serial.println("\n\n[OK] Connected to Wi-Fi!");
    Serial.print("  Connected SSID     : ");
    Serial.println(WiFi.SSID());
    Serial.print("  NodeMCU IP Address : ");
    Serial.println(WiFi.localIP());
    Serial.print("  Signal Strength    : ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.print("  Cloud Server URL   : ");
    Serial.println(CLOUD_SERVER_URL);
    Serial.println("========================================\n");
  } else {
    digitalWrite(LED_PIN, HIGH); // Turn LED OFF on failure
    Serial.println("\n\n[ERROR] Wi-Fi connection failed!");
    Serial.println("  1. Verify your phone hotspot / Wi-Fi is turned ON.");
    Serial.println("  2. Ensure 2.4GHz Wi-Fi band is active.");
  }
}

/* ===========================================================
   FUNCTION: measureDistance
   Uses HC-SR04 to measure distance in cm. Returns -1 on error.
   =========================================================== */

float getSingleDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return -1;

  float distance = duration * 0.0343 / 2.0;
  if (distance <= 0 || distance > (TANK_HEIGHT + 15.0)) return -1;
  return distance;
}

float measureDistance() {
  float samples[7];
  int validCount = 0;

  for (int i = 0; i < 7; i++) {
    float d = getSingleDistance();
    if (d > 0) {
      samples[validCount++] = d;
    }
    delay(8);
  }

  if (validCount == 0) return lastReportedDistance >= 0 ? lastReportedDistance : -1;

  // Sort samples to extract median
  for (int i = 0; i < validCount - 1; i++) {
    for (int j = i + 1; j < validCount; j++) {
      if (samples[i] > samples[j]) {
        float temp = samples[i];
        samples[i] = samples[j];
        samples[j] = temp;
      }
    }
  }

  float currentMedian = samples[validCount / 2];

  // Step 1: EMA filter — balanced smoothing (alpha=0.4)
  if (lastSmoothedDistance < 0) {
    lastSmoothedDistance = currentMedian;
  } else {
    lastSmoothedDistance = (0.40 * currentMedian) + (0.60 * lastSmoothedDistance);
  }

  // Step 2: Deadband filter — only update reported value if change > 0.3 cm
  // This eliminates small noise/ripple fluctuations on the dashboard completely
  if (lastReportedDistance < 0 || fabs(lastSmoothedDistance - lastReportedDistance) >= 0.3) {
    lastReportedDistance = round(lastSmoothedDistance * 10.0) / 10.0; // round to 1 decimal
  }

  return lastReportedDistance;
}


/* ===========================================================
   FUNCTION: sendToServer
   POSTs telemetry JSON to both Cloud Render & Local PC Backend.
   =========================================================== */

bool postEndpoint(const String& url, const String& body, bool updateActuators) {
  if (url.length() < 10) return false;
  HTTPClient http;
  bool isHttps = url.startsWith("https://");

  if (isHttps) {
    secureClient.setInsecure(); // Allow SSL handshake
    http.begin(secureClient, url);
  } else {
    http.begin(wifiClient, url);
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(isHttps ? 10000 : 1500); // 10s for cloud HTTPS, 1.5s for local LAN

  Serial.print("[HTTP] POST → ");
  Serial.print(url);
  Serial.print(" Data: ");
  Serial.println(body);

  int httpCode = http.POST(body);
  bool success = false;

  if (httpCode == 200) {
    success = true;
    String response = http.getString();

    if (updateActuators) {
      StaticJsonDocument<1024> doc;
      DeserializationError error = deserializeJson(doc, response);
      if (!error) {
        bool motorOn  = doc["motor"]["status"];
        bool buzzerOn = doc["buzzer"]["status"];
        const char* alertMsg = doc["alert"]["message"];

        setRelayState(motorOn);
        digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);

        Serial.print("  [SYNC OK] Motor: ");
        Serial.print(motorOn  ? "ON [PUMP ACTIVE]" : "OFF [PUMP IDLE]");
        Serial.print("  |  Buzzer: ");
        Serial.print(buzzerOn ? "ACTIVE" : "OFF");
        Serial.print("  |  Alert: ");
        Serial.println(alertMsg);
      }
    }
  } else if (httpCode < 0) {
    Serial.print("  [HTTP ERROR] Failed with code: ");
    Serial.println(httpCode);
  } else {
    Serial.print("  [HTTP ERROR] Server responded: ");
    Serial.println(httpCode);
  }

  http.end();
  return success;
}

void sendToServer(float distance) {
  String body = "{\"sensorDistance\":" + String(distance, 1) + "}";

  // 1. Sync to Local PC Server first (if configured and on same Wi-Fi)
  bool localSynced = false;
  if (LOCAL_SERVER_URL.length() > 10) {
    localSynced = postEndpoint(LOCAL_SERVER_URL, body, true);
  }

  // 2. Sync to Cloud Render Deployment (syncs actuators if local was not reached)
  bool cloudSynced = postEndpoint(CLOUD_SERVER_URL, body, !localSynced);

  // LED Flash indicator on successful sync
  if (localSynced || cloudSynced) {
    digitalWrite(LED_PIN, HIGH);
    delay(40);
    digitalWrite(LED_PIN, LOW);
  }
}

/* ===========================================================
   FUNCTION: setRelayState
   Handles Active-LOW vs Active-HIGH relay modules cleanly.
   =========================================================== */

void setRelayState(bool turnOn) {
  pinMode(RELAY_PIN, OUTPUT);
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(RELAY_PIN, turnOn ? LOW : HIGH); // LOW (0V) = ON, HIGH (3.3V) = OFF
  } else {
    digitalWrite(RELAY_PIN, turnOn ? HIGH : LOW);
  }
}

/* ===========================================================
   FUNCTION: printReadings
   Prints telemetry formatted to Serial Monitor.
   =========================================================== */

void printReadings(float distance, float waterLevel, float waterPct) {
  float waterLevelM = waterLevel / 100.0;
  Serial.println("────────────────────────────────────────────────");
  Serial.print("  Sensor Distance : ");
  Serial.print(distance, 1);
  Serial.println(" cm");
  Serial.print("  Water Level     : ");
  Serial.print(waterLevelM, 2);
  Serial.print(" m (");
  Serial.print(waterLevel, 1);
  Serial.println(" cm)");
  Serial.print("  Water Fill %    : ");
  Serial.print(waterPct, 1);
  Serial.println("%");
}

/* ===========================================================
   FUNCTION: blinkLED
   Helper to blink built-in LED for visual diagnostic alerts.
   =========================================================== */

void blinkLED(int count, int delayMs) {
  for (int i = 0; i < count; i++) {
    digitalWrite(LED_PIN, LOW);  // LED ON
    delay(delayMs);
    digitalWrite(LED_PIN, HIGH); // LED OFF
    delay(delayMs);
  }
}

/* ===========================================================
   FUNCTION: sendPushoverAlert
   Sends native lockscreen push alerts via Pushover HTTPS API.
   =========================================================== */

void sendPushoverAlert(String title, String message, String sound, int priority) {
  if (wifiMulti.run() == WL_CONNECTED) {
    WiFiClientSecure pushoverClient;
    pushoverClient.setInsecure(); // Skip SSL certificate check for Pushover

    HTTPClient http;
    if (http.begin(pushoverClient, "https://api.pushover.net/1/messages.json")) {
      http.addHeader("Content-Type", "application/x-www-form-urlencoded");

      String postData = "token=" + String(PUSHOVER_API_TOKEN) +
                        "&user=" + String(PUSHOVER_USER_KEY) +
                        "&title=" + title +
                        "&message=" + message +
                        "&sound=" + sound +
                        "&priority=" + String(priority);

      int httpCode = http.POST(postData);
      if (httpCode == 200) {
        Serial.printf("[PUSHOVER] 📱 Native push sent successfully! (Sound: %s)\n", sound.c_str());
      } else {
        Serial.printf("[PUSHOVER] ⚠️ Failed, HTTP Code: %d\n", httpCode);
      }
      http.end();
    }
  }
}