#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient
} = require("@aws-sdk/client-dynamodb");

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-2";
const tableName = process.env.FORUM_MESSAGES_TABLE || "SentenalForumMessages";
const envPath = path.join(__dirname, "..", ".env");
const client = new DynamoDBClient({ region });

async function tableExists() {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error.name === "ResourceNotFoundException") {
      return false;
    }
    throw error;
  }
}

async function waitForActive() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
    const status = result.Table && result.Table.TableStatus;

    if (status === "ACTIVE") {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Timed out waiting for ${tableName} to become ACTIVE.`);
}

function writeEnvFile() {
  const env = [`AWS_REGION=${region}`, `FORUM_MESSAGES_TABLE=${tableName}`, ""].join("\n");
  fs.writeFileSync(envPath, env, "utf8");
}

async function main() {
  if (await tableExists()) {
    console.log(`DynamoDB table already exists: ${tableName}`);
  } else {
    console.log(`Creating DynamoDB table: ${tableName}`);
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          {
            AttributeName: "id",
            AttributeType: "S"
          }
        ],
        KeySchema: [
          {
            AttributeName: "id",
            KeyType: "HASH"
          }
        ]
      })
    );
    await waitForActive();
  }

  writeEnvFile();
  console.log(`Backend env written: ${envPath}`);
  console.log(`Messages will store in DynamoDB table ${tableName} (${region}).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
