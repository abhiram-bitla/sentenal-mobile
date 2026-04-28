const express = require("express");
require("dotenv").config();
const session = require("express-session");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand
} = require("@aws-sdk/lib-dynamodb");
const {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand
} = require("@aws-sdk/client-cognito-identity-provider");

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
const MODERATION_CONTACT_EMAIL =
  process.env.MODERATION_CONTACT_EMAIL || "abhiram.bitla@gmail.com";
const BLOCKED_TERMS = [
  "kill yourself",
  "kys",
  "suicide bait",
  "nazi",
  "terrorist",
  "rape",
  "slur",
  "hate speech",
  "harass",
  "dox",
  "doxx",
  "explicit minor",
  "child sexual"
];

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
let cognitoClient;

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

function getCognitoClient() {
  if (!cognitoClient) {
    cognitoClient = new CognitoIdentityProviderClient({ region: COGNITO_REGION });
  }

  return cognitoClient;
}

function containsBlockedTerm(value) {
  const normalized = String(value || "").toLowerCase();
  return BLOCKED_TERMS.some((term) => normalized.includes(term));
}

function normalizeMessage(message) {
  return {
    id: message.id,
    text: message.text,
    userEmail: message.userEmail,
    userAlias: message.userAlias || message.userEmail,
    createdAt: message.createdAt,
    reportedAt: message.reportedAt || null,
    removedAt: message.removedAt || null,
    seeded: Boolean(message.seeded)
  };
}

function sortMessages(messages) {
  return messages
    .filter((message) => message.type !== "report")
    .filter((message) => message.type !== "ban")
    .filter((message) => !message.removedAt)
    .filter((message) => !message.reportedAt)
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

async function findForumMessage(messageId) {
  const client = getDynamoDocClient();

  if (client) {
    const result = await client.send(
      new ScanCommand({
        TableName: MESSAGES_TABLE,
        FilterExpression: "id = :id",
        ExpressionAttributeValues: {
          ":id": messageId
        },
        Limit: 1
      })
    );

    return (result.Items || [])[0] || null;
  }

  const db = readDb();
  return db.messages.find((message) => message.id === messageId) || null;
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

async function removeForumMessage(messageId, db) {
  const client = getDynamoDocClient();

  if (client) {
    await client.send(
      new DeleteCommand({
        TableName: MESSAGES_TABLE,
        Key: { id: messageId }
      })
    );
    return "dynamodb";
  }

  db.messages = db.messages.filter((message) => message.id !== messageId);
  writeDb(db);
  return "local-json";
}

async function removeForumMessagesByUser(userEmail, db) {
  const client = getDynamoDocClient();

  if (client) {
    const result = await client.send(
      new ScanCommand({
        TableName: MESSAGES_TABLE,
        FilterExpression: "userEmail = :email",
        ExpressionAttributeValues: {
          ":email": userEmail
        }
      })
    );

    await Promise.all(
      (result.Items || [])
        .filter((item) => item.type !== "report" && item.type !== "ban")
        .map((item) =>
          client.send(
            new DeleteCommand({
              TableName: MESSAGES_TABLE,
              Key: { id: item.id }
            })
          )
        )
    );

    return (result.Items || []).length;
  }

  const beforeMessages = db.messages.length;
  db.messages = db.messages.filter((message) => message.userEmail !== userEmail);
  writeDb(db);
  return beforeMessages - db.messages.length;
}

async function banForumUser(userEmail, reason, db) {
  const ban = {
    id: `ban-${userEmail}`,
    type: "ban",
    userEmail,
    reason,
    createdAt: new Date().toISOString()
  };
  const client = getDynamoDocClient();

  if (client) {
    await client.send(
      new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: ban
      })
    );
    return "dynamodb";
  }

  db.bannedUsers = db.bannedUsers || [];
  if (!db.bannedUsers.some((entry) => entry.userEmail === userEmail)) {
    db.bannedUsers.push(ban);
  }
  writeDb(db);
  return "local-json";
}

async function isForumUserBanned(userEmail, db) {
  const client = getDynamoDocClient();

  if (client) {
    const result = await client.send(
      new ScanCommand({
        TableName: MESSAGES_TABLE,
        FilterExpression: "#type = :type AND userEmail = :email",
        ExpressionAttributeNames: {
          "#type": "type"
        },
        ExpressionAttributeValues: {
          ":type": "ban",
          ":email": userEmail
        },
        Limit: 1
      })
    );

    return Boolean((result.Items || []).length);
  }

  return (db.bannedUsers || []).some((entry) => entry.userEmail === userEmail);
}

