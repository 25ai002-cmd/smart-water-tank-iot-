/*
 * ============================================================
 *  Smart Water Tank Monitor — NodeMCU ESP8266
 *  File    : WaterTankMonitor.ino
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

// Server URL (Render Cloud URL)
const String SERVER_URL = "https://smart-water-tank-iot.onrender.com/api/sensor";

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
const unsigned long SEND_INTERVAL = 500; // 0.5 seconds (ultra-fast real-time response)

/* ===========================================================
   GLOBAL VARIABLES — do not change
   =========================================================== */

unsigned long     lastSendTime = 0;
WiFiClient        wifiClient;
WiFiClientSecure  secureClient;
bool              localMotorRunning = false;
bool              isManualMode = false;
bool              hardwareDryRunLock = false;
unsigned long     dryRunCutoffTime = 0;   // Timestamp when dry-run occurred
bool              dryRunProbing    = false; // True during 12s test probe after 30s cooldown
float             currentStopThreshold  = 60.0; // Dynamic stop threshold synced from server settings (default 60%)
float             currentStartThreshold = 20.0; // Dynamic start threshold synced from server settings (default 20%)
float             lastSmoothedDistance = -1.0;
float             lastReportedDistance = -1.0;

/* ===========================================================
   SETUP — Runs once on power up / reset
   =========================================================== */

void setup() {
  Serial.begin(115200);
  delay(200);

  Serial.println("\n\n========================================");
  Serial.println("  💧 AquaMonitor NodeMCU ESP8266 Started ");
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

  // Configure SSL buffer limits to allow modern Cloudflare/Render TLS cert chains
  secureClient.setInsecure();
  secureClient.setBufferSizes(2048, 1024);

  // Configure Multi-WiFi and Connect
  registerWiFiNetworks();
  connectWiFi();
}

/* ===========================================================
   LOOP — Runs continuously
   =========================================================== */

