# Sentenal Forum Backend

Express API for the Sentenal mobile forum.

## Run locally

```bash
npm install
npm start
```

The server defaults to `http://localhost:3001`, matching the mobile app's `API_BASE_URL`.

## Message storage

Messages use DynamoDB when these environment variables are set:

```bash
AWS_REGION=us-east-2
FORUM_MESSAGES_TABLE=your-dynamodb-table-name
```

The DynamoDB table should have a string partition key named `id`.

If `FORUM_MESSAGES_TABLE` is not set, the API falls back to `backend/data/db.json` for local development.

To create the default DynamoDB table and write `backend/.env`, log in with AWS CLI and run:

```bash
npm run setup:dynamodb
```

## Seeded forum posts

On the first `/api/messages` request, the API inserts default Sentenal forum posts into the active message store. In production with `FORUM_MESSAGES_TABLE` set, those default posts are stored in DynamoDB.
