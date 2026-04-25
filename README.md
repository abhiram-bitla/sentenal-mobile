# Sentenal Mobile

Expo mobile app for Sentenal newsletter signup and public forum chat.

## Mobile app

```bash
npm install
npm start
```

## Forum backend

The mobile app reads and posts forum messages through `http://127.0.0.1:3001`.

Start the included backend in a second terminal:

```bash
cd backend
npm install
npm start
```

## AWS message database

The backend stores messages in DynamoDB when these env vars are set:

```bash
AWS_REGION=us-east-2
FORUM_MESSAGES_TABLE=your-dynamodb-table-name
```

The DynamoDB table needs a string partition key named `id`. If `FORUM_MESSAGES_TABLE` is not set, the backend uses `backend/data/db.json` for local development.

Default Sentenal forum posts are automatically inserted into the active message store on the first `/api/messages` request.

From `backend/`, you can create the default table and write `backend/.env` after AWS CLI login:

```bash
npm run setup:dynamodb
```