void loop() {
  unsigned long now = millis();

  // Run at specified send interval
  if (now - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = now;

    // Check Multi-WiFi connection (auto-reconnects to strongest available AP)
    if (wifiMulti.run() != WL_CONNECTED) {
      Serial.println("[WARN] Wi-Fi lost! Auto-reconnecting to available network...");
      digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Flash LED
      return;
    } else {
      digitalWrite(LED_PIN, LOW); // Solid ON when connected
    }

    // 1. Measure distance using ultrasonic sensor
    float distance = measureDistance();

    // 🚨 EMERGENCY HARDWARE FAILSAFE: If water gets within 2.0cm of sensor eyes, CUT OFF RELAY IMMEDIATELY!
    if (distance > 0 && distance <= 2.0) {
      Serial.println("[SAFETY EMERGENCY] Water within 2cm of sensor! Cutting off relay immediately to prevent sensor water damage!");
      setRelayState(false);
    }

    if (distance < 0) {
      if (lastReportedDistance > 0) {
        distance = lastReportedDistance;
      } else {
        distance = 15.0f; // Safe baseline fallback
      }
      Serial.println("[WARN] Sensor measurement failed. Using fallback distance for keepalive heartbeat.");
      blinkLED(2, 100);
    }

    // 2. Calculate water height & percentage
    float waterLevel = constrain(SENSOR_TOTAL_HEIGHT - distance, 0.0f, TANK_HEIGHT);
    float waterPct   = constrain((waterLevel / TANK_HEIGHT) * 100.0f, 0.0f, 100.0f);

    // ═══════════════════════════════════════════════════════════════
    // 🧠 NODEMCU AUTONOMOUS DECISION ENGINE (Hardware-Level Control)
    // ═══════════════════════════════════════════════════════════════
    if (!isManualMode) {
      if (waterPct >= currentStopThreshold || (distance > 0 && distance <= 2.0f)) {
        // TANK REACHED DECIDED STOP THRESHOLD (e.g. 60%) -> CUT RELAY POWER IMMEDIATELY!
        if (localMotorRunning) {
          Serial.print("  🛑 [ESP AUTO-STOP] Decided threshold reached (");
          Serial.print(waterPct, 1);
          Serial.print("% >= ");
          Serial.print(currentStopThreshold, 1);
          Serial.println("%). RELAY CUTTING POWER TO MOTOR NOW!");
        }
        localMotorRunning  = false;
        hardwareDryRunLock = false;
        dryRunProbing      = false;
        dryRunCutoffTime   = 0;
        setRelayState(false);
      } else if (hardwareDryRunLock) {
        // ── 30-SECOND DRY-RUN RECOVERY COOLDOWN ──
        if (now - dryRunCutoffTime >= 30000) {
          Serial.println("  🔄 [AUTO-RETRY] 30s cooldown expired! Auto-starting pump for 12s test probe to check if resource refilled...");
          hardwareDryRunLock = false;
          dryRunProbing      = true;
          localMotorRunning  = true;
          setRelayState(true);
        } else {
          // Strictly enforce motor OFF during the 30s cooldown
          localMotorRunning = false;
          setRelayState(false);
        }
      } else if (waterPct <= currentStartThreshold && !hardwareDryRunLock) {
        // TANK AT OR BELOW START THRESHOLD (e.g. 20%) -> START MOTOR TO FILL
        if (!localMotorRunning) {
          Serial.print("  💧 [ESP AUTO-START] Water low (");
          Serial.print(waterPct, 1);
          Serial.print("% <= ");
          Serial.print(currentStartThreshold, 1);
          Serial.println("%). RELAY STARTING MOTOR TO FILL!");
        }
        localMotorRunning = true;
        setRelayState(true);
      }
    }

    // 3. Print sensor telemetry to Serial
    printReadings(distance, waterLevel, waterPct);

    // ── 12-SECOND HARDWARE DRY-RUN PROTECTION & RESET ──
    static unsigned long motorStartedAt = 0;
    static float levelAtMotorStart = -1.0;

    if (localMotorRunning && !hardwareDryRunLock) {
      if (motorStartedAt == 0) {
        motorStartedAt = now;
        levelAtMotorStart = waterPct;
      } else if (waterPct >= levelAtMotorStart + 0.3f) {
        // Water is actively rising! Reset 12s timer & confirm resource has water
        if (dryRunProbing) {
          Serial.println("  ✅ [REFILL CONFIRMED] Water level is rising! Resource has water. Continuing normal fill.");
          dryRunProbing = false;
        }
        dryRunCutoffTime  = 0;
        motorStartedAt    = now;
        levelAtMotorStart = waterPct;
      } else if (now - motorStartedAt >= 12000) { // 12 seconds with no water level rise
        Serial.println("  🚨 [DRY RUN CUTOFF] No water rise in 12s! Pump halted to prevent dry-run damage.");
        Serial.println("  ⏳ [COOLDOWN] Pump resting for 30s. Will auto-restart to re-test resource.");
        hardwareDryRunLock = true;
        dryRunCutoffTime   = now;
        dryRunProbing      = false;
        localMotorRunning  = false;
        setRelayState(false);
        digitalWrite(BUZZER_PIN, LOW);
        motorStartedAt     = 0;
        levelAtMotorStart  = -1.0;
      }
    } else if (!localMotorRunning) {
      motorStartedAt = 0;
      levelAtMotorStart = -1.0;
    }

    // 4. Send telemetry to software backend API & sync actuators (Server is Master)
    sendToServer(distance, waterPct);
  }

  yield(); // Feed ESP8266 watchdog timer
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
    Serial.println(SERVER_URL);
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
  float samples[9];
  int validCount = 0;

  for (int i = 0; i < 9; i++) {
    float d = getSingleDistance();
    if (d > 0) {
      samples[validCount++] = d;
    }
    delay(20); // 20ms allows acoustic echoes and multipath wall reflections to dissipate
  }

  if (validCount == 0) return lastReportedDistance >= 0 ? lastReportedDistance : -1;

  // Sort samples in ascending order
  for (int i = 0; i < validCount - 1; i++) {
    for (int j = i + 1; j < validCount; j++) {
      if (samples[i] > samples[j]) {
        float temp = samples[i];
        samples[i] = samples[j];
        samples[j] = temp;
      }
    }
  }

  // Step 1: Trimmed Mean (discards wave crests, splash peaks, and noise drops)
  float rawFiltered;
  if (validCount >= 5) {
    int trim = (validCount >= 7) ? 2 : 1;
    float sum = 0;
    int count = 0;
    for (int i = trim; i < validCount - trim; i++) {
      sum += samples[i];
      count++;
    }
    rawFiltered = sum / count;
  } else {
    rawFiltered = samples[validCount / 2]; // Median fallback
  }

  // Step 2: Rate-of-Change Limiter (Physics Slew-Rate Limiter)
  // Water cannot physically jump by 0.8 cm (4%) in 500ms.
  // Clamps maximum physical delta per reading to completely stop random 53% <-> 49% jumps.
  if (lastSmoothedDistance < 0) {
    lastSmoothedDistance = rawFiltered;
  } else {
    float maxDelta = localMotorRunning ? 0.35f : 0.15f; // Max 0.35cm while pumping, 0.15cm when idle
    float delta = rawFiltered - lastSmoothedDistance;
    if (delta > maxDelta)  delta = maxDelta;
    if (delta < -maxDelta) delta = -maxDelta;

    // Step 3: Low-pass EMA smoothing (alpha=0.30)
    lastSmoothedDistance += (0.30f * delta);
  }

  // Step 4: Anti-Jitter Deadband Filter
  if (lastReportedDistance < 0) {
    lastReportedDistance = round(lastSmoothedDistance * 10.0) / 10.0;
  } else {
    float deadband = localMotorRunning ? 0.10f : 0.25f;
    if (fabs(lastSmoothedDistance - lastReportedDistance) >= deadband) {
      lastReportedDistance = round(lastSmoothedDistance * 10.0) / 10.0; // round to 1 decimal
    }
  }

  return lastReportedDistance;
}