async function reportForumMessage(messageId, reporter, reason, db) {
  const message = await findForumMessage(messageId);
  if (!message) {
    return null;
  }

  const report = {
    id: `report-${crypto.randomUUID()}`,
    type: "report",
    messageId,
    messageText: message.text,
    offenderEmail: message.userEmail,
    offenderAlias: message.userAlias || message.userEmail,
    reporterEmail: reporter.email,
    reporterAlias: reporter.alias || reporter.email,
    reason,
    status: "pending-review",
    createdAt: new Date().toISOString()
  };
  const shouldEjectUser =
    !message.seeded && !String(message.userEmail || "").endsWith("@sentenal.news");

  const client = getDynamoDocClient();
  if (client) {
    await client.send(
      new PutCommand({
        TableName: MESSAGES_TABLE,
        Item: report
      })
    );
    if (shouldEjectUser) {
      await banForumUser(message.userEmail, "Reported objectionable content", db);
      await removeForumMessagesByUser(message.userEmail, db);
    } else {
      await removeForumMessage(messageId, db);
    }
    return { report, store: "dynamodb", ejectedUser: shouldEjectUser };
  }

  db.reports = db.reports || [];
  db.reports.push(report);
  if (shouldEjectUser) {
    await banForumUser(message.userEmail, "Reported objectionable content", db);
    await removeForumMessagesByUser(message.userEmail, db);
  } else {
    db.messages = db.messages.filter((entry) => entry.id !== messageId);
    writeDb(db);
  }
  return { report, store: "local-json", ejectedUser: shouldEjectUser };
}

async function deleteCognitoUsersForEmail(email) {
  const client = getCognitoClient();
  const result = await client.send(
    new ListUsersCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Filter: `email = "${email}"`
    })
  );

  await Promise.all(
    (result.Users || []).map((user) =>
      client.send(
        new AdminDeleteUserCommand({
          UserPoolId: COGNITO_USER_POOL_ID,
          Username: user.Username
        })
      )
    )
  );

  return (result.Users || []).length;
}

async function deleteAccountData(user, db) {
  const client = getDynamoDocClient();
  let removedMessages = 0;

  if (client) {
    const result = await client.send(
      new ScanCommand({
        TableName: MESSAGES_TABLE,
        FilterExpression: "userEmail = :email OR reporterEmail = :email OR offenderEmail = :email",
        ExpressionAttributeValues: {
          ":email": user.email
        }
      })
    );

    await Promise.all(
      (result.Items || []).map((item) =>
        client.send(
          new DeleteCommand({
            TableName: MESSAGES_TABLE,
            Key: { id: item.id }
          })
        )
      )
    );
    removedMessages = (result.Items || []).length;
  } else {
    const beforeMessages = db.messages.length;
    db.messages = db.messages.filter((message) => message.userEmail !== user.email);
    db.reports = (db.reports || []).filter(
      (report) =>
        report.reporterEmail !== user.email && report.offenderEmail !== user.email
    );
    db.users = db.users.filter((entry) => entry.email !== user.email);
    removedMessages = beforeMessages - db.messages.length;
    writeDb(db);
  }

  let removedCognitoUsers = 0;
  try {
    removedCognitoUsers = await deleteCognitoUsersForEmail(user.email);
  } catch (error) {
    error.message = `Could not delete Cognito user records: ${error.message}`;
    throw error;
  }

  return { removedMessages, removedCognitoUsers };
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

app.get("/api/moderation", (_req, res) => {
  res.json({
    contactEmail: MODERATION_CONTACT_EMAIL,
    terms:
      "Sentenal has zero tolerance for objectionable content or abusive users. Posts containing harassment, threats, hate, sexual exploitation, or illegal content are prohibited. Reports are reviewed within 24 hours and offending content/users may be removed."
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

  if (containsBlockedTerm(text)) {
    return res.status(400).json({
      error:
        "This post appears to contain objectionable content and was blocked by moderation."
    });
  }

  const { db, user } = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: "You must be logged in." });
  }

  try {
    if (await isForumUserBanned(user.email, db)) {
      return res.status(403).json({
        error:
          "This account has been removed from the forum for abusive or objectionable content."
      });
    }
  } catch (error) {
    console.error("Failed to check moderation status:", error);
    return res.status(500).json({ error: "Could not verify moderation status." });
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

app.delete("/api/messages/:id", requireAuth, async (req, res) => {
  const { db, user } = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: "You must be logged in." });
  }

  const message = await findForumMessage(req.params.id);
  if (!message) {
    return res.json({ ok: true });
  }

  if (message.userEmail !== user.email) {
    return res.status(403).json({ error: "You can only delete your own posts." });
  }

  try {
    const store = await removeForumMessage(req.params.id, db);
    res.json({ ok: true, store });
  } catch (error) {
    console.error("Failed to delete forum message:", error);
    res.status(500).json({ error: "Could not delete post." });
  }
});

app.post("/api/messages/:id/report", requireAuth, async (req, res) => {
  const reason = String(req.body.reason || "Objectionable content").trim();
  const { db, user } = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: "You must be logged in." });
  }

  try {
    const result = await reportForumMessage(req.params.id, user, reason, db);
    if (!result) {
      return res.status(404).json({ error: "Post was not found." });
    }

    res.status(201).json({
      ok: true,
      store: result.store,
      ejectedUser: result.ejectedUser,
      message:
        "Report received. The post was removed from the feed and Sentenal reviews objectionable content reports within 24 hours."
    });
  } catch (error) {
    console.error("Failed to report forum message:", error);
    res.status(500).json({ error: "Could not submit report." });
  }
});

app.delete("/api/account", requireAuth, async (req, res) => {
  const { db, user } = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: "You must be logged in." });
  }

  try {
    const result = await deleteAccountData(user, db);
    req.session.destroy(() => {
      res.json({ ok: true, ...result });
    });
  } catch (error) {
    console.error("Failed to delete account:", error);
    res.status(500).json({ error: "Could not delete account." });
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
