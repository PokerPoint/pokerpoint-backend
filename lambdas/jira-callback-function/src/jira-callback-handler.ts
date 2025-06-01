import {LambdaInterface} from "@aws-lambda-powertools/commons";
import {Logger} from "@aws-lambda-powertools/logger";
import {APIGatewayEvent, APIGatewayProxyResult, Context} from "aws-lambda";
import {DynamoDBClient, PutItemCommand} from "@aws-sdk/client-dynamodb";

const logger = new Logger({ serviceName: "JiraCallback" });
const dynamodbClient = new DynamoDBClient();
const jiraTable = process.env.JiraTable;

const TTL_SECONDS = 28800; // 8 hours TTL

export class JiraCallbackHandler implements LambdaInterface {
    public async handler(
        event: APIGatewayEvent,
        _context: Context
    ): Promise<APIGatewayProxyResult> {

        const state = event.queryStringParameters?.state;
        const code = event.queryStringParameters?.code;

        if (!state || !code) {
            logger.error("Missing state or code");
            return {
                statusCode: 400,
                body: "Missing state or code"
            };
        }

        const clientId = process.env.JiraClientId;
        const clientSecret = process.env.JiraClientSecret;
        const redirectUri = "https://api.pokerpoint.co.uk/jira/callback";
        const frontendUrl = "https://pokerpoint.co.uk/app/index.html";

        try {
            logger.info(`Exchanging code for token (state=${state})`);

            const tokenResponse = await fetch("https://auth.atlassian.com/oauth/token", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    grant_type: "authorization_code",
                    client_id: clientId,
                    client_secret: clientSecret,
                    code,
                    redirect_uri: redirectUri
                })
            });

            if (!tokenResponse.ok) {
                const error = await tokenResponse.text();
                logger.error(`Token exchange failed: ${error}`);
                return { statusCode: 500, body: "Token exchange failed" };
            }

            const tokenData = await tokenResponse.json();
            const accessToken = tokenData.access_token;
            const expiresIn = tokenData.expires_in;

            logger.info("Token exchange successful");

            const cloudResponse = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (!cloudResponse.ok) {
                const error = await cloudResponse.text();
                logger.error(`Failed to get accessible resources: ${error}`);
                return { statusCode: 500, body: "Failed to get Jira Cloud ID" };
            }

            const cloudData = await cloudResponse.json();
            const cloudId = cloudData?.[0]?.id;

            if (!cloudId) {
                logger.error("No accessible Jira Cloud ID found");
                return { statusCode: 500, body: "No Jira Cloud ID found" };
            }

            logger.info(`Cloud ID: ${cloudId}`);

            const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;

            const parts = state.split(":");
            const userId = parts[0];
            const roomId = parts[1];

            if (!userId || !roomId) {
                logger.error(`Invalid state format: ${state}`);
                return { statusCode: 400, body: "Invalid state format" };
            }

            await dynamodbClient.send(new PutItemCommand({
                TableName: jiraTable,
                Item: {
                    userId: { S: userId },
                    roomId: { S: roomId },
                    accessToken: { S: accessToken },
                    expiresAt: { N: expiresAt.toString() },
                    cloudId: { S: cloudId },
                    ttl: { N: `${Math.floor(Date.now() / 1000) + TTL_SECONDS}` },
                }
            }));


            const redirectTo = `${frontendUrl}?roomId=${encodeURIComponent(roomId)}&jira=true`;

            logger.info(`Redirecting to: ${redirectTo}`);

            return {
                statusCode: 302,
                headers: {
                    Location: redirectTo
                },
                body: ""
            };

        } catch (error) {
            logger.error("Error during Jira callback", error);
            return {
                statusCode: 500,
                body: "Internal Server Error"
            };
        }
    }
}

const handlerClass = new JiraCallbackHandler();
export const lambdaHandler = handlerClass.handler.bind(handlerClass);