/* ===========================================================
   FUNCTION: sendToServer
   POSTs telemetry JSON to backend and syncs Relay/Buzzer state.
   =========================================================== */

void sendToServer(float distance, float waterPct) {
  HTTPClient http;

  if (SERVER_URL.startsWith("https://")) {
    secureClient.setInsecure(); // Allow SSL handshake for cloud services like Render
    http.begin(secureClient, SERVER_URL);
  } else {
    http.begin(wifiClient, SERVER_URL);
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000); // 10 second timeout for Render free tier cold starts

  String body = "{\"sensorDistance\":" + String(distance, 1) + "}";

  Serial.print("[HTTP] POST → ");
  Serial.print(SERVER_URL);
  Serial.print(" Data: ");
  Serial.println(body);

  int httpCode = http.POST(body);

  if (httpCode == 200) {
    String response = http.getString();

    // Parse JSON payload from Express server
    StaticJsonDocument<1024> doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      bool serverMotorOn   = doc["motor"]["status"] | false;
      bool buzzerOn        = doc["buzzer"]["status"] | false;
      bool sourceEmpty     = doc["motor"]["sourceEmpty"] | false;
      const char* motorMode= doc["motor"]["mode"];
      const char* alertMsg = doc["alert"]["message"];

      // Sync user-configured thresholds from server response
      if (doc.containsKey("settings")) {
        if (doc["settings"].containsKey("motorOffThreshold")) {
          currentStopThreshold = doc["settings"]["motorOffThreshold"].as<float>();
        }
        if (doc["settings"].containsKey("motorOnThreshold")) {
          currentStartThreshold = doc["settings"]["motorOnThreshold"].as<float>();
        }
      }

      // Manual mode check (ignore legacy sourceEmpty 'manual' lock)
      if (motorMode != nullptr && strcmp(motorMode, "manual") == 0 && !sourceEmpty) {
        isManualMode = true;
      } else {
        isManualMode = false;
      }

      // Manual start from web dashboard clears dry-run lock
      if (serverMotorOn && isManualMode) {
        hardwareDryRunLock = false;
        dryRunProbing      = false;
        dryRunCutoffTime   = 0;
        localMotorRunning  = true;
      }

      bool finalMotorOn;

      if (isManualMode) {
        finalMotorOn = serverMotorOn;
      } else {
        // Autonomous Auto Mode
        if (waterPct >= currentStopThreshold || (distance > 0 && distance <= 2.0f)) {
          finalMotorOn       = false;
          hardwareDryRunLock = false;
          dryRunProbing      = false;
        } else if (hardwareDryRunLock) {
          // Strictly keep OFF during 30s dry-run cooldown
          finalMotorOn = false;
        } else if (dryRunProbing) {
          // 30s cooldown expired! Running 12s test probe: pump stays ON!
          finalMotorOn = true;
        } else if (waterPct <= currentStartThreshold) {
          finalMotorOn = true;
        } else {
          finalMotorOn = localMotorRunning;
        }
      }

      // Update physical actuators and keep local state synchronized
      localMotorRunning = finalMotorOn;
      setRelayState(finalMotorOn);
      digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);

      // Brief flash to indicate successful hardware-software sync
      digitalWrite(LED_PIN, HIGH);
      delay(50);
      digitalWrite(LED_PIN, LOW);

      Serial.print("  [SYNC OK] Motor: ");
      Serial.print(finalMotorOn ? "ON [PUMP ACTIVE]" : "OFF [PUMP IDLE]");
      Serial.print("  |  Buzzer: ");
      Serial.print(buzzerOn ? "ACTIVE" : "OFF");
      Serial.print("  |  Server Alert: ");
      Serial.println(alertMsg);

    } else {
      Serial.print("[ERROR] JSON parsing failed: ");
      Serial.println(error.c_str());
    }

  } else if (httpCode < 0) {
    Serial.print("[ERROR] HTTP request failed. Error code: ");
    Serial.println(httpCode);
    Serial.println("  Make sure START SERVER.bat is running on your PC.");
    Serial.print("  Current target URL: ");
    Serial.println(SERVER_URL);
  } else {
    Serial.print("[ERROR] Server responded with HTTP ");
    Serial.println(httpCode);
  }

  http.end();
}

/* ===========================================================
   FUNCTION: setRelayState
   Handles Active-LOW vs Active-HIGH relay modules cleanly.
   =========================================================== */

void setRelayState(bool turnOn) {
  pinMode(RELAY_PIN, OUTPUT);
  int pinVal = turnOn ? (RELAY_ACTIVE_LOW ? LOW : HIGH) : (RELAY_ACTIVE_LOW ? HIGH : LOW);
  digitalWrite(RELAY_PIN, pinVal);
  Serial.print("  [RELAY PIN D2 (GPIO4)] -> Output: ");
  Serial.print(pinVal == LOW ? "LOW (0V)" : "HIGH (3.3V)");
  Serial.print(" | State: ");
  Serial.println(turnOn ? "RELAY ENERGIZED (ON)" : "RELAY DE-ENERGIZED (OFF)");
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
