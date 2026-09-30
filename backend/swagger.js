// =====================================================
//  backend/swagger.js — OpenAPI 3.0 Specification
//  Accessed at: http://localhost:3000/api-docs
//  This is a backend-only file. Not shown in the app.
// =====================================================

const swaggerDefinition = {
  openapi: '3.0.0',

  info: {
    title: '💧 Smart Water Tank Monitor — REST API',
    version: '1.0.0',
    description: `
## IoT Based Smart Water Tank Monitoring and Control System

REST API backend for the **NodeMCU ESP8266** water tank project.

### Formula
\`\`\`
Water Level (cm)  = Tank Height − Sensor Distance
Water Percentage  = (Water Level / Tank Height) × 100
\`\`\`

### Auto Control Logic
| Water Level | Motor | Buzzer |
|-------------|-------|--------|
| Below 20%   | ON    | ON     |
| 20% – 90%   | Hold  | OFF    |
| Above 90%   | OFF   | ON     |

---
**Semester 3 IoT Project** | NodeMCU ESP8266 + HC-SR04
    `,
  },

  servers: [
    { url: 'http://localhost:3000', description: 'Local Server (node backend/server.js)' },
  ],

  tags: [
    { name: 'System',  description: 'Full system status — used by the dashboard' },
    { name: 'Sensor',  description: 'HC-SR04 sensor readings' },
    { name: 'Motor',   description: 'Water pump / relay control' },
    { name: 'Buzzer',  description: 'Buzzer alert status' },
    { name: 'History', description: 'Past sensor reading logs' },
    { name: 'Notifications', description: 'Smart notification center logs and actions' },
  ],

  components: {
    schemas: {

      SensorReading: {
        type: 'object',
        properties: {
          tankHeight:      { type: 'number', example: 20    },
          sensorDistance:  { type: 'number', example: 5.0   },
          waterLevel:      { type: 'number', example: 15.0  },
          waterPercentage: { type: 'number', example: 75    },
          timestamp:       { type: 'string', format: 'date-time' },
        },
      },

      SensorPost: {
        type: 'object',
        required: ['sensorDistance'],
        properties: {
          sensorDistance: {
            type: 'number',
            example: 5.0,
            description: 'Distance from HC-SR04 sensor to water surface (cm). NodeMCU sends this.',
          },
        },
      },

      MotorStatus: {
        type: 'object',
        properties: {
          status:      { type: 'boolean', example: false },
          mode:        { type: 'string',  enum: ['auto', 'manual'], example: 'auto' },
          lastChanged: { type: 'string',  format: 'date-time' },
        },
      },

      MotorControl: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'boolean', example: true,     description: 'true = ON, false = OFF' },
          mode:   { type: 'string',  example: 'manual', description: '"manual" or "auto"' },
        },
      },

      BuzzerStatus: {
        type: 'object',
        properties: {
          status:      { type: 'boolean', example: false },
          lastChanged: { type: 'string',  format: 'date-time' },
        },
      },

      SystemStatus: {
        type: 'object',
        properties: {
          sensor: { $ref: '#/components/schemas/SensorReading' },
          motor:  { $ref: '#/components/schemas/MotorStatus'   },
          buzzer: { $ref: '#/components/schemas/BuzzerStatus'  },
          alert: {
            type: 'object',
            properties: {
              level:   { type: 'string', enum: ['normal', 'low', 'high'] },
              message: { type: 'string', example: 'Normal water level — system is running fine.' },
            },
          },
          unreadNotifications: { type: 'integer', example: 5 },
        },
      },

      HistoryEntry: {
        type: 'object',
        properties: {
          id:              { type: 'integer', example: 1     },
          sensorDistance:  { type: 'number',  example: 5.0   },
          waterLevel:      { type: 'number',  example: 15.0  },
          waterPercentage: { type: 'number',  example: 75    },
          motorOn:         { type: 'boolean', example: false },
          buzzerOn:        { type: 'boolean', example: false },
          timestamp:       { type: 'string',  format: 'date-time' },
        },
      },

      Notification: {
        type: 'object',
        properties: {
          id:               { type: 'integer', example: 1715963283294 },
          notificationType: { type: 'string',  example: 'tank_empty' },
          title:            { type: 'string',  example: '🚨 Tank Almost Empty' },
          message:          { type: 'string',  example: 'Tank is almost empty. Immediate refill is recommended.' },
          priority:         { type: 'string',  enum: ['critical', 'warning', 'success', 'info'], example: 'critical' },
          isRead:           { type: 'boolean', example: false },
          createdAt:        { type: 'string',  format: 'date-time' },
          resolvedAt:       { type: 'string',  format: 'date-time', nullable: true },
        },
      },

      Success: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string',  example: 'Done.' },
        },
      },

      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error:   { type: 'string',  example: 'sensorDistance is required.' },
        },
      },
    },
  },

  paths: {

    // ── System Status ──────────────────────────────
    '/api/status': {
      get: {
        tags: ['System'],
        summary: 'Get full system status (dashboard polls this every 5s)',
        responses: {
          200: {
            description: 'Complete snapshot of sensor, motor, buzzer and alert',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SystemStatus' } } },
          },
        },
      },
    },

    // ── Sensor ─────────────────────────────────────
    '/api/sensor': {
      get: {
        tags: ['Sensor'],
        summary: 'Get latest sensor reading',
        responses: {
          200: {
            description: 'Latest HC-SR04 reading',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SensorReading' } } },
          },
        },
      },
      post: {
        tags: ['Sensor'],
        summary: 'Submit new sensor reading (NodeMCU sends data here)',
        description: `
**Called by NodeMCU ESP8266 over Wi-Fi.**

NodeMCU measures the sensor distance using HC-SR04, then POSTs it here.
The server auto-calculates water level, updates motor/buzzer, and saves to history.

**NodeMCU Arduino code:**
\`\`\`cpp
HTTPClient http;
http.begin("http://YOUR_PC_IP:3000/api/sensor");
http.addHeader("Content-Type", "application/json");
String body = "{\\"sensorDistance\\":" + String(distance) + "}";
int code = http.POST(body);
\`\`\`
        `,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SensorPost' },
              examples: {
                empty:  { summary: 'Tank empty (10%)',   value: { sensorDistance: 18.0 } },
                normal: { summary: 'Normal (75%)',        value: { sensorDistance: 5.0  } },
                full:   { summary: 'Tank full (95%)',     value: { sensorDistance: 1.0  } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Sensor data accepted — returns updated system status',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SystemStatus' } } },
          },
          400: {
            description: 'Invalid input',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },

    // ── Motor ──────────────────────────────────────
    '/api/motor': {
      get: {
        tags: ['Motor'],
        summary: 'Get motor / pump status',
        responses: {
          200: {
            description: 'Motor status',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MotorStatus' } } },
          },
        },
      },
      post: {
        tags: ['Motor'],
        summary: 'Manually control the motor ON or OFF',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/MotorControl' },
              examples: {
                on:   { summary: 'Turn ON',       value: { status: true,  mode: 'manual' } },
                off:  { summary: 'Turn OFF',      value: { status: false, mode: 'manual' } },
                auto: { summary: 'Resume auto',   value: { status: false, mode: 'auto'   } },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Motor updated',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/MotorStatus' } } },
          },
          400: {
            description: 'Invalid input',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
        },
      },
    },

    // ── Buzzer ─────────────────────────────────────
    '/api/buzzer': {
      get: {
        tags: ['Buzzer'],
        summary: 'Get buzzer / alert status',
        description: 'Buzzer is ON when water < 20% or water > 90%.',
        responses: {
          200: {
            description: 'Buzzer status',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/BuzzerStatus' } } },
          },
        },
      },
    },

    // ── History ────────────────────────────────────
    '/api/history': {
      get: {
        tags: ['History'],
        summary: 'Get past sensor readings (most recent first)',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Number of records to return (default 20, max 100)',
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          200: {
            description: 'History records',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    data:  { type: 'array', items: { $ref: '#/components/schemas/HistoryEntry' } },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        tags: ['History'],
        summary: 'Clear all history records (useful before a demo)',
        responses: {
          200: {
            description: 'History cleared',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
          },
        },
      },
    },

    // ── Notifications ──────────────────────────────
    '/api/notifications': {
      get: {
        tags: ['Notifications'],
        summary: 'Retrieve paginated & filtered notification logs',
        parameters: [
          { name: 'page', in: 'query', description: 'Page number (default 1)', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', description: 'Page size limit (default 20, max 50)', schema: { type: 'integer', default: 20 } },
          { name: 'type', in: 'query', description: 'Priority level to filter (critical, warning, success, info)', schema: { type: 'string' } },
          { name: 'search', in: 'query', description: 'Search keywords', schema: { type: 'string' } },
          { name: 'sort', in: 'query', description: 'Sort order (newest, oldest)', schema: { type: 'string', default: 'newest' } },
          { name: 'unreadOnly', in: 'query', description: 'Filter only unread items', schema: { type: 'string' } },
        ],
        responses: {
          200: {
            description: 'Notification list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    total:      { type: 'integer' },
                    unread:     { type: 'integer' },
                    page:       { type: 'integer' },
                    limit:      { type: 'integer' },
                    totalPages: { type: 'integer' },
                    data:       { type: 'array', items: { $ref: '#/components/schemas/Notification' } },
                  },
                },
              },
            },
          },
        },
      },
      delete: {
        tags: ['Notifications'],
        summary: 'Clear all notifications',
        responses: {
          200: {
            description: 'All notifications cleared',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
          },
        },
      },
    },

    '/api/notifications/{id}/read': {
      post: {
        tags: ['Notifications'],
        summary: 'Mark a notification as read',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Notification ID', schema: { type: 'integer' } },
        ],
        responses: {
          200: {
            description: 'Notification marked as read',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    unread:  { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/notifications/read-all': {
      post: {
        tags: ['Notifications'],
        summary: 'Mark all notifications as read',
        responses: {
          200: {
            description: 'All marked read',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    unread:  { type: 'integer', example: 0 },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/api/notifications/{id}': {
      delete: {
        tags: ['Notifications'],
        summary: 'Delete a specific notification',
        parameters: [
          { name: 'id', in: 'path', required: true, description: 'Notification ID', schema: { type: 'integer' } },
        ],
        responses: {
          200: {
            description: 'Notification deleted',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } },
          },
        },
      },
    },
  },
};

module.exports = swaggerDefinition;
