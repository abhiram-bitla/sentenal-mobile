const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand
} = require("@aws-sdk/lib-dynamodb");

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const COGNITO_REGION = "us-east-2";
const COGNITO_USER_POOL_ID = "us-east-2_tkvwiWjt6";
const COGNITO_APP_CLIENT_ID = "3npppr0t7p9ulpttpq2p3s0g6c";
const AWS_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-2";
const MESSAGES_TABLE =
  process.env.FORUM_MESSAGES_TABLE || process.env.DYNAMODB_MESSAGES_TABLE || "";

const DEFAULT_MESSAGES = [
  {
    id: "seed-welcome-to-sentenal",
    text: "Welcome to the Sentenal public forum. Drop a thought, ask a question, or just say hi.",
    userEmail: "sentenal@sentenal.news",
    userAlias: "Sentenal Host",
    createdAt: "2026-04-22T12:00:00.000Z",
    seeded: true
  },
  {
    id: "seed-newsletter-chat",
    text: "Newsletter signups and anonymous chat are connected now, so everyone lands in the same shared room.",
    userEmail: "updates@sentenal.news",
    userAlias: "Sentenal Updates",
    createdAt: "2026-04-22T12:01:00.000Z",
    seeded: true
  },
  {
    id: "seed-forum-prompt",
    text: "Prompt for today: what should this community keep an eye on next?",
    userEmail: "forum@sentenal.news",
    userAlias: "Forum Prompt",
    createdAt: "2026-04-22T12:02:00.000Z",
    seeded: true
  }
];

let dynamoDocClient;

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify({ users: [], messages: [] }, null, 2),
      "utf8"
    );
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

function getDynamoDocClient() {
  if (!MESSAGES_TABLE) {
    return null;
  }

  if (!dynamoDocClient) {
    dynamoDocClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: AWS_REGION })
    );
  }

  return dynamoDocClient;
}

function normalizeMessage(message) {
  return {
    id: message.id,
    text: message.text,
    userEmail: message.userEmail,
    userAlias: message.userAlias || message.userEmail,
    createdAt: message.createdAt,
    seeded: Boolean(message.seeded)
  };
}

function sortMessages(messages) {
  return messages
    .map(normalizeMessage)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-100);
}

async function seedLocalDefaultMessages() {
  const db = readDb();
  const existingIds = new Set(db.messages.map((message) => message.id));
  const missingMessages = DEFAULT_MESSAGES.filter(
    (message) => !existingIds.has(message.id)
  );

  if (missingMessages.length) {
    db.messages.unshift(...missingMessages);
    writeDb(db);
  }
}

async function seedDynamoDefaultMessages(client) {
  await Promise.all(
    DEFAULT_MESSAGES.map((message) =>
      client
        .send(
          new PutCommand({
            TableName: MESSAGES_TABLE,
            Item: message,
            ConditionExpression: "attribute_not_exists(id)"
          })
        )
        .catch((error) => {
          if (error.name !== "ConditionalCheckFailedException") {
            throw error;
          }
        })
    )
  );
}

async function ensureDefaultMessages() {
  const client = getDynamoDocClient();
  if (client) {
    await seedDynamoDefaultMessages(client);
    return "dynamodb";
  }

  await seedLocalDefaultMessages();
  return "local-json";
}

async function listForumMessages() {
  const store = await ensureDefaultMessages();
  const client = getDynamoDocClient();

  if (client) {
    const result = await client.send(
      new ScanCommand({
        TableName: MESSAGES_TABLE,
        Limit: 1000
      })
    );

    return {
      store,
      messages: sortMessages(result.Items || [])
    };
  }

  const db = readDb();
  return {
    store,
    messages: sortMessages(db.messages)
  };
}

async function saveForumMessage(message, db) {
  const client = getDynamoDocClient();

  if (client) {
    await client.send(
      new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: message
      })
    );
    return "dynamodb";
  }

  db.messages.push(message);
  writeDb(db);
  return "local-json";
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email
  };
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return null;
  }

  return header.slice("Bearer ".length).trim() || null;
}

