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
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

/* ===========================================================
   STEP 1 — NETWORK CONFIGURATION (CHANGE THESE VALUES)
   =========================================================== */

// Your Wi-Fi network name and password
const char* WIFI_SSID = "Redmi 12 5G";
const char* WIFI_PASS = "Mahesh14";

// Server URL (Local IP or Render Cloud URL)
// Examples:
//   Local:  "http://10.204.4.141:3000/api/sensor"
//   Render: "https://your-app-name.onrender.com/api/sensor"
const String SERVER_URL = "http://10.204.4.141:3000/api/sensor";

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

// Sensor mounting height from bottom of tank in centimeters
const float SENSOR_HEIGHT = 20.5;

// Tank maximum full water capacity height in centimeters
const float TANK_HEIGHT = 19.9;

// How often to read sensor and send data to server (milliseconds)
const unsigned long SEND_INTERVAL = 500; // 0.5 seconds (ultra-fast real-time response)

/* ===========================================================
   GLOBAL VARIABLES — do not change
   =========================================================== */

unsigned long     lastSendTime = 0;
WiFiClient        wifiClient;
WiFiClientSecure  secureClient;

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

  // Connect to Wi-Fi
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

    // Check Wi-Fi connection
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WARN] Wi-Fi lost! Attempting reconnect...");
      connectWiFi();
      return;
    }

    // 1. Measure distance using ultrasonic sensor
    float distance = measureDistance();

    // 🚨 EMERGENCY HARDWARE FAILSAFE: If water gets within 2.0cm of sensor eyes, CUT OFF RELAY IMMEDIATELY!
    if (distance > 0 && distance <= 2.0) {
      Serial.println("[SAFETY EMERGENCY] Water within 2cm of sensor! Cutting off relay immediately to prevent sensor water damage!");
      setRelayState(false);
    }

    if (distance < 0) {
      Serial.println("[ERROR] Sensor measurement failed. Check HC-SR04 wiring (VCC, GND, TRIG, ECHO).");
      // Blink LED quickly twice to signal sensor error
      blinkLED(2, 100);
      return;
    }

    // 2. Calculate water height & percentage
    float waterLevel = constrain(SENSOR_HEIGHT - distance, 0.0, TANK_HEIGHT);
    float waterPct   = constrain((waterLevel / TANK_HEIGHT) * 100.0, 0.0, 100.0);

    // 3. Print sensor telemetry to Serial
    printReadings(distance, waterLevel, waterPct);

    // 4. Send telemetry to software backend API & update actuators
    sendToServer(distance);
  }

  yield(); // Feed ESP8266 watchdog timer
}

/* ===========================================================
   FUNCTION: connectWiFi
   Connects to Wi-Fi router with visual LED indication.
   =========================================================== */

void connectWiFi() {
  Serial.print("Connecting to Wi-Fi Network: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    digitalWrite(LED_PIN, !digitalRead(LED_PIN)); // Flash LED while connecting
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(LED_PIN, LOW); // Turn LED solid ON when connected
    Serial.println("\n\n[OK] Connected to Wi-Fi!");
    Serial.print("  NodeMCU IP Address : ");
    Serial.println(WiFi.localIP());
    Serial.print("  Signal Strength    : ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    Serial.print("  Backend Server URL : ");
    Serial.println(SERVER_URL);
    Serial.println("========================================\n");
  } else {
    digitalWrite(LED_PIN, HIGH); // Turn LED OFF on failure
    Serial.println("\n\n[ERROR] Wi-Fi connection failed!");
    Serial.println("  1. Verify WIFI_SSID & WIFI_PASS in code.");
    Serial.println("  2. Ensure 2.4GHz Wi-Fi network is enabled.");
    Serial.println("  3. Move NodeMCU closer to router.");
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

static float lastSmoothedDistance = -1.0;
static float lastReportedDistance = -1.0;

float measureDistance() {
  float samples[9];
  int validCount = 0;

  for (int i = 0; i < 9; i++) {
    float d = getSingleDistance();
    if (d > 0) {
      samples[validCount++] = d;
    }
    delay(6);
  }

  if (validCount == 0) return lastReportedDistance >= 0 ? lastReportedDistance : -1;

  // Sort samples to extract true median (ignores splash peaks & noise)
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

  // Step 1: EMA filter — ultra-smooth response against water waves (alpha=0.25)
  if (lastSmoothedDistance < 0) {
    lastSmoothedDistance = currentMedian;
  } else {
    lastSmoothedDistance = (0.25 * currentMedian) + (0.75 * lastSmoothedDistance);
  }

  // Step 2: Deadband filter — only update reported value if change >= 0.2 cm
  if (lastReportedDistance < 0 || fabs(lastSmoothedDistance - lastReportedDistance) >= 0.2) {
    lastReportedDistance = round(lastSmoothedDistance * 10.0) / 10.0; // round to 1 decimal
  }

  return lastReportedDistance;
}


/* ===========================================================
   FUNCTION: sendToServer
   POSTs telemetry JSON to backend and syncs Relay/Buzzer state.
   =========================================================== */

void sendToServer(float distance) {
  HTTPClient http;

  if (SERVER_URL.startsWith("https://")) {
    secureClient.setInsecure(); // Allow SSL handshake for cloud services like Render
    http.begin(secureClient, SERVER_URL);
  } else {
    http.begin(wifiClient, SERVER_URL);
  }

  http.addHeader("Content-Type", "application/json");
  http.setTimeout(4000); // 4 second connection timeout

  String body = "{\"sensorDistance\":" + String(distance, 1) + "}";

  Serial.print("[HTTP] POST → ");
  Serial.print(SERVER_URL);
  Serial.print(" Data: ");
  Serial.println(body);

  int httpCode = http.POST(body);

  if (httpCode == 200) {
    String response = http.getString();

    // Parse JSON payload from Express server
    StaticJsonDocument<512> doc;
    DeserializationError error = deserializeJson(doc, response);

    if (!error) {
      bool motorOn  = doc["motor"]["status"];
      bool buzzerOn = doc["buzzer"]["status"];
      const char* alertMsg = doc["alert"]["message"];

      // Update physical actuators
      setRelayState(motorOn);
      digitalWrite(BUZZER_PIN, buzzerOn ? HIGH : LOW);

      // Brief flash to indicate successful hardware-software sync
      digitalWrite(LED_PIN, HIGH);
      delay(50);
      digitalWrite(LED_PIN, LOW);

      Serial.print("  [SYNC OK] Motor: ");
      Serial.print(motorOn  ? "ON [PUMP ACTIVE]" : "OFF [PUMP IDLE]");
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
  if (RELAY_ACTIVE_LOW) {
    if (turnOn) {
      pinMode(RELAY_PIN, OUTPUT);
      digitalWrite(RELAY_PIN, LOW);   // LOW (0V) turns Active-LOW Relay ON
    } else {
      pinMode(RELAY_PIN, INPUT_PULLUP); // High impedance pullup turns Active-LOW Relay OFF 100%
      digitalWrite(RELAY_PIN, HIGH);
    }
  } else {
    pinMode(RELAY_PIN, OUTPUT);
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