function getHeaderEmail(req) {
  const email = String(req.headers["x-user-email"] || "")
    .trim()
    .toLowerCase();
  return email || null;
}

function getHeaderAlias(req) {
  const alias = String(req.headers["x-user-alias"] || "").trim();
  return alias || null;
}

function parseJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch (_error) {
    return null;
  }
}

function getCognitoUserFromToken(token) {
  const payload = parseJwtPayload(token);
  if (!payload) {
    return null;
  }

  const expectedIss = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;
  const email = payload.email || payload.username;
  const isValidAudience =
    payload.client_id === COGNITO_APP_CLIENT_ID ||
    payload.aud === COGNITO_APP_CLIENT_ID;

  if (
    payload.iss !== expectedIss ||
    !isValidAudience ||
    !email ||
    (payload.token_use !== "id" && payload.token_use !== "access")
  ) {
    return null;
  }

  if (payload.exp && Date.now() >= payload.exp * 1000) {
    return null;
  }

  return {
    id: payload.sub || email,
    email: String(email).toLowerCase(),
    authProvider: "cognito"
  };
}

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7
    }
  })
);
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  const email = getHeaderEmail(req);
  if (req.session.userId || token || email) {
    return next();
  }

  return res.status(401).json({ error: "You must be logged in." });
}

function getCurrentUser(req) {
  const db = readDb();
  const headerEmail = getHeaderEmail(req);

  if (headerEmail) {
    const headerAlias = getHeaderAlias(req) || headerEmail.split("@")[0];
    return {
      db,
      user: {
        id: headerEmail,
        email: headerEmail,
        alias: headerAlias,
        authProvider: "email-header"
      }
    };
  }

  if (req.session.userId) {
    const sessionUser = db.users.find((entry) => entry.id === req.session.userId);
    if (sessionUser) {
      return { db, user: sessionUser };
    }
  }

  const token = getBearerToken(req);
  if (token) {
    const cognitoUser = getCognitoUserFromToken(token);
    if (cognitoUser) {
      return { db, user: cognitoUser };
    }

    const tokenUser = db.users.find((entry) => entry.authToken === token);
    if (tokenUser) {
      return { db, user: tokenUser };
    }
  }

  return { db, user: null };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const { user } = getCurrentUser(req);

  if (!user) {
    return res.json({ user: null });
  }

  return res.json({ user: publicUser(user) });
});

app.post("/api/auth/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: "Password must be at least 6 characters." });
  }

  const db = readDb();
  const existing = db.users.find((user) => user.email === email);
  if (existing) {
    return res.status(409).json({ error: "That email is already registered." });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: crypto.randomUUID(),
    email,
    passwordHash,
    authToken: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };

  db.users.push(user);
  writeDb(db);
  req.session.userId = user.id;

  res.status(201).json({ user: publicUser(user), token: user.authToken });
});

app.post("/api/auth/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const db = readDb();
  const user = db.users.find((entry) => entry.email === email);

  if (!user) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  user.authToken = crypto.randomUUID();
  writeDb(db);
  req.session.userId = user.id;
  res.json({ user: publicUser(user), token: user.authToken });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/messages", requireAuth, async (_req, res) => {
  try {
    const { messages, store } = await listForumMessages();
    res.json({ messages, store });
  } catch (error) {
    console.error("Failed to load forum messages:", error);
    res.status(500).json({ error: "Could not load forum messages." });
  }
});

app.post("/api/messages", requireAuth, async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (!text) {
    return res.status(400).json({ error: "Message cannot be empty." });
  }

  if (text.length > 500) {
    return res.status(400).json({ error: "Message is too long." });
  }

  const { db, user } = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: "You must be logged in." });
  }

  const message = {
    id: crypto.randomUUID(),
    text,
    userEmail: user.email,
    userAlias: user.alias || user.email,
    createdAt: new Date().toISOString()
  };

  try {
    const store = await saveForumMessage(message, db);
    res.status(201).json({ message, store });
  } catch (error) {
    console.error("Failed to save forum message:", error);
    res.status(500).json({ error: "Could not save forum message." });
  }
});

ensureDb();

function startServer(port = PORT) {
  return app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
